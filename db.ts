import { createClient, type Client } from "@libsql/client";
import { User } from "./src/types.js";

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

export async function initDb(): Promise<void> {
  await client.batch(
    [
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
        history TEXT NOT NULL DEFAULT '[]',
        contest_rating INTEGER,
        contests_attended INTEGER NOT NULL DEFAULT 0,
        current_streak INTEGER,
        longest_streak INTEGER,
        password_hash TEXT NOT NULL DEFAULT '',
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_leetcode ON users(leetcode_username)`,
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
      )`
    ],
    "write"
  );

  // ---- Migrations for databases created by earlier versions ----
  // Every step is idempotent: databases that already have the column simply
  // hit the catch and carry on. Existing rows keep all their stats/history.
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

function rowToUser(row: Record<string, unknown>): User {
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
    history: JSON.parse((row.history as string) || "[]")
  };
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

function rowToUserWithAuth(row: Record<string, unknown>): UserWithAuth {
  return {
    user: rowToUser(row),
    auth: {
      passwordHash: (row.password_hash as string) || "",
      failedLogins: Number(row.failed_logins ?? 0),
      lockedUntil: (row.locked_until as string) || null
    }
  };
}

export async function listUsers(): Promise<User[]> {
  const res = await client.execute("SELECT * FROM users");
  return res.rows.map((r) => rowToUser(r as unknown as Record<string, unknown>));
}

export async function getUserById(id: string): Promise<User | null> {
  const res = await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  return res.rows.length ? rowToUser(res.rows[0] as unknown as Record<string, unknown>) : null;
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

export async function insertUser(user: User, passwordHash: string): Promise<void> {
  await client.execute({
    sql: `INSERT INTO users
      (id, display_name, leetcode_username, avatar_url, all_time_solved,
       easy_solved, medium_solved, hard_solved, weekly_progress, monthly_progress,
       last_updated, history, contest_rating, contests_attended,
       current_streak, longest_streak, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      JSON.stringify(user.history),
      user.contestRating,
      user.contestsAttended,
      user.currentStreak,
      user.longestStreak,
      passwordHash
    ]
  });
}

// Used by syncing. It deliberately never writes display_name, so a sync that
// read the row a moment before a member renamed themselves can't overwrite
// the new name. The avatar always comes from LeetCode and is refreshed here.
export async function updateUser(user: User): Promise<void> {
  await client.execute({
    sql: `UPDATE users SET
      avatar_url = ?,
      all_time_solved = ?, easy_solved = ?,
      medium_solved = ?, hard_solved = ?, weekly_progress = ?, monthly_progress = ?,
      last_updated = ?, history = ?, contest_rating = ?, contests_attended = ?,
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
      JSON.stringify(user.history),
      user.contestRating,
      user.contestsAttended,
      user.currentStreak,
      user.longestStreak,
      user.id
    ]
  });
}

// Member-initiated rename. The avatar is not editable: it comes from LeetCode.
export async function updateDisplayName(id: string, displayName: string): Promise<void> {
  await client.execute({
    sql: "UPDATE users SET display_name = ? WHERE id = ?",
    args: [displayName, id]
  });
}

export async function deleteUserById(id: string): Promise<boolean> {
  const res = await client.execute({ sql: "DELETE FROM users WHERE id = ?", args: [id] });
  return (res.rowsAffected ?? 0) > 0;
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