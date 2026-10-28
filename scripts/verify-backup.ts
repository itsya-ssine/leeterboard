/**
 * Verifies that a RESTORED copy of the database is intact and usable.
 *
 *   npm run db:verify-backup -- --url file:./restored.db
 *   npm run db:verify-backup -- --url libsql://leeterboard-restore-test-you.turso.io
 *       (auth token for a remote copy: RESTORE_TEST_AUTH_TOKEN)
 *
 * A backup you have never restored is a hope, not a backup. Run this after
 * every restore drill (steps in docs/security-operations.md). It only READS,
 * and it refuses to run against the database the app itself is configured to
 * use, so a drill can't be pointed at production by mistake.
 *
 * Exit code 0 = every check passed, 1 = at least one failed.
 */
import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = flag("--url");
if (!url) {
  console.error("Usage: npm run db:verify-backup -- --url <file:path | libsql://restored-copy>");
  process.exit(1);
}
const live = process.env.TURSO_DATABASE_URL;
if (live && url.replace(/\?.*$/, "") === live.replace(/\?.*$/, "")) {
  console.error("Refusing to verify the live database. Restore the backup into a NEW database and pass that URL.");
  process.exit(1);
}

const db = createClient({ url, authToken: process.env.RESTORE_TEST_AUTH_TOKEN || undefined });
let failed = 0;
const ok = (msg: string) => console.log(`  ok    ${msg}`);
const bad = (msg: string) => {
  failed++;
  console.log(`  FAIL  ${msg}`);
};
const warn = (msg: string) => console.log(`  warn  ${msg}`);

async function scalar(sql: string): Promise<number> {
  const res = await db.execute(sql);
  return Number(Object.values(res.rows[0])[0]);
}

// Tables the application needs, read from the canonical schema file.
const schema = fs.readFileSync(path.resolve(import.meta.dirname, "../db/schema.sql"), "utf8");
const expectedTables = [...schema.matchAll(/^CREATE TABLE (\w+)/gm)].map((m) => m[1]);

console.log(`Verifying ${url.replace(/\?.*$/, "")}`);

try {
  try {
    const res = await db.execute("PRAGMA integrity_check");
    const verdict = String(Object.values(res.rows[0])[0]);
    verdict === "ok" ? ok("integrity_check: ok") : bad(`integrity_check reported: ${verdict}`);
  } catch {
    warn("integrity_check isn't available on this connection (skipped)");
  }

  const present = new Set(
    (await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((r) => String(r.name))
  );
  const missing = expectedTables.filter((t) => !present.has(t));
  missing.length
    ? bad(`missing tables: ${missing.join(", ")} (restore is incomplete, or it predates a migration — run db:migrate on the COPY)`)
    : ok(`all ${expectedTables.length} expected tables are present`);

  if (present.has("users")) {
    const users = await scalar("SELECT COUNT(*) FROM users");
    users > 0 ? ok(`${users} members restored`) : bad("the users table is empty");

    const noPassword = await scalar("SELECT COUNT(*) FROM users WHERE password_hash IS NULL OR password_hash = ''");
    noPassword === 0
      ? ok("every member has a password hash")
      : warn(`${noPassword} member(s) have no password yet (expected only for accounts from before passwords existed)`);

    const malformed = await scalar("SELECT COUNT(*) FROM users WHERE password_hash != '' AND password_hash NOT LIKE 'scrypt$%'");
    malformed === 0 ? ok("password hashes have the expected format") : bad(`${malformed} member(s) have a malformed password hash`);

    if (present.has("history")) {
      const orphans = await scalar("SELECT COUNT(*) FROM history WHERE user_id NOT IN (SELECT id FROM users)");
      orphans === 0 ? ok("no orphaned history rows") : bad(`${orphans} history row(s) point at members that don't exist`);
    }
    if (present.has("notifications")) {
      const orphans = await scalar("SELECT COUNT(*) FROM notifications WHERE user_id NOT IN (SELECT id FROM users)");
      orphans === 0 ? ok("no orphaned notifications") : bad(`${orphans} notification(s) point at members that don't exist`);
    }
  }

  if (present.has("schema_migrations")) {
    const latest = await scalar("SELECT COALESCE(MAX(version), 0) FROM schema_migrations");
    latest > 0 ? ok(`schema is at migration v${latest}`) : bad("no migrations are recorded");
  }
} catch (err: any) {
  bad(`could not read the database: ${err.message}`);
} finally {
  db.close();
}

if (failed) {
  console.error(`\n${failed} check(s) failed — do NOT rely on this backup until they are resolved.`);
  process.exit(1);
}
console.log("\nBackup verified: it restores to a complete, readable database.");
