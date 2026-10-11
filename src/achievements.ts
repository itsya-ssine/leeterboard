import type { User } from "./types.js";

export interface Badge {
  id: string;
  label: string;
  description: string;
  earned: boolean;
  // Short "42/100"-style hint for locked badges; empty for one-off badges.
  progress: string;
}

// Badges that depend on how a member compares with everyone else. Each is held
// by at most one member at a time, so they're worked out once for the whole
// board (computeGroupAwards) and then passed to computeBadges.
export interface GroupAwards {
  mostImprovedId: string | null;
  firstJoinedId: string | null;
}

export const NO_AWARDS: GroupAwards = { mostImprovedId: null, firstJoinedId: null };

const SOLVED_MILESTONES = [100, 500, 1000] as const;
const STREAK_BADGE_DAYS = 7;

// Contest rating tiers, lowest first. Knight and Guardian are LeetCode's own
// named tiers; the two below them are intermediate steps.
const CONTEST_TIERS = [
  { min: 1500, label: "Rated 1500+" },
  { min: 1700, label: "Rated 1700+" },
  { min: 1850, label: "Knight" },
  { min: 2150, label: "Guardian" }
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

// Needs at least this many members with enough history to compare, and a real
// amount of solving, before "most improved" is awarded.
const MIN_COMPARABLE_MEMBERS = 2;
const MIN_RECENT_GAIN = 5;

type Snapshot = User["history"][number];

// How much faster (in problems per 30 days) a member is solving over the last
// month than over the month before it, or null if their history doesn't cover
// both periods. Rates are used instead of raw gains so a member whose earlier
// period is a few days shorter (history is capped at ~60 snapshots) isn't
// penalised for it.
function paceChange(user: User, nowMs: number): { delta: number; recentGain: number } | null {
  const today = isoDay(nowMs);

  // A snapshot from about a month ago…
  let mid: Snapshot | null = null;
  // …and the oldest one we have, as the start of the earlier period.
  let start: Snapshot | null = null;
  const midMin = isoDay(nowMs - 36 * DAY_MS);
  const midMax = isoDay(nowMs - 28 * DAY_MS);
  const startMin = isoDay(nowMs - 75 * DAY_MS);
  for (const r of user.history) {
    if (r.date >= midMin && r.date <= midMax && (mid === null || r.date > mid.date)) mid = r;
    if (r.date >= startMin && (start === null || r.date < start.date)) start = r;
  }
  if (!mid || !start) return null;

  const prevDays = daysBetween(start.date, mid.date);
  const recentDays = daysBetween(mid.date, today);
  if (prevDays < 21 || recentDays < 21) return null;

  const recentGain = user.allTimeSolved - mid.solvedCount;
  const prevGain = mid.solvedCount - start.solvedCount;
  const delta = Math.round((recentGain / recentDays - prevGain / prevDays) * 30);
  return { delta, recentGain };
}

export function computeGroupAwards(users: User[], nowMs: number): GroupAwards {
  const awards: GroupAwards = { mostImprovedId: null, firstJoinedId: null };

  // First on the board: the earliest member still here. Meaningless for a
  // board of one, so it needs company.
  if (users.length >= 2) {
    let first: User | null = null;
    for (const u of users) {
      if (u.joinOrder != null && (first === null || u.joinOrder < (first.joinOrder ?? Infinity))) first = u;
    }
    awards.firstJoinedId = first?.id ?? null;
  }

  // Most improved this month: the biggest jump in solving pace.
  const scored: { user: User; delta: number; recentGain: number }[] = [];
  for (const user of users) {
    const change = paceChange(user, nowMs);
    if (change) scored.push({ user, ...change });
  }
  if (scored.length >= MIN_COMPARABLE_MEMBERS) {
    let best: (typeof scored)[number] | null = null;
    for (const s of scored) {
      if (s.delta <= 0 || s.recentGain < MIN_RECENT_GAIN) continue;
      if (
        best === null ||
        s.delta > best.delta ||
        (s.delta === best.delta && s.recentGain > best.recentGain)
      ) {
        best = s;
      }
    }
    awards.mostImprovedId = best?.user.id ?? null;
  }

  return awards;
}

// One badge for the contest tier: the highest tier reached when there is one,
// otherwise the first tier as a goal.
function contestTierBadge(rating: number | null): Badge {
  const reached = [...CONTEST_TIERS].reverse().find((t) => rating != null && rating >= t.min);
  if (reached) {
    const next = CONTEST_TIERS.find((t) => t.min > reached.min);
    return {
      id: "contest-tier",
      label: reached.label,
      description: `Contest rating of ${reached.min}+${next ? `. Next tier: ${next.label} at ${next.min}` : ""}`,
      earned: true,
      progress: ""
    };
  }
  const first = CONTEST_TIERS[0];
  return {
    id: "contest-tier",
    label: first.label,
    description: `Reach a contest rating of ${first.min}`,
    earned: false,
    progress: rating == null ? "" : `${rating}/${first.min}`
  };
}

// `longestStreak` is LeetCode's own streak data (see fetchStreaks in
// server.ts); null means it hasn't been fetched yet.
export function computeBadges(user: User, awards: GroupAwards = NO_AWARDS): Badge[] {
  const longest = user.longestStreak ?? 0;

  const solvedBadges: Badge[] = SOLVED_MILESTONES.map((target) => ({
    id: `solved-${target}`,
    label: `${target.toLocaleString()} solved`,
    description: `Solve ${target.toLocaleString()} problems`,
    earned: user.allTimeSolved >= target,
    progress: `${Math.min(user.allTimeSolved, target)}/${target}`
  }));

  const badges: Badge[] = [
    ...solvedBadges,
    {
      id: "first-hard",
      label: "First Hard",
      description: "Solve your first Hard problem",
      earned: user.hardSolved >= 1,
      progress: ""
    },
    {
      id: "first-contest",
      label: "First contest",
      description: "Take part in a LeetCode contest",
      earned: user.contestsAttended >= 1 || user.contestRating != null,
      progress: ""
    },
    contestTierBadge(user.contestRating),
    {
      id: "streak-7",
      label: "7-day streak",
      description: `Submit on ${STREAK_BADGE_DAYS} days in a row on LeetCode`,
      earned: longest >= STREAK_BADGE_DAYS,
      progress: user.longestStreak == null ? "" : `${Math.min(longest, STREAK_BADGE_DAYS)}/${STREAK_BADGE_DAYS}`
    },
    {
      id: "most-improved",
      label: "Most improved",
      description: "Biggest jump in solving pace this month compared with the month before",
      earned: awards.mostImprovedId === user.id,
      progress: ""
    }
  ];

  // Can't be worked towards, so it only appears for the member who holds it
  // instead of sitting locked on everyone else's profile.
  if (awards.firstJoinedId === user.id) {
    badges.push({
      id: "first-on-board",
      label: "First on the board",
      description: "The first member to join the board",
      earned: true,
      progress: ""
    });
  }

  return badges;
}
