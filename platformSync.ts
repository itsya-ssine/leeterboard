// Sync for the extra platforms (Codeforces and CodinGame) that members
// link on top of their LeetCode account. Kept out of server.ts, and kept
// separate from the LeetCode sync on purpose: a failure here is recorded in
// platform_sync_status and never touches a member's LeetCode stats.

import type { PlatformId } from "./src/types.js";
import {
  listPlatformAccountsForSync,
  getPlatformAccounts,
  savePlatformStats,
  recordPlatformSyncResult,
  type PlatformAccountRow
} from "./db.js";
import { client } from "./db.js";
import { PlatformNotFoundError, type PlatformStats } from "./platforms/common.js";
import { fetchCodeforcesStats, startOfUtcWeekSeconds } from "./platforms/codeforces.js";
import { fetchCodingameStats } from "./platforms/codingame.js";

// A platform without a provider is skipped, not an error.
const PROVIDERS: Partial<Record<PlatformId, (handle: string) => Promise<PlatformStats>>> = {
  codeforces: fetchCodeforcesStats,
  codingame: fetchCodingameStats
};

// Platforms that expose no submission timestamps: weekly and monthly progress
// is the difference between today's total and the total in our own daily
// snapshots (platform_history). Codeforces computes both exactly itself.
const PROGRESS_FROM_HISTORY = new Set<PlatformId>(["codingame"]);

// The member's total on or before `date`; if tracking started after that date,
// their first snapshot (they only earn progress from when they linked). null =
// no snapshots yet (first sync).
async function totalAtOrBefore(userId: string, platform: PlatformId, date: string): Promise<number | null> {
  const before = await client.execute({
    sql: "SELECT solved FROM platform_history WHERE user_id = ? AND platform = ? AND date <= ? ORDER BY date DESC LIMIT 1",
    args: [userId, platform, date]
  });
  if (before.rows.length) return Number(before.rows[0].solved);
  const first = await client.execute({
    sql: "SELECT solved FROM platform_history WHERE user_id = ? AND platform = ? ORDER BY date ASC LIMIT 1",
    args: [userId, platform]
  });
  return first.rows.length ? Number(first.rows[0].solved) : null;
}

async function withHistoryProgress(a: AccountRef, stats: PlatformStats, now: Date = new Date()): Promise<PlatformStats> {
  const weekStart = new Date(startOfUtcWeekSeconds(now.getTime()) * 1000).toISOString().slice(0, 10);
  const monthStart = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [weekBase, monthBase] = await Promise.all([
    totalAtOrBefore(a.userId, a.platform, weekStart),
    totalAtOrBefore(a.userId, a.platform, monthStart)
  ]);
  return {
    ...stats,
    weekly: weekBase === null ? 0 : Math.max(0, stats.solved - weekBase),
    monthly: monthBase === null ? 0 : Math.max(0, stats.solved - monthBase)
  };
}

interface AccountRef {
  userId: string;
  platform: PlatformId;
  handle: string;
}

// Fetches and stores one linked account. Returns true when fresh stats were saved.
export async function syncPlatformAccount(a: AccountRef): Promise<boolean> {
  const provider = PROVIDERS[a.platform];
  if (!provider) return false;

  let stats: PlatformStats;
  try {
    stats = await provider(a.handle);
  } catch (err: any) {
    // Keep the old stats rather than guessing. The attempt is recorded so the
    // account is not retried in a loop and an admin can see who is stuck.
    console.warn(`[Platform Sync] ${a.platform}/${a.handle}: ${err.message}`);
    await recordPlatformSyncResult(a.userId, a.platform, {
      ok: false,
      state: err instanceof PlatformNotFoundError ? "not_found" : "unavailable",
      error: err.message
    });
    return false;
  }

  try {
    if (PROGRESS_FROM_HISTORY.has(a.platform)) stats = await withHistoryProgress(a, stats);
    await savePlatformStats(a.userId, a.platform, stats);
  } catch (err: any) {
    // The fetch worked but the database write didn't: not the platform's fault,
    // so it is not recorded as a platform failure.
    console.warn(`[Platform Sync] couldn't save ${a.platform}/${a.handle}: ${err.message}`);
    return false;
  }
  await recordPlatformSyncResult(a.userId, a.platform, { ok: true });
  return true;
}

// Refreshes all of one member's linked accounts (the member's own Refresh button).
export async function syncPlatformAccountsForUser(userId: string): Promise<number> {
  const accounts = await getPlatformAccounts(userId);
  let synced = 0;
  for (const account of Object.values(accounts)) {
    if (!account) continue;
    if (await syncPlatformAccount({ userId, platform: account.platform, handle: account.handle })) synced++;
  }
  return synced;
}

export interface PlatformSyncOptions {
  // Only handle accounts not attempted within this window, stalest first.
  onlyStaleMs?: number;
  // Stop starting new accounts once this much time has passed.
  budgetMs?: number;
}

function lastTouched(a: PlatformAccountRow): number {
  return Math.max(Date.parse(a.lastAttempt ?? "") || 0, Date.parse(a.lastUpdated ?? "") || 0);
}

// Same contract as the LeetCode pass: `partial` is true when the time budget
// ran out before every stale account was handled. Staleness counts the last
// ATTEMPT, so an account whose platform is down is retried after the window
// rather than on every visit.
export async function syncAllPlatformAccounts(
  opts: PlatformSyncOptions = {}
): Promise<{ attempted: number; synced: number; partial: boolean }> {
  let queue = (await listPlatformAccountsForSync()).filter((a) => PROVIDERS[a.platform]);
  if (opts.onlyStaleMs !== undefined) {
    const cutoff = Date.now() - opts.onlyStaleMs;
    queue = queue.filter((a) => !(lastTouched(a) > cutoff)).sort((a, b) => lastTouched(a) - lastTouched(b));
  }

  const startedAt = Date.now();
  let attempted = 0;
  let synced = 0;
  let partial = false;
  for (const account of queue) {
    if (opts.budgetMs !== undefined && Date.now() - startedAt >= opts.budgetMs) {
      partial = true;
      break;
    }
    attempted++;
    if (await syncPlatformAccount(account)) synced++;
  }
  return { attempted, synced, partial };
}
