/**
 * Migration 16 adds platform_sync_status.reset_frozen_at to existing databases,
 * the same sticky marker LeetCode has, so a Codeforces or CodinGame handle that
 * changed hands can't be used to reset a password.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

let tmpDir = "";
let db: typeof import("../db.js");

const columns = async () =>
  (await db.client.execute("SELECT name FROM pragma_table_info('platform_sync_status')")).rows.map((r) => r.name);

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-mig16-"));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  await db.initDb();
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("migration 16: platform reset freeze", () => {
  it("is part of a fresh database", async () => {
    assert.ok((await columns()).includes("reset_frozen_at"));
  });

  it("adds the column to a database that has the old shape, keeps its rows, and runs once", async () => {
    // Back to "before 16", with a row that must survive.
    await db.client.execute("DELETE FROM schema_migrations WHERE version = 16");
    await db.client.execute("ALTER TABLE platform_sync_status DROP COLUMN reset_frozen_at");
    await db.client.execute(
      `INSERT INTO platform_sync_status (user_id, platform, last_attempt, state, failures)
       VALUES ('someone', 'codeforces', '2026-01-01T00:00:00.000Z', 'ok', 0)`
    );
    assert.equal((await columns()).includes("reset_frozen_at"), false);

    await db.initDb();
    await db.initDb(); // a second run is a no-op
    assert.ok((await columns()).includes("reset_frozen_at"));
    assert.equal(
      Number((await db.client.execute("SELECT COUNT(*) AS n FROM platform_sync_status WHERE user_id = 'someone'")).rows[0].n),
      1
    );
    assert.equal(
      Number((await db.client.execute("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 16")).rows[0].n),
      1
    );
  });
});
