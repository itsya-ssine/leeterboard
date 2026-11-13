/**
 * Migration 18 adds the tables for "sign in with Google / GitHub":
 * oauth_identities, oauth_states and pending_oauth_signups. It is additive, so
 * existing members and every earlier table are untouched.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

let tmpDir = "";
let db: typeof import("../db.js");

const count = async (sql: string, args: (string | number)[] = []) =>
  Number((await db.client.execute({ sql, args })).rows[0].n);
const tableExists = async (name: string) =>
  (await db.client.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", args: [name] })).rows.length > 0;

const addUser = (id: string, login: string) =>
  db.client.execute({
    sql: `INSERT INTO users (id, display_name, login_username, password_hash) VALUES (?, ?, ?, 'scrypt$x')`,
    args: [id, login, login]
  });

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2099-01-01T00:00:00.000Z";

const identity = (provider: string, providerUserId: string, userId: string) =>
  db.client.execute({
    sql: `INSERT INTO oauth_identities (provider, provider_user_id, user_id, created_at) VALUES (?, ?, ?, ?)`,
    args: [provider, providerUserId, userId, NOW]
  });

const state = (id: string, provider: string, intent: string, userId: string | null = null) =>
  db.client.execute({
    sql: `INSERT INTO oauth_states (id, provider, intent, user_id, code_verifier, created_at, expires_at)
          VALUES (?, ?, ?, ?, 'verifier', ?, ?)`,
    args: [id, provider, intent, userId, NOW, LATER]
  });

const pendingSignup = (id: string, provider: string, providerUserId: string, email = "a@example.com") =>
  db.client.execute({
    sql: `INSERT INTO pending_oauth_signups (id, provider, provider_user_id, email, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, provider, providerUserId, email, NOW, LATER]
  });

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-mig18-"));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  await db.initDb();
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("migration 18: sign in with Google / GitHub", () => {
  it("is part of a fresh database", async () => {
    for (const name of ["oauth_identities", "oauth_states", "pending_oauth_signups"]) {
      assert.ok(await tableExists(name), `${name} is missing`);
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 18"), 1);
  });

  it("upgrades a database that has the old shape, keeps its rows, and runs once", async () => {
    // Back to "before 18", with members that must survive.
    await addUser("u1", "alice");
    await addUser("u2", "bob");
    await db.client.execute("DELETE FROM schema_migrations WHERE version = 18");
    for (const name of ["oauth_identities", "oauth_states", "pending_oauth_signups"]) {
      await db.client.execute(`DROP TABLE ${name}`);
    }
    assert.equal(await tableExists("oauth_identities"), false);

    await db.initDb();
    await db.initDb(); // a second run is a no-op

    for (const name of ["oauth_identities", "oauth_states", "pending_oauth_signups"]) {
      assert.ok(await tableExists(name), `${name} is missing after the upgrade`);
      assert.equal(await count(`SELECT COUNT(*) AS n FROM ${name}`), 0);
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM users"), 2);
    assert.equal(await count("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 18"), 1);
  });

  it("lets one provider account belong to only one member", async () => {
    await identity("github", "1001", "u1");
    await assert.rejects(identity("github", "1001", "u2"), /UNIQUE|PRIMARY/i);
    // The same id at another provider is a different account.
    await identity("google", "1001", "u2");
  });

  it("lets a member have only one account per provider", async () => {
    await assert.rejects(identity("github", "1002", "u1"), /UNIQUE/i);
    await identity("google", "1003", "u1"); // another provider is fine
  });

  it("rejects an unknown provider and an unknown intent", async () => {
    await assert.rejects(identity("facebook", "9", "u1"), /CHECK/i);
    await assert.rejects(state("s0", "github", "login"), /CHECK/i);
    await assert.rejects(state("s0", "twitter", "signin"), /CHECK/i);
    await assert.rejects(pendingSignup("p0", "twitter", "1"), /CHECK/i);
  });

  it("holds a sign-in attempt with no member, and a link attempt for a member", async () => {
    await state("s1", "github", "signin");
    await state("s2", "google", "link", "u1");
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_states"), 2);
  });

  it("keeps one pending sign-up per provider identity", async () => {
    await pendingSignup("p1", "github", "2001");
    await assert.rejects(pendingSignup("p2", "github", "2001", "b@example.com"), /UNIQUE/i);
    await pendingSignup("p3", "google", "2001", "c@example.com");
  });

  it("removes a member's identities and attempts when the member is deleted", async () => {
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_identities WHERE user_id = 'u1'"), 2);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_states WHERE user_id = 'u1'"), 1);
    assert.equal(await db.deleteUserById("u1"), true);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_identities WHERE user_id = 'u1'"), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_states WHERE user_id = 'u1'"), 0);
    // Other members' rows, a sign-in with no member and pending sign-ups are untouched.
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_identities WHERE user_id = 'u2'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_states WHERE id = 's1'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_oauth_signups"), 2);
  });
});
