import { createClient, type Client, type InStatement } from "@libsql/client";
import { User, HistoryRecord, SyncState } from "./src/types.js";

// If TURSO_DATABASE_URL is set, connect to a real Turso cloud database.
// Otherwise fall back to a local SQLite file (no signup needed) so the
// project still runs out of the box — same @libsql/client API either way,
// so upgrading later is just setting two env vars, no code changes.
const url = process.env.TURSO_DATABASE_URL || "file:local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

export const client: Client = authToken
  ? createClient({ url, authToken })
  : createClient({ url });

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await client.execute({
    sql: `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column]
  });
  return res.rows.length > 0;
}

/* ---------- Schema ----------
 *
 *   users ──< history          one daily snapshot per member per UTC day
 *   users ──  sync_status      latest sync attempt per member (admin dashboard)
 *   pending_registrations      sign-ups waiting for LeetCode ownership proof
 *   meta                       small key/value store (e.g. weekly winners archive)
 *   schema_migrations          which migrations have been applied
 *
 * The canonical DDL, with comments, is in db/schema.sql. Changes to an existing
 * database go through the versioned MIGRATIONS list below, never ad-hoc.
 */

// How many daily snapshots are kept per member.
export const HISTORY_LIMIT = 60;

export async function initDb(): Promise<void> {
  // Final schema for brand-new databases. On an existing database every
  // statement is a no-op and the migrations below bring it up to date.
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        leetcode_username TEXT NOT NULL,
        avatar_url TEXT,
        all_time_solved INTEGER NOT NULL DEFAULT 0,
        easy_solved INTEGER NOT NULL DEFAULT 0,
        medium_solved INTEGER NOT NULL DEFAULT 0,
        hard_solved INTEGER NOT NULL DEFAULT 0,
        weekly_progress INTEGER NOT NULL DEFAULT 0,
        monthly_progress INTEGER NOT NULL DEFAULT 0,
        last_updated TEXT NOT NULL,
        tracking_start TEXT NOT NULL DEFAULT '',
        baseline_solved INTEGER NOT NULL DEFAULT 0,
        contest_rating INTEGER,
        contests_attended INTEGER NOT NULL DEFAULT 0,
        current_streak INTEGER,
        longest_streak INTEGER,
        password_hash TEXT NOT NULL DEFAULT '',
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_leetcode ON users(leetcode_username)`,
      // One row per member per UTC day: the cumulative totals as of that day's
      // last sync. Replaces the old users.history JSON column.
      `CREATE TABLE IF NOT EXISTS history (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        solved_count INTEGER NOT NULL CHECK (solved_count >= 0),
        easy_solved INTEGER NOT NULL DEFAULT 0,
        medium_solved INTEGER NOT NULL DEFAULT 0,
        hard_solved INTEGER NOT NULL DEFAULT 0,
        weekly_progress INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, date)
      ) WITHOUT ROWID`,
      `CREATE INDEX IF NOT EXISTS idx_history_date ON history(date)`,
      `CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,
      // A sign-up that has been started but not yet proven: the chosen
      // password (already hashed) waits here until the person shows they own
      // the LeetCode account. The browser only ever holds the random `id`.
      `CREATE TABLE IF NOT EXISTS pending_registrations (
        id TEXT PRIMARY KEY,
        leetcode_username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        code TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL
      )`,
      // The result of the latest sync attempt per member, for the admin
      // dashboard. Separate from users so none of it can leak into the public
      // API, and so a member's row carries no sync noise.
      `CREATE TABLE IF NOT EXISTS sync_status (
        user_id TEXT PRIMARY KEY,
        last_attempt TEXT NOT NULL,
        state TEXT NOT NULL,
        error TEXT,
        failures INTEGER NOT NULL DEFAULT 0,
        failing_since TEXT
      )`
    ],
    "write"
  );

  await runMigrations();
}

/* ---------- Migrations ----------
 * Each migration is idempotent (it checks what already exists), so two
 * serverless instances starting at once, or a run that was interrupted, are
 * both safe. Applied versions are recorded in schema_migrations.
 */

interface Migration {
  version: number;
  name: string;
  up: () => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  { version: 1, name: "legacy_columns", up: migrateLegacyColumns },
  { version: 2, name: "history_table", up: migrateHistoryTable }
];

export async function getAppliedMigrations(): Promise<{ version: number; name: string; appliedAt: string }[]> {
  const res = await client.execute("SELECT version, name, applied_at FROM schema_migrations ORDER BY version");
  return res.rows.map((r) => ({
    version: Number(r.version),
    name: r.name as string,
    appliedAt: r.applied_at as string
  }));
}

async function runMigrations(): Promise<void> {
  const applied = new Set((await getAppliedMigrations()).map((m) => m.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    await m.up();
    await client.execute({
      sql: `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
      args: [m.version, m.name, new Date().toISOString()]
    });
    console.log(`[DB] Applied migration ${m.version}: ${m.name}`);
  }
}

