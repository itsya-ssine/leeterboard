import type { User } from "./types.js";

export type RankingKey = "weekly" | "allTime" | "rating";

export type Movement =
  | { kind: "up" | "down"; places: number }
  | { kind: "same" }
  | { kind: "new" };

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Snapshot = User["history"][number];

// The latest snapshot dated within [minDay, day]. The lower bound stops a
// long-stale snapshot (e.g. from before a run of failed syncs) from being
// treated as "what it was a week ago". Dates are ISO YYYY-MM-DD, so plain
// string comparison orders them correctly.
function snapshotAt(history: User["history"], day: string, minDay: string): Snapshot | null {
  let best: Snapshot | null = null;
  for (const record of history) {
    if (record.date <= day && record.date >= minDay && (best === null || record.date > best.date)) {
      best = record;
    }
  }
  return best;
}

// How far each member has moved since a week ago, under the ranking currently
// shown. The earlier standings are rebuilt from the daily history snapshots:
//   all time → solved count a week ago
//   weekly   → solved a week ago minus solved two weeks ago (last week's sprint)
// Only members present in both standings are compared with each other, so
// someone joining mid-week never pushes the others down. Members who joined
// within the last 7 days are marked "new". Contest ratings aren't kept in
// history, so that ranking shows no movement.
export function computeMovements(
  users: User[],
  sortBy: RankingKey,
  compare: (a: User, b: User) => number,
  nowMs: number
): Record<string, Movement> {
  const result: Record<string, Movement> = {};
  if (sortBy === "rating") return result;

  const weekAgo = isoDay(nowMs - 7 * DAY_MS);
  const twoWeeksAgo = isoDay(nowMs - 14 * DAY_MS);
  const threeWeeksAgo = isoDay(nowMs - 21 * DAY_MS);

  const cohort: { current: User; before: User }[] = [];

  for (const user of users) {
    const weekAgoSnap = snapshotAt(user.history, weekAgo, twoWeeksAgo);

    if (weekAgoSnap === null) {
      const firstSeen = user.history.reduce<string | null>(
        (min, r) => (min === null || r.date < min ? r.date : min),
        null
      );
      if (firstSeen !== null && firstSeen > weekAgo) result[user.id] = { kind: "new" };
      continue;
    }

    // Weekly mode needs last week's sprint, which takes two *different*
    // snapshots. With sparse history one snapshot can be the best match for
    // both dates; treating that as "solved nothing last week" would be wrong,
    // so such members are left out instead.
    const twoWeeksAgoSnap = snapshotAt(user.history, twoWeeksAgo, threeWeeksAgo);
    const hasTwoWeeks = twoWeeksAgoSnap !== null && twoWeeksAgoSnap.date < weekAgoSnap.date;
    if (sortBy === "weekly" && !hasTwoWeeks) continue;

    cohort.push({
      current: user,
      before: {
        ...user,
        allTimeSolved: weekAgoSnap.solvedCount,
        weeklyProgress: hasTwoWeeks ? Math.max(0, weekAgoSnap.solvedCount - twoWeeksAgoSnap!.solvedCount) : 0
      }
    });
  }

  // Nothing to compare against.
  if (cohort.length < 2) return result;

  // Both lists start in the same order, and Array.sort is stable, so members
  // who tie keep the same relative position in both and show no phantom move.
  const nowOrder = cohort.map((c) => c.current).sort(compare);
  const beforeOrder = cohort.map((c) => c.before).sort(compare);

  const nowRank: Record<string, number> = {};
  nowOrder.forEach((u, i) => (nowRank[u.id] = i + 1));
  const beforeRank: Record<string, number> = {};
  beforeOrder.forEach((u, i) => (beforeRank[u.id] = i + 1));

  for (const { current } of cohort) {
    const delta = beforeRank[current.id] - nowRank[current.id]; // positive = climbed
    result[current.id] =
      delta > 0 ? { kind: "up", places: delta } : delta < 0 ? { kind: "down", places: -delta } : { kind: "same" };
  }
  return result;
}
