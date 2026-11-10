/**
 * Migration 14 makes users.leetcode_username and users.last_updated optional.
 * SQLite can only do that by rebuilding the users table, and every other table
 * references users(id) ON DELETE CASCADE, so a careless rebuild would delete
 * the members' history, notifications and linked platforms.
 *
 * This test builds a database in the OLD shape (NOT NULL columns, real rows in
 * the child tables), runs the real migration in a separate process (db.ts reads
 * its database URL once, at import), and checks that nothing was lost.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let tmpDir = "";
let dbFile = "";

/** Runs a snippet of ESM against db.ts, pointed at the throwaway database. */
function inChildProcess(code: string): string {
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: "test", TURSO_DATABASE_URL: `file:${dbFile}` },
    encoding: "utf8"
  });
}

const CHILDREN = [
  "history",
  "notifications",
  "user_awards",
  "platform_accounts",
  "platform_history",
  "platform_sync_status",
  "pending_links",
  "feedback"
];

describe("migration 14: optional LeetCode columns", () => {
  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-mig14-"));
    dbFile = path.join(tmpDir, "legacy.db");

    // 1. A fresh database already has the final shape.
    inChildProcess(`const { initDb } = await import("./db.ts"); await initDb();`);

    // 2. Put it back into the OLD shape, with real data.
    const c = createClient({ url: `file:${dbFile}` });
    try {
      await c.execute("PRAGMA foreign_keys = OFF");
      const info = await c.execute(
        `SELECT name, type, "notnull" AS nn, dflt_value, pk FROM pragma_table_info('users') ORDER BY cid`
      );
      const defs = info.rows.map((r) =>
        [
          `"${r.name}"`,
          r.type,
          Number(r.pk) > 0 ? "PRIMARY KEY" : "",
          Number(r.nn) === 1 || r.name === "leetcode_username" || r.name === "last_updated" ? "NOT NULL" : "",
          r.dflt_value !== null ? `DEFAULT ${r.dflt_value}` : ""
        ].filter(Boolean).join(" ")
      );
      const cols = info.rows.map((r) => `"${r.name}"`).join(", ");
      const tx = await c.transaction("write");
      await tx.execute(`CREATE TABLE users_legacy (${defs.join(", ")})`);
      await tx.execute(`INSERT INTO users_legacy (${cols}) SELECT ${cols} FROM users`);
      await tx.execute("DROP TABLE users");
      await tx.execute("ALTER TABLE users_legacy RENAME TO users");
      await tx.execute("CREATE UNIQUE INDEX idx_users_leetcode ON users(leetcode_username)");
      await tx.execute("CREATE UNIQUE INDEX idx_users_leetcode_lower ON users(lower(leetcode_username))");
      await tx.execute("CREATE UNIQUE INDEX idx_users_login_username ON users(login_username)");
      await tx.commit();
      await c.execute("DELETE FROM schema_migrations WHERE version = 14");
      await c.execute("PRAGMA foreign_keys = ON");

      const now = new Date().toISOString();
      for (const [id, name] of [["u1", "Alice"], ["u2", "bob_99"], ["u3", "Carol-X"]]) {
        await c.execute({
          sql: `INSERT INTO users (id, display_name, leetcode_username, login_username, last_updated, password_hash)
                VALUES (?, ?, ?, ?, ?, 'h')`,
          args: [id, name, name, name.toLowerCase(), now]
        });
        await c.batch(
          [
            { sql: "INSERT INTO history (user_id, date, solved_count) VALUES (?, '2026-01-01', 10), (?, '2026-01-02', 12)", args: [id, id] },
            { sql: "INSERT INTO notifications (id, user_id, type, title, created_at) VALUES (?, ?, 'badge', 't', ?)", args: [`n-${id}`, id, now] },
            { sql: "INSERT INTO user_awards (user_id, award_key, awarded_at) VALUES (?, 'first', ?)", args: [id, now] },
            { sql: "INSERT INTO platform_accounts (user_id, platform, handle, linked_at) VALUES (?, 'codeforces', ?, ?)", args: [id, `cf-${id}`, now] },
            { sql: "INSERT INTO platform_sync_status (user_id, platform, last_attempt, state) VALUES (?, 'codeforces', ?, 'ok')", args: [id, now] },
            { sql: "INSERT INTO feedback (id, user_id, category, message, created_at) VALUES (?, ?, 'idea', 'hi', ?)", args: [`f-${id}`, id, now] },
            { sql: "INSERT INTO platform_history (user_id, platform, date, solved) VALUES (?, 'codeforces', '2026-01-01', 5)", args: [id] },
            { sql: "INSERT INTO pending_links (user_id, platform, handle, code, expires_at) VALUES (?, 'codingame', ?, 'c', ?)", args: [id, `cg-${id}`, now] }
          ],
          "write"
        );
      }
    } finally {
      c.close();
    }
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("keeps every member and every child row, and the foreign keys still work", async () => {
    const counts = (c: ReturnType<typeof createClient>) =>
      Promise.all(["users", ...CHILDREN].map(async (t) => Number((await c.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n)));

    const c0 = createClient({ url: `file:${dbFile}` });
    const before = await counts(c0);
    assert.equal((await c0.execute(`SELECT "notnull" AS n FROM pragma_table_info('users') WHERE name = 'leetcode_username'`)).rows[0].n, 1);
    assert.ok(before.every((n) => n > 0), `test data should fill every table, got ${before}`);
    c0.close();

    // Applies migration 14; the second call must be a harmless no-op.
    const out = inChildProcess(`const { initDb } = await import("./db.ts"); await initDb(); await initDb();`);
    assert.equal((out.match(/Applied migration 14/g) ?? []).length, 1);

    const c = createClient({ url: `file:${dbFile}` });
    try {
      assert.deepEqual(await counts(c), before, "no rows may be lost");

      const nullable = await c.execute(
        `SELECT name FROM pragma_table_info('users') WHERE name IN ('leetcode_username', 'last_updated') AND "notnull" = 0`
      );
      assert.equal(nullable.rows.length, 2);

      const members = (await c.execute("SELECT id, leetcode_username, login_username FROM users ORDER BY id")).rows;
      assert.deepEqual(members.map((r) => [r.id, r.leetcode_username, r.login_username]), [
        ["u1", "Alice", "alice"],
        ["u2", "bob_99", "bob_99"],
        ["u3", "Carol-X", "carol-x"]
      ]);

      // The child tables must point at the rebuilt table, not at a leftover.
      const refs = await c.execute(
        `SELECT DISTINCT f."table" AS t FROM sqlite_master m, pragma_foreign_key_list(m.name) f WHERE m.type = 'table'`
      );
      assert.deepEqual(refs.rows.map((r) => r.t), ["users"]);
      assert.equal((await c.execute("PRAGMA foreign_key_check")).rows.length, 0);
      assert.equal((await c.execute("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('users_new', 'users_old', '_mig_chk')")).rows[0].n, 0);

      const indexes = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users'")).rows.map((r) => r.name);
      for (const name of ["idx_users_leetcode", "idx_users_leetcode_lower", "idx_users_login_username"]) {
        assert.ok(indexes.includes(name), `missing index ${name}`);
      }
    } finally {
      c.close();
    }
  });

  it("lets members exist without LeetCode, but keeps handles unique", async () => {
    const c = createClient({ url: `file:${dbFile}` });
    try {
      await c.execute("PRAGMA foreign_keys = ON");
      await c.execute("INSERT INTO users (id, display_name, login_username) VALUES ('u4', 'No LC', 'dave')");
      await c.execute("INSERT INTO users (id, display_name, login_username) VALUES ('u5', 'No LC 2', 'erin')");
      await assert.rejects(
        c.execute("INSERT INTO users (id, display_name, login_username, leetcode_username) VALUES ('u6', 'x', 'zed', 'ALICE')"),
        /UNIQUE/
      );
      await assert.rejects(
        c.execute("INSERT INTO users (id, display_name, login_username) VALUES ('u7', 'x', 'Dave'), ('u8', 'y', 'Dave')"),
        /UNIQUE/
      );
    } finally {
      c.close();
    }
  });

  it("still cascades deletes through the rebuilt table", async () => {
    const c = createClient({ url: `file:${dbFile}` });
    try {
      await c.execute("PRAGMA foreign_keys = ON");
      const rows = async () => Number((await c.execute("SELECT COUNT(*) AS n FROM history WHERE user_id = 'u1'")).rows[0].n);
      assert.equal(await rows(), 2);
      await c.execute("DELETE FROM users WHERE id = 'u1'");
      assert.equal(await rows(), 0);
      assert.equal(Number((await c.execute("SELECT COUNT(*) AS n FROM history WHERE user_id = 'u2'")).rows[0].n), 2);
      // feedback is ON DELETE SET NULL: the message stays, the author is cleared.
      const fb = await c.execute("SELECT user_id FROM feedback WHERE id = 'f-u1'");
      assert.equal(fb.rows.length, 1);
      assert.equal(fb.rows[0].user_id, null);
    } finally {
      c.close();
    }
  });
});
