/**
 * Migration 19 drops pending_email_codes (the emailed-code flow is gone). It
 * must keep members and their stored e-mail addresses, and run once.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

let tmpDir = "";
let db: typeof import("../db.js");

const count = async (sql: string) => Number((await db.client.execute(sql)).rows[0].n);
const tableExists = async (name: string) =>
  (await db.client.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", args: [name] })).rows.length > 0;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-mig19-"));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  await db.initDb();
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("migration 19: drop pending_email_codes", () => {
  it("leaves a fresh database without the table", async () => {
    assert.equal(await tableExists("pending_email_codes"), false);
    assert.equal(await count("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 19"), 1);
  });

  it("drops the table from an old-shaped database, keeps members and e-mails, and runs once", async () => {
    await db.client.execute(
      `INSERT INTO users (id, display_name, login_username, password_hash, email, email_verified_at)
       VALUES ('u1', 'alice', 'alice', 'scrypt$x', 'a@example.com', '2026-01-01T00:00:00.000Z')`
    );
    await db.client.execute(
      `CREATE TABLE pending_email_codes (
         id TEXT PRIMARY KEY, purpose TEXT NOT NULL, email TEXT NOT NULL, user_id TEXT, username TEXT,
         display_name TEXT, password_hash TEXT, code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL, last_sent_at TEXT NOT NULL, expires_at TEXT NOT NULL)`
    );
    await db.client.execute(
      `CREATE UNIQUE INDEX idx_pending_email_codes_open ON pending_email_codes(purpose, email)`
    );
    await db.client.execute(
      `INSERT INTO pending_email_codes (id, purpose, email, code_hash, created_at, last_sent_at, expires_at)
       VALUES ('c1', 'signup', 'x@example.com', 'h', 'n', 'n', 'n')`
    );
    await db.client.execute("DELETE FROM schema_migrations WHERE version = 19");

    await db.initDb();
    await db.initDb(); // a second run is a no-op

    assert.equal(await tableExists("pending_email_codes"), false);
    assert.equal(await count("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'idx_pending_email_codes%'"), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE email = 'a@example.com' AND email_verified_at IS NOT NULL"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 19"), 1);
  });

  it("deletes a member without touching the dropped table", async () => {
    assert.equal(await db.deleteUserById("u1"), true);
  });
});
