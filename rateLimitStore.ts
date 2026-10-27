import type { IncrementResponse, Options, Store } from "express-rate-limit";
import { client } from "./db.js";

// A rate-limit store that keeps its counters in the database instead of in
// process memory. On Vercel every cold start and every parallel instance gets
// its own memory, so an in-memory counter can be sidestepped just by landing
// on a fresh instance. Counters kept here are shared by all of them.
//
// Each increment is ONE atomic upsert, so concurrent requests on different
// instances can't undercount. Used only for the sensitive limiters (login,
// sign-up, verification, account and refresh routes): the general API limiter
// stays in memory because the frontend polls and a database write per poll
// would be wasteful.
//
// Errors from the database are deliberately not swallowed: the sensitive
// routes need the database anyway, and failing closed is safer than silently
// dropping the limit.

const PURGE_PROBABILITY = 0.01; // opportunistic cleanup, no cron needed

export class DbRateLimitStore implements Store {
  // Counters live in the database, so every instance sees the same keys.
  localKeys = false;
  prefix: string;
  private windowMs = 60_000;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private dbKey(key: string): string {
    // Keys are client IPs, but cap the length so nothing unbounded is stored.
    return `${this.prefix}:${key}`.slice(0, 200);
  }

  async get(key: string) {
    const res = await client.execute({
      sql: "SELECT hits, reset_at FROM rate_limits WHERE key = ? AND reset_at > ?",
      args: [this.dbKey(key), Date.now()]
    });
    const row = res.rows[0];
    if (!row) return undefined;
    return { totalHits: Number(row.hits), resetTime: new Date(Number(row.reset_at)) };
  }

  async increment(key: string): Promise<IncrementResponse> {
    const now = Date.now();
    const resetAt = now + this.windowMs;
    // A new window starts when the stored one has expired; otherwise the hit
    // is added to the current window and its reset time is left alone.
    const res = await client.execute({
      sql: `INSERT INTO rate_limits (key, hits, reset_at) VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET
              hits = CASE WHEN reset_at <= ? THEN 1 ELSE hits + 1 END,
              reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
            RETURNING hits, reset_at`,
      args: [this.dbKey(key), resetAt, now, now, resetAt]
    });
    const row = res.rows[0];

    if (Math.random() < PURGE_PROBABILITY) {
      client
        .execute({ sql: "DELETE FROM rate_limits WHERE reset_at <= ?", args: [now] })
        .catch(() => {});
    }

    return { totalHits: Number(row.hits), resetTime: new Date(Number(row.reset_at)) };
  }

  async decrement(key: string): Promise<void> {
    await client.execute({
      sql: "UPDATE rate_limits SET hits = MAX(hits - 1, 0) WHERE key = ?",
      args: [this.dbKey(key)]
    });
  }

  async resetKey(key: string): Promise<void> {
    await client.execute({ sql: "DELETE FROM rate_limits WHERE key = ?", args: [this.dbKey(key)] });
  }
}
