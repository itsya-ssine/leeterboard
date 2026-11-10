/**
 * Migration 17 adds users.email / users.email_verified_at, the unique e-mail
 * index (ignoring case) and the pending_email_codes table. It is additive, so
 * existing members keep working with email = NULL.
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
const userColumns = async () =>
  (await db.client.execute("SELECT name FROM pragma_table_info('users')")).rows.map((r) => r.name);
const tableExists = async (name: string) =>
  (await db.client.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", args: [name] })).rows.length > 0;

const addUser = (id: string, login: string) =>
  db.client.execute({
    sql: `INSERT INTO users (id, display_name, login_username, password_hash) VALUES (?, ?, ?, 'scrypt$x')`,
    args: [id, login, login]
  });

const pendingRow = (id: string, purpose: string, email: string, userId: string | null = null) =>
  db.client.execute({
    sql: `INSERT INTO pending_email_codes
            (id, purpose, email, user_id, code_hash, created_at, last_sent_at, expires_at)
          VALUES (?, ?, ?, ?, 'hash', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`,
    args: [id, purpose, email, userId]
  });

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-mig17-"));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  await db.initDb();
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("migration 17: e-mail verification", () => {
  it("is part of a fresh database", async () => {
    const cols = await userColumns();
    assert.ok(cols.includes("email") && cols.includes("email_verified_at"));
    assert.ok(await tableExists("pending_email_codes"));
    assert.equal(await count("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 17"), 1);
  });

  it("upgrades a database that has the old shape, keeps its rows, and runs once", async () => {
    // Back to "before 17", with members and a pending reset row that must survive.
    await addUser("u1", "alice");
    await addUser("u2", "bob");
    await db.client.execute("DELETE FROM schema_migrations WHERE version = 17");
    await db.client.execute("DROP TABLE pending_email_codes");
    await db.client.execute("DROP INDEX idx_users_email");
    await db.client.execute("ALTER TABLE users DROP COLUMN email");
    await db.client.execute("ALTER TABLE users DROP COLUMN email_verified_at");
    assert.equal((await userColumns()).includes("email"), false);
    assert.equal(await tableExists("pending_email_codes"), false);

    await db.initDb();
    await db.initDb(); // a second run is a no-op

    assert.ok((await userColumns()).includes("email"));
    assert.ok((await userColumns()).includes("email_verified_at"));
    assert.ok(await tableExists("pending_email_codes"));
    assert.equal(await count("SELECT COUNT(*) AS n FROM users"), 2);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE email IS NOT NULL OR email_verified_at IS NOT NULL"), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 17"), 1);
  });

  it("makes an e-mail unique ignoring case, while any number of members may have none", async () => {
    await db.client.execute("UPDATE users SET email = 'a@example.com' WHERE id = 'u1'");
    await assert.rejects(db.client.execute("UPDATE users SET email = 'A@Example.com' WHERE id = 'u2'"), /UNIQUE/i);
    await addUser("u3", "carol"); // email NULL, next to bob's NULL
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE email IS NULL"), 2);
  });

  it("allows one open code per purpose and address, but the same address may have one per purpose", async () => {
    await pendingRow("p1", "signup", "x@example.com");
    await assert.rejects(pendingRow("p2", "signup", "x@example.com"), /UNIQUE/i);
    await pendingRow("p3", "reset", "x@example.com", "u1");
  });

  it("rejects an unknown purpose", async () => {
    await assert.rejects(pendingRow("p4", "login", "y@example.com"), /CHECK/i);
  });

  it("removes a member's pending codes when the member is deleted", async () => {
    await pendingRow("p5", "add_email", "z@example.com", "u2");
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_email_codes WHERE user_id = 'u2'"), 1);
    assert.equal(await db.deleteUserById("u2"), true);
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_email_codes WHERE user_id = 'u2'"), 0);
    // A sign-up (no member yet) is untouched by anyone's deletion.
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_email_codes WHERE id = 'p1'"), 1);
  });
});