// v1 — everything the schema picked up before migrations were tracked.
async function migrateLegacyColumns(): Promise<void> {
  for (const ddl of [
    `ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN contest_rating INTEGER`,
    `ALTER TABLE users ADD COLUMN contests_attended INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN current_streak INTEGER`,
    `ALTER TABLE users ADD COLUMN longest_streak INTEGER`,
    // Brute-force protection (see recordFailedLogin).
    `ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN locked_until TEXT`
  ]) {
    try {
      await client.execute(ddl);
    } catch {
      // Column already exists — fine, ignore.
    }
  }

  // Case-insensitive uniqueness, so "Alice" and "alice" can't both register.
  // Skipped (with a warning) if old data already contains such a clash.
  try {
    await client.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_leetcode_lower ON users(lower(leetcode_username))`
    );
  } catch (err: any) {
    console.warn(`[DB] Couldn't create case-insensitive username index: ${err.message}`);
  }

  // The old 42 (Intra) login column is no longer used. SQLite can't relax its
  // NOT NULL constraint, so it has to go for new users to be insertable. The
  // unique index on it must be dropped first.
  if (await columnExists("users", "intra_id")) {
    await client.execute(`DROP INDEX IF EXISTS idx_users_intra`);
    try {
      await client.execute(`ALTER TABLE users DROP COLUMN intra_id`);
    } catch (err: any) {
      // Another cold-started instance may have dropped it a moment ago.
      if (await columnExists("users", "intra_id")) {
        throw new Error(`Couldn't remove the legacy intra_id column: ${err.message}`);
      }
    }
  }
}

