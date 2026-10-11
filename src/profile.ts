import type { User } from "./types.js";
import type { WeeklyWinner } from "./winners.js";
import { addDays, buildDailyActivity, mondayIndex, type DayActivity } from "./activity.js";

// Pure maths for the member profile page. Kept free of React so it can be
// unit-tested on its own.
//
// Everything is derived from what the board already stores: the member's own
// record plus their history[] snapshots (one cumulative snapshot per UTC day,
// at most ~60). Per-day numbers come from buildDailyActivity() in activity.ts,
// so the profile agrees with the group heatmap on the stats page.

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// Round numbers worth announcing, lowest first.
const MILESTONES = [50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000];

/* ---------- Rankings ---------- */

export type RankKey = "allTime" | "weekly" | "monthly" | "rating" | "streak";

// Same ordering rules as the leaderboard (App.tsx compareUsers) for the three
// rankings it has, plus monthly and best-streak for the profile. Not imported
// from App.tsx to avoid a circular import.
function comparator(key: RankKey) {
  return (a: User, b: User): number => {
    const bySolved = b.allTimeSolved - a.allTimeSolved;
    switch (key) {
      case "rating": {
        const ar = a.contestRating;
        const br = b.contestRating;
        if (ar != null && br == null) return -1;
        if (ar == null && br != null) return 1;
        if (ar != null && br != null && ar !== br) return br - ar;
        return bySolved;
      }
      case "weekly":
        return b.weeklyProgress - a.weeklyProgress || bySolved;
      case "monthly":
        return b.monthlyProgress - a.monthlyProgress || bySolved;
      case "streak":
        return (b.longestStreak ?? -1) - (a.longestStreak ?? -1) || bySolved;
      default:
        return bySolved || b.weeklyProgress - a.weeklyProgress;
    }
  };
}

export interface RankInfo {
  key: RankKey;
  label: string;
  rank: number | null; // null = not ranked (e.g. unrated, streak unknown)
  of: number;
  // "Top 12%" — smaller is better. null when unranked.
  topPercent: number | null;
  value: string;
}

export function rankOf(users: User[], user: User, key: RankKey): { rank: number | null; of: number } {
  let pool = users;
  if (key === "rating") pool = users.filter((u) => u.contestRating != null);
  if (key === "streak") pool = users.filter((u) => u.longestStreak != null);
  const sorted = [...pool].sort(comparator(key));
  const idx = sorted.findIndex((u) => u.id === user.id);
  return { rank: idx === -1 ? null : idx + 1, of: pool.length };
}

function rankInfo(users: User[], user: User, key: RankKey, label: string, value: string): RankInfo {
  const { rank, of } = rankOf(users, user, key);
  return {
    key,
    label,
    rank,
    of,
    topPercent: rank == null || of === 0 ? null : Math.max(1, Math.ceil((rank / of) * 100)),
    value
  };
}

/* ---------- Daily / weekly series ---------- */

export interface WeekBucket {
  weekStart: string; // the Monday (UTC)
  solved: number;
  tracked: boolean; // at least one tracked day in the week
  partial: boolean; // week started before tracking began, or is still running
  current: boolean;
  won: boolean; // top solver of the board that week
}

export interface Neighbour {
  user: User;
  gap: number; // problems between them and the member (always >= 0)
}

export interface Milestone {
  target: number;
  remaining: number;
  etaDays: number | null; // at the last-30-days pace; null when there is no pace
  previous: number; // last milestone already passed (0 if none)
}

export interface DifficultyMix {
  easy: number;
  medium: number;
  hard: number;
}

export interface ProfileStats {
  today: string;
  daily: DayActivity[]; // last 60 days, oldest first
  hasHistory: boolean;
  trackedSince: string | null;

  ranks: RankInfo[];
  neighbours: { above: Neighbour | null; below: Neighbour | null };

  // Last 30 tracked days
  sum30: number;
  trackedDays30: number;
  activeDays30: number;
  consistency: number | null; // % of tracked days with at least one solve
  avgPerDay: number | null;
  avgPerActiveDay: number | null;

