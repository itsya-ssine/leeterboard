// Trend data for GET /api/trends?platform=<id>, in the same shape the LeetCode
// trend has, so the Stats page can draw either one with the same chart.
//
// Only members who linked the platform count. Everyone is measured against
// their own first snapshot (taken when the account was linked), so a member who
// links an account with 1,000 problems already solved contributes 0 on that day
// and only their later solves add to the group's growth.

import { client } from "./db.js";
import type { PlatformId, User } from "./src/types.js";

interface Snapshot {
  date: string;
  solved: number;
}

const DIFFICULTY_COLORS = { Easy: "#10b981", Medium: "#f59e0b", Hard: "#ef4444" } as const;

function bucketCount(extra: Record<string, unknown> | undefined, key: string): number {
  const buckets = extra?.buckets as Record<string, unknown> | undefined;
  const v = buckets?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export async function buildPlatformTrend(platform: PlatformId, users: User[]) {
  const members = users
    .map((user) => ({ user, account: user.platforms?.[platform] }))
    .filter((m): m is { user: User; account: NonNullable<typeof m.account> } => m.account !== undefined);

  // One query for every member's snapshots on this platform.
  const res = await client.execute({
    sql: "SELECT user_id, date, solved FROM platform_history WHERE platform = ? ORDER BY user_id, date",
    args: [platform]
  });
  const byUser = new Map<string, Snapshot[]>();
  for (const r of res.rows as unknown as Record<string, unknown>[]) {
    const id = r.user_id as string;
    const snap: Snapshot = { date: r.date as string, solved: Number(r.solved) };
    const list = byUser.get(id);
    if (list) list.push(snap);
    else byUser.set(id, [snap]);
  }

  const histories = members
    .map((m) => byUser.get(m.user.id) ?? [])
    .filter((h) => h.length > 0);

  const allDates = new Set<string>();
  histories.forEach((h) => h.forEach((s) => allDates.add(s.date)));
  const sortedDates = [...allDates].sort();

  const historyTrend = sortedDates.map((date) => {
    let growth = 0;
    let activeUsers = 0;
    for (const h of histories) {
      const first = h[0];
      if (date < first.date) continue; // not linked yet
      // Latest snapshot at or before this date (carries over missed days).
      let latest = first;
      for (const s of h) {
        if (s.date <= date) latest = s;
        else break;
      }
      growth += Math.max(0, latest.solved - first.solved);
      activeUsers += 1;
    }
    return { date, solved: growth, activeUsers };
  });

  // Difficulty buckets exist for platforms that report them (Codeforces, by
  // problem rating). Without any, the list is empty and the UI hides the bar.
  let easy = 0;
  let medium = 0;
  let hard = 0;
  for (const { account } of members) {
    easy += bucketCount(account.extra, "easy");
    medium += bucketCount(account.extra, "medium");
    hard += bucketCount(account.extra, "hard");
  }
  const difficultyBreakdown =
    easy + medium + hard > 0
      ? [
          { name: "Easy", value: easy, color: DIFFICULTY_COLORS.Easy },
          { name: "Medium", value: medium, color: DIFFICULTY_COLORS.Medium },
          { name: "Hard", value: hard, color: DIFFICULTY_COLORS.Hard }
        ]
      : [];

  let topSolver = "None";
  let topCount = 0;
  for (const { user, account } of members) {
    if (account.weeklySolved > topCount) {
      topCount = account.weeklySolved;
      topSolver = user.displayName;
    }
  }

  return {
    historyTrend,
    difficultyBreakdown,
    topSolverThisWeek: topSolver,
    topSolverThisWeekCount: topCount,
    totalSolved: members.reduce((acc, m) => acc + m.account.solved, 0)
  };
}
