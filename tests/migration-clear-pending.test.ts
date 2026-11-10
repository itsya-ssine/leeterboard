/**
 * Migration 15 empties pending_registrations: those sign-ups were waiting for a
 * LeetCode proof that can no longer happen, and each row holds a hashed password.
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

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-mig15-"));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  await db.initDb();
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("migration 15: clear pending registrations", () => {
  it("removes sign-ups that were waiting for a proof, keeps the table, and runs once", async () => {
    // Put the database back to "before 15" with two in-flight sign-ups.
    await db.client.execute("DELETE FROM schema_migrations WHERE version = 15");
    for (const id of ["a", "b"]) {
      await db.client.execute({
        sql: `INSERT INTO pending_registrations (id, leetcode_username, display_name, password_hash, code, expires_at)
              VALUES (?, ?, 'x', 'scrypt$hash', 'code', '2099-01-01T00:00:00.000Z')`,
        args: [id, `user_${id}`]
      });
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_registrations"), 2);

    await db.initDb();
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_registrations"), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 15"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'pending_registrations'"), 1, "the table stays");

    // Applied once: rows added afterwards (say, by a rolled-back release) are left alone.
    await db.client.execute(
      `INSERT INTO pending_registrations (id, leetcode_username, display_name, password_hash, code, expires_at)
       VALUES ('c', 'user_c', 'x', 'scrypt$hash', 'code', '2099-01-01T00:00:00.000Z')`
    );
    await db.initDb();
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_registrations"), 1);
  });
});