const VALID_DATE = `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;

// v2 — move history out of the users.history JSON blob into its own table, and
// record when each member started being tracked (and their total at that
// moment) so their first, partial week can be counted from the day they joined.
async function migrateHistoryTable(): Promise<void> {
  if (!(await columnExists("users", "tracking_start"))) {
    await client.execute(`ALTER TABLE users ADD COLUMN tracking_start TEXT NOT NULL DEFAULT ''`);
  }
  if (!(await columnExists("users", "baseline_solved"))) {
    await client.execute(`ALTER TABLE users ADD COLUMN baseline_solved INTEGER NOT NULL DEFAULT 0`);
  }

  // Nothing to copy on a database that never had the JSON column (fresh install
  // or already migrated).
  if (!(await columnExists("users", "history"))) return;

  await client.batch(
    [
      // OR IGNORE: if this is a re-run after an interrupted migration, rows the
      // app has already written to the new table are never overwritten with the
      // stale JSON copy.
      `INSERT OR IGNORE INTO history
         (user_id, date, solved_count, easy_solved, medium_solved, hard_solved, weekly_progress)
       SELECT u.id,
              json_extract(j.value, '$.date'),
              MAX(0, COALESCE(json_extract(j.value, '$.solvedCount'), 0)),
              COALESCE(json_extract(j.value, '$.easy'), 0),
              COALESCE(json_extract(j.value, '$.medium'), 0),
              COALESCE(json_extract(j.value, '$.hard'), 0),
              COALESCE(json_extract(j.value, '$.weeklyProgress'), 0)
         FROM users u, json_each(u.history) j
        WHERE json_extract(j.value, '$.date') GLOB ${VALID_DATE}`,
      // Existing members: tracked since their oldest stored snapshot, with that
      // snapshot's total as the baseline. (Members that joined before the
      // 60-day history window get an approximate start; it only matters for the
      // week they joined, so it is harmless.)
      `UPDATE users SET
         tracking_start = COALESCE(
           (SELECT MIN(h.date) FROM history h WHERE h.user_id = users.id),
           substr(last_updated, 1, 10)),
         baseline_solved = COALESCE(
           (SELECT h.solved_count FROM history h WHERE h.user_id = users.id ORDER BY h.date LIMIT 1),
           all_time_solved)
       WHERE tracking_start = ''`
    ],
    "write"
  );

  // Verify before the old column is dropped: every distinct valid (member, day)
  // in the JSON must now exist in the table.
  const expected = Number(
    (
      await client.execute(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT u.id AS uid, json_extract(j.value, '$.date') AS d
             FROM users u, json_each(u.history) j
            WHERE d GLOB ${VALID_DATE})`
      )
    ).rows[0].n
  );
  const actual = Number((await client.execute(`SELECT COUNT(*) AS n FROM history`)).rows[0].n);
  if (actual < expected) {
    throw new Error(`History migration check failed: expected at least ${expected} rows, found ${actual}. users.history was kept.`);
  }

  try {
    await client.execute(`ALTER TABLE users DROP COLUMN history`);
  } catch (err: any) {
    // Another cold-started instance may have dropped it a moment ago.
    if (await columnExists("users", "history")) {
      throw new Error(`Couldn't remove users.history: ${err.message}`);
    }
  }
}

/* ---------- Users ---------- */

const HISTORY_COLUMNS = `user_id, date, solved_count, easy_solved, medium_solved, hard_solved, weekly_progress`;

function rowToHistory(row: Record<string, unknown>): HistoryRecord {
  return {
    date: row.date as string,
    solvedCount: Number(row.solved_count),
    easy: Number(row.easy_solved),
    medium: Number(row.medium_solved),
    hard: Number(row.hard_solved),
    weeklyProgress: Number(row.weekly_progress)
  };
}

function rowToUser(row: Record<string, unknown>, history: HistoryRecord[]): User {
  return {
    id: row.id as string,
    displayName: row.display_name as string,
    leetcodeUsername: row.leetcode_username as string,
    avatarUrl: (row.avatar_url as string) || "",
    allTimeSolved: Number(row.all_time_solved),
    easySolved: Number(row.easy_solved),
    mediumSolved: Number(row.medium_solved),
    hardSolved: Number(row.hard_solved),
    weeklyProgress: Number(row.weekly_progress),
    monthlyProgress: Number(row.monthly_progress),
    // Rank is derived at read time (see sortAndRankUsers in server.ts),
    // never stored — it depends on everyone else's stats, not just this row.
    rank: 0,
    contestRating: row.contest_rating == null ? null : Number(row.contest_rating),
    contestsAttended: Number(row.contests_attended ?? 0),
    currentStreak: row.current_streak == null ? null : Number(row.current_streak),
    longestStreak: row.longest_streak == null ? null : Number(row.longest_streak),
    lastUpdated: row.last_updated as string,
    trackingStart: (row.tracking_start as string) || String(row.last_updated).slice(0, 10),
    baselineSolved: Number(row.baseline_solved ?? 0),
    history
  };
}

async function loadHistory(userId: string): Promise<HistoryRecord[]> {
  const res = await client.execute({
    sql: `SELECT ${HISTORY_COLUMNS} FROM history WHERE user_id = ? ORDER BY date`,
    args: [userId]
  });
  return res.rows.map((r) => rowToHistory(r as unknown as Record<string, unknown>));
}

