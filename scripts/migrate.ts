/**
 * Brings the database up to the current schema (see db/schema.sql).
 *
 *   npm run db:migrate
 *
 * What it does:
 *   1. Backs up the database first when it is a local SQLite file
 *      (local.db -> local.db.bak-<timestamp>). For a remote Turso database it
 *      cannot copy anything, so take a snapshot yourself first, e.g.
 *      `turso db create leeterboard-backup --from-db <name>`, and pass
 *      `--confirm-remote` (the script refuses to touch a remote database
 *      without it).
 *   2. Applies every pending migration. The latest one moves each member's
 *      history out of the users.history JSON column into the `history` table,
 *      checks that nothing was lost, and only then drops the old column.
 *   3. Prints what changed.
 *
 * It is safe to run more than once: applied migrations are skipped. The app
 * runs the same migrations on start-up, so on a deployment this script is
 * optional; running it just lets you do it deliberately, with a backup.
 */
import "dotenv/config";
import fs from "fs";

async function main() {
  const url = process.env.TURSO_DATABASE_URL || "file:local.db";
  const isLocalFile = url.startsWith("file:");

  console.log(`Database: ${isLocalFile ? url : url.split("?")[0]}`);

  // A .env that holds production credentials must not be enough to migrate
  // production by accident (e.g. while developing). Remote targets need an
  // explicit flag, so the person running this has seen which database it is.
  if (!isLocalFile && !process.argv.includes("--confirm-remote")) {
    console.error(
      "\nRefusing to migrate a remote database without confirmation.\n" +
        "Check the database above is the one you mean, that you have a snapshot, then run:\n" +
        "  npm run db:migrate -- --confirm-remote"
    );
    process.exit(1);
  }

  if (isLocalFile) {
    const file = url.slice("file:".length);
    if (fs.existsSync(file)) {
      const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(file, backup);
      console.log(`Backup:   ${backup}`);
    }
  } else {
    console.log("Backup:   skipped (remote database) — make sure you have a snapshot before continuing.");
  }

  // Imported only now so that a failure above never opens the database.
  const { client, initDb, getAppliedMigrations } = await import("../db.js");

  const hadJsonHistory = (
    await client.execute(`SELECT 1 FROM pragma_table_info('users') WHERE name = 'history'`)
  ).rows.length > 0;

  const before = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`);
  const appliedBefore = before.rows.length
    ? new Set((await getAppliedMigrations()).map((m) => m.version))
    : new Set<number>();

  await initDb(); // creates anything missing, then runs pending migrations

  const applied = await getAppliedMigrations();
  const newlyApplied = applied.filter((m) => !appliedBefore.has(m.version));

  console.log("\nMigrations");
  for (const m of applied) {
    console.log(`  ${String(m.version).padStart(2)}  ${m.name.padEnd(18)} ${newlyApplied.includes(m) ? "applied now" : "already applied"}`);
  }

  const users = Number((await client.execute(`SELECT COUNT(*) AS n FROM users`)).rows[0].n);
  const rows = Number((await client.execute(`SELECT COUNT(*) AS n FROM history`)).rows[0].n);
  const orphans = Number(
    (await client.execute(`SELECT COUNT(*) AS n FROM history WHERE user_id NOT IN (SELECT id FROM users)`)).rows[0].n
  );
  const stillJson = (
    await client.execute(`SELECT 1 FROM pragma_table_info('users') WHERE name = 'history'`)
  ).rows.length > 0;

  console.log(`\nMembers:               ${users}`);
  console.log(`History rows:          ${rows}`);
  console.log(`Orphaned history rows: ${orphans}`);
  console.log(`users.history column:  ${stillJson ? "STILL PRESENT (migration did not finish)" : hadJsonHistory ? "dropped" : "not present"}`);

  if (orphans > 0 || stillJson) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message ?? err);
  console.error("No data was dropped: the old history column is only removed after the copy is verified.");
  process.exitCode = 1;
});