  bestDay: { date: string; solved: number } | null;
  bestWeek: { weekStart: string; solved: number } | null;
  lastActive: string | null;
  idleDays: number | null;

  thisWeek: number;
  lastWeek: number | null;
  weekDelta: number | null;
  weeks: WeekBucket[]; // last 8 weeks, oldest first
  weekdayAvg: (number | null)[]; // Mon..Sun: average solved on that weekday
  bestWeekday: number | null; // index into WEEKDAYS

  milestone: Milestone | null;
  gained30: DifficultyMix | null; // easy/medium/hard solved over the last 30 days
  hardShare: number; // 0..1
  rosterAvg: DifficultyMix | null; // average per member

  wins: WeeklyWinner[]; // weeks this member topped the board, newest first
  joinedOrder: number | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function computeProfile(
  user: User,
  users: User[],
  winners: WeeklyWinner[],
  nowMs: number
): ProfileStats {
  const today = isoDay(nowMs);
  const start = addDays(today, -59);
  const daily = buildDailyActivity([user], start, today);
  const tracked = daily.filter((d) => d.tracked);
  const trackedSince = (user.history ?? []).reduce<string | null>(
    (min, r) => (min === null || r.date < min ? r.date : min),
    null
  );

  /* last 30 tracked days */
  const last30 = tracked.slice(-30);
  const sum30 = sum(last30.map((d) => d.solved));
  const activeDays30 = last30.filter((d) => d.solved > 0).length;
  const consistency = last30.length > 0 ? Math.round((activeDays30 / last30.length) * 100) : null;
  const avgPerDay = last30.length > 0 ? sum30 / last30.length : null;
  const avgPerActiveDay = activeDays30 > 0 ? sum30 / activeDays30 : null;

  /* records */
  const bestDayRow = tracked.reduce<DayActivity | null>((b, d) => (!b || d.solved > b.solved ? d : b), null);
  const bestDay = bestDayRow && bestDayRow.solved > 0 ? { date: bestDayRow.date, solved: bestDayRow.solved } : null;
  const activeDays = tracked.filter((d) => d.solved > 0);
  const lastActive = activeDays.length > 0 ? activeDays[activeDays.length - 1].date : null;
  const idleDays =
    lastActive === null ? null : Math.max(0, Math.round((Date.parse(today) - Date.parse(lastActive)) / DAY_MS));

  /* weeks (Monday-first, like the heatmap and the hall of fame) */
  const byWeek = new Map<string, { solved: number; tracked: number; days: number }>();
  for (const d of daily) {
    const wk = addDays(d.date, -mondayIndex(d.date));
    const cur = byWeek.get(wk) ?? { solved: 0, tracked: 0, days: 0 };
    cur.solved += d.solved;
    cur.days += 1;
    if (d.tracked) cur.tracked += 1;
    byWeek.set(wk, cur);
  }
  const thisMonday = addDays(today, -mondayIndex(today));
  const wonWeeks = new Set(winners.filter((w) => w.userId === user.id).map((w) => w.weekStart));
  const weeks: WeekBucket[] = [];
  for (let k = 7; k >= 0; k--) {
    const weekStart = addDays(thisMonday, -7 * k);
    const b = byWeek.get(weekStart);
    weeks.push({
      weekStart,
      solved: b?.solved ?? 0,
      tracked: (b?.tracked ?? 0) > 0,
      partial: k === 0 || (b ? b.tracked < 7 : true),
      current: k === 0,
      won: wonWeeks.has(weekStart)
    });
  }

  const finished = weeks.filter((w) => w.tracked && !w.current && !w.partial);
  const bestWeekRow = finished.reduce<WeekBucket | null>((b, w) => (!b || w.solved > b.solved ? w : b), null);
  const bestWeek = bestWeekRow && bestWeekRow.solved > 0 ? { weekStart: bestWeekRow.weekStart, solved: bestWeekRow.solved } : null;

  const prevWeek = weeks[weeks.length - 2];
  const lastWeek = prevWeek && prevWeek.tracked && !prevWeek.partial ? prevWeek.solved : null;
  const weekDelta = lastWeek === null ? null : user.weeklyProgress - lastWeek;

  /* weekday pattern */
  const wdSum = Array<number>(7).fill(0);
  const wdCount = Array<number>(7).fill(0);
  for (const d of tracked) {
    const i = mondayIndex(d.date);
    wdSum[i] += d.solved;
    wdCount[i] += 1;
  }
  const weekdayAvg = wdSum.map((s, i) => (wdCount[i] > 0 ? s / wdCount[i] : null));
  let bestWeekday: number | null = null;
  weekdayAvg.forEach((v, i) => {
    if (v != null && v > 0 && (bestWeekday === null || v > (weekdayAvg[bestWeekday] ?? 0))) bestWeekday = i;
  });

  /* next milestone */
  let milestone: Milestone | null = null;
  const next = MILESTONES.find((m) => m > user.allTimeSolved);
  if (next !== undefined) {
    const remaining = next - user.allTimeSolved;
    const previous = [...MILESTONES].reverse().find((m) => m <= user.allTimeSolved) ?? 0;
    milestone = {
      target: next,
      remaining,
      previous,
      etaDays: avgPerDay && avgPerDay > 0 ? Math.ceil(remaining / avgPerDay) : null
    };
  }

  /* difficulty over the last 30 days, from the first snapshot in the window */
  const cutoff = isoDay(nowMs - 30 * DAY_MS);
  const hist = [...(user.history ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const inWindow = hist.filter((h) => h.date >= cutoff);
  let gained30: DifficultyMix | null = null;
  if (inWindow.length >= 2) {
    const a = inWindow[0];
    const b = inWindow[inWindow.length - 1];
    gained30 = {
      easy: Math.max(0, b.easy - a.easy),
      medium: Math.max(0, b.medium - a.medium),
      hard: Math.max(0, b.hard - a.hard)
    };
  }

  const total = Math.max(1, user.easySolved + user.mediumSolved + user.hardSolved);
  const rosterAvg: DifficultyMix | null =
    users.length > 0
      ? {
          easy: sum(users.map((u) => u.easySolved)) / users.length,
          medium: sum(users.map((u) => u.mediumSolved)) / users.length,
          hard: sum(users.map((u) => u.hardSolved)) / users.length
        }
      : null;

  /* neighbours in the all-time ranking */
  const ordered = [...users].sort(comparator("allTime"));
  const idx = ordered.findIndex((u) => u.id === user.id);
  const above = idx > 0 ? ordered[idx - 1] : null;
  const below = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;

  const ratingValue = user.contestRating != null ? user.contestRating.toLocaleString() : "Unrated";
  const ranks = [
    rankInfo(users, user, "allTime", "All time", `${user.allTimeSolved.toLocaleString()} solved`),
    rankInfo(users, user, "weekly", "This week", `+${user.weeklyProgress}`),
    rankInfo(users, user, "monthly", "This month", `+${user.monthlyProgress}`),
    rankInfo(users, user, "rating", "Contest", ratingValue),
    rankInfo(users, user, "streak", "Best streak", user.longestStreak != null ? `${user.longestStreak} days` : "–")
  ];

  return {
    today,
    daily,
    hasHistory: tracked.length > 0,
    trackedSince,
    ranks,
    neighbours: {
      above: above ? { user: above, gap: Math.max(0, above.allTimeSolved - user.allTimeSolved) } : null,
      below: below ? { user: below, gap: Math.max(0, user.allTimeSolved - below.allTimeSolved) } : null
    },
    sum30,
    trackedDays30: last30.length,
    activeDays30,
    consistency,
    avgPerDay,
    avgPerActiveDay,
    bestDay,
    bestWeek,
    lastActive,
    idleDays,
    thisWeek: user.weeklyProgress,
    lastWeek,
    weekDelta,
    weeks,
    weekdayAvg,
    bestWeekday,
    milestone,
    gained30,
    hardShare: user.hardSolved / total,
    rosterAvg,
    wins: winners.filter((w) => w.userId === user.id).sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    joinedOrder: user.joinOrder ?? null
  };
}