// Credential fields. These are deliberately NOT part of the User type, so
// they can never be serialised into an API response by accident.
export interface UserAuth {
  // "" for accounts that existed before passwords did (they claim their
  // account by proving ownership of the LeetCode profile).
  passwordHash: string;
  failedLogins: number;
  lockedUntil: string | null;
}

export interface UserWithAuth {
  user: User;
  auth: UserAuth;
}

async function rowToUserWithAuth(row: Record<string, unknown>): Promise<UserWithAuth> {
  return {
    user: rowToUser(row, await loadHistory(row.id as string)),
    auth: {
      passwordHash: (row.password_hash as string) || "",
      failedLogins: Number(row.failed_logins ?? 0),
      lockedUntil: (row.locked_until as string) || null
    }
  };
}

export async function listUsers(): Promise<User[]> {
  // One batch (a single consistent read) for members and all their history.
  // rowid grows with every insert, so ordering by it gives join order — which
  // is what the "First on the board" badge is based on.
  const [usersRes, historyRes] = await client.batch(
    [
      "SELECT * FROM users ORDER BY rowid",
      `SELECT ${HISTORY_COLUMNS} FROM history ORDER BY user_id, date`
    ],
    "read"
  );

  const byUser = new Map<string, HistoryRecord[]>();
  for (const r of historyRes.rows as unknown as Record<string, unknown>[]) {
    const id = r.user_id as string;
    const list = byUser.get(id);
    if (list) list.push(rowToHistory(r));
    else byUser.set(id, [rowToHistory(r)]);
  }

  return usersRes.rows.map((r, i) => {
    const row = r as unknown as Record<string, unknown>;
    return { ...rowToUser(row, byUser.get(row.id as string) ?? []), joinOrder: i + 1 };
  });
}

export async function getUserById(id: string): Promise<User | null> {
  const res = await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  return res.rows.length ? rowToUser(res.rows[0] as unknown as Record<string, unknown>, await loadHistory(id)) : null;
}

export async function getUserAuthById(id: string): Promise<UserWithAuth | null> {
  const res = await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  return res.rows.length ? rowToUserWithAuth(res.rows[0] as unknown as Record<string, unknown>) : null;
}

// LeetCode usernames are matched case-insensitively, the same way
// leetcode.com treats them.
export async function getUserAuthByUsername(leetcodeUsername: string): Promise<UserWithAuth | null> {
  const res = await client.execute({
    sql: "SELECT * FROM users WHERE lower(leetcode_username) = lower(?)",
    args: [leetcodeUsername]
  });
  return res.rows.length ? rowToUserWithAuth(res.rows[0] as unknown as Record<string, unknown>) : null;
}

function upsertSnapshot(userId: string, h: HistoryRecord): InStatement {
  return {
    sql: `INSERT INTO history (${HISTORY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, date) DO UPDATE SET
            solved_count = excluded.solved_count,
            easy_solved = excluded.easy_solved,
            medium_solved = excluded.medium_solved,
            hard_solved = excluded.hard_solved,
            weekly_progress = excluded.weekly_progress`,
    args: [userId, h.date, h.solvedCount, h.easy, h.medium, h.hard, h.weeklyProgress]
  };
}

export async function insertUser(user: User, passwordHash: string): Promise<void> {
  await client.batch(
    [
      {
        sql: `INSERT INTO users
          (id, display_name, leetcode_username, avatar_url, all_time_solved,
           easy_solved, medium_solved, hard_solved, weekly_progress, monthly_progress,
           last_updated, tracking_start, baseline_solved, contest_rating, contests_attended,
           current_streak, longest_streak, password_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          user.id,
          user.displayName,
          user.leetcodeUsername,
          user.avatarUrl,
          user.allTimeSolved,
          user.easySolved,
          user.mediumSolved,
          user.hardSolved,
          user.weeklyProgress,
          user.monthlyProgress,
          user.lastUpdated,
          user.trackingStart,
          user.baselineSolved,
          user.contestRating,
          user.contestsAttended,
          user.currentStreak,
          user.longestStreak,
          passwordHash
        ]
      },
      ...user.history.map((h) => upsertSnapshot(user.id, h))
    ],
    "write"
  );
}

// Used by syncing. It deliberately never writes display_name, so a sync that
// read the row a moment before a member renamed themselves can't overwrite
// the new name. The avatar always comes from LeetCode and is refreshed here.
//
// History is append-only from a sync's point of view: it only ever creates or
// updates the newest snapshot (today's), then drops snapshots older than the
// oldest one still in user.history (the HISTORY_LIMIT window).
export async function updateUser(user: User): Promise<void> {
  const statements: InStatement[] = [
    {
      sql: `UPDATE users SET
        avatar_url = ?,
        all_time_solved = ?, easy_solved = ?,
        medium_solved = ?, hard_solved = ?, weekly_progress = ?, monthly_progress = ?,
        last_updated = ?, contest_rating = ?, contests_attended = ?,
        current_streak = ?, longest_streak = ?
        WHERE id = ?`,
      args: [
        user.avatarUrl,
        user.allTimeSolved,
        user.easySolved,
        user.mediumSolved,
        user.hardSolved,
        user.weeklyProgress,
        user.monthlyProgress,
        user.lastUpdated,
        user.contestRating,
        user.contestsAttended,
        user.currentStreak,
        user.longestStreak,
        user.id
      ]
    }
  ];

  if (user.history.length > 0) {
    const sorted = [...user.history].sort((a, b) => a.date.localeCompare(b.date));
    statements.push(upsertSnapshot(user.id, sorted[sorted.length - 1]));
    statements.push({
      sql: `DELETE FROM history WHERE user_id = ? AND date < ?`,
      args: [user.id, sorted[0].date]
    });
  }

  await client.batch(statements, "write");
}

// Member-initiated rename. The avatar is not editable: it comes from LeetCode.
export async function updateDisplayName(id: string, displayName: string): Promise<void> {
  await client.execute({
    sql: "UPDATE users SET display_name = ? WHERE id = ?",
    args: [displayName, id]
  });
}

export async function deleteUserById(id: string): Promise<boolean> {
  // history is deleted explicitly as well as by ON DELETE CASCADE, because
  // SQLite only enforces foreign keys on connections that turn them on.
  const results = await client.batch(
    [
      { sql: "DELETE FROM history WHERE user_id = ?", args: [id] },
      { sql: "DELETE FROM sync_status WHERE user_id = ?", args: [id] },
      { sql: "DELETE FROM users WHERE id = ?", args: [id] }
    ],
    "write"
  );
  return (results[2].rowsAffected ?? 0) > 0;
}

/* ---------- Sync status (admin dashboard) ---------- */

export interface SyncStatusRow {
  userId: string;
  lastAttempt: string;
  state: SyncState;
  error: string | null;
  failures: number;
  failingSince: string | null;
}

export type SyncResult = { ok: true } | { ok: false; state: Exclude<SyncState, "ok">; error: string };

const MAX_ERROR_LENGTH = 300;

// Notes the outcome of one sync attempt. A success clears the failure streak;
// a failure extends it and remembers when it began. This is bookkeeping only,
// so it never throws: a problem here must not break the sync it describes.
export async function recordSyncResult(userId: string, result: SyncResult): Promise<void> {
  const now = new Date().toISOString();
  try {
    if (!("error" in result)) {
      await client.execute({
        sql: `INSERT INTO sync_status (user_id, last_attempt, state, error, failures, failing_since)
              VALUES (?, ?, 'ok', NULL, 0, NULL)
              ON CONFLICT(user_id) DO UPDATE SET
                last_attempt = excluded.last_attempt, state = 'ok',
                error = NULL, failures = 0, failing_since = NULL`,
        args: [userId, now]
      });
    } else {
      await client.execute({
        sql: `INSERT INTO sync_status (user_id, last_attempt, state, error, failures, failing_since)
              VALUES (?, ?, ?, ?, 1, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                last_attempt = excluded.last_attempt, state = excluded.state,
                error = excluded.error, failures = sync_status.failures + 1,
                failing_since = COALESCE(sync_status.failing_since, excluded.failing_since)`,
        args: [userId, now, result.state, result.error.slice(0, MAX_ERROR_LENGTH), now]
      });
    }
  } catch (err: any) {
    console.warn(`[Sync status] Couldn't record result for ${userId}: ${err.message}`);
  }
}

export async function listSyncStatus(): Promise<Map<string, SyncStatusRow>> {
  const res = await client.execute("SELECT * FROM sync_status");
  const map = new Map<string, SyncStatusRow>();
  for (const r of res.rows as unknown as Record<string, unknown>[]) {
    map.set(r.user_id as string, {
      userId: r.user_id as string,
      lastAttempt: r.last_attempt as string,
      state: r.state as SyncState,
      error: (r.error as string) || null,
      failures: Number(r.failures ?? 0),
      failingSince: (r.failing_since as string) || null
    });
  }
  return map;
}

/* ---------- Credentials + login throttling ---------- */

// Setting a password also clears any lockout: whoever can prove they own the
// LeetCode account is allowed back in.
export async function setPasswordHash(id: string, passwordHash: string): Promise<void> {
  await client.execute({
    sql: "UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?",
    args: [passwordHash, id]
  });
}

// One atomic statement: bump the counter and, once it reaches `maxFailures`,
// lock the account until `lockedUntilIso`. Kept in the database (not memory)
// so it still works when the app runs as many short-lived serverless
// instances.
export async function recordFailedLogin(id: string, maxFailures: number, lockedUntilIso: string): Promise<void> {
  await client.execute({
    sql: `UPDATE users SET
            failed_logins = failed_logins + 1,
            locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END
          WHERE id = ?`,
    args: [maxFailures, lockedUntilIso, id]
  });
}

export async function clearFailedLogins(id: string): Promise<void> {
  await client.execute({
    sql: "UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?",
    args: [id]
  });
}

/* ---------- Pending registrations ---------- */

export interface PendingRegistration {
  id: string;
  leetcodeUsername: string;
  displayName: string;
  passwordHash: string;
  code: string;
  attempts: number;
  expiresAt: string;
}

export async function createPendingRegistration(p: Omit<PendingRegistration, "attempts">): Promise<void> {
  await client.execute({
    sql: `INSERT INTO pending_registrations
      (id, leetcode_username, display_name, password_hash, code, attempts, expires_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)`,
    args: [p.id, p.leetcodeUsername, p.displayName, p.passwordHash, p.code, p.expiresAt]
  });
}

export async function getPendingRegistration(id: string): Promise<PendingRegistration | null> {
  const res = await client.execute({ sql: "SELECT * FROM pending_registrations WHERE id = ?", args: [id] });
  if (!res.rows.length) return null;
  const r = res.rows[0] as unknown as Record<string, unknown>;
  return {
    id: r.id as string,
    leetcodeUsername: r.leetcode_username as string,
    displayName: r.display_name as string,
    passwordHash: r.password_hash as string,
    code: r.code as string,
    attempts: Number(r.attempts),
    expiresAt: r.expires_at as string
  };
}

export async function bumpPendingAttempts(id: string): Promise<void> {
  await client.execute({
    sql: "UPDATE pending_registrations SET attempts = attempts + 1 WHERE id = ?",
    args: [id]
  });
}

export async function deletePendingRegistration(id: string): Promise<void> {
  await client.execute({ sql: "DELETE FROM pending_registrations WHERE id = ?", args: [id] });
}

export async function purgeExpiredRegistrations(nowIso: string): Promise<void> {
  await client.execute({ sql: "DELETE FROM pending_registrations WHERE expires_at < ?", args: [nowIso] });
}

export async function getMeta(key: string): Promise<string | null> {
  const res = await client.execute({ sql: "SELECT value FROM meta WHERE key = ?", args: [key] });
  return res.rows.length ? (res.rows[0].value as string) : null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await client.execute({
    sql: `INSERT INTO meta (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value]
  });
}