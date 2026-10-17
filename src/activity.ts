import type { HistoryRecord, User } from "./types.js";

// Pure maths for the group activity heatmap. Kept free of React so it can be
// unit-tested on its own.
//
// `history[]` stores one cumulative snapshot per UTC day (solvedCount is the
// all-time total at that day's last sync), so the number solved on a day is
// the difference between consecutive snapshots. Syncs can be sparse: a gap of
// N days between two snapshots is spread evenly over those N days rather than
// dumped on the last one (same approach as computeProgressFromHistory in
// server.ts).

const DAY_MS = 86_400_000;

export interface DayActivity {
  date: string; // YYYY-MM-DD (UTC)
  solved: number; // problems solved by the whole roster that day
  // false when no cadet was being tracked yet. That is "no data", which is
  // different from a tracked day where nobody solved anything.
  tracked: boolean;
}

const dayIndex = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoFromIndex = (idx: number): string => new Date(idx * DAY_MS).toISOString().slice(0, 10);

// Per-day solved counts for one cadet, plus the first day we have a snapshot
// for. The first snapshot is only a baseline: it says what the total was, not
// how much was solved that day, so activity starts on the day after it.
function dailyFromHistory(
  history: HistoryRecord[],
  trackingStart?: string,
  baselineSolved?: number
): { days: Map<number, number>; firstIdx: number } | null {
  const byDay = new Map<number, number>();
  for (const r of history ?? []) {
    const idx = dayIndex(r.date);
    if (Number.isFinite(idx) && Number.isFinite(r.solvedCount)) byDay.set(idx, r.solvedCount);
  }
  const points = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  if (points.length === 0) return null;

  const days = new Map<number, number>();
  let firstIdx = points[0][0];

  // Joining day: the member's total when they joined is the real baseline, so
  // what they solved after joining that same day counts as activity, and the
  // day itself is tracked instead of starting from the day after.
  if (trackingStart && baselineSolved != null && dayIndex(trackingStart) === firstIdx) {
    days.set(firstIdx, Math.max(0, points[0][1] - baselineSolved));
    firstIdx -= 1;
  }

  for (let i = 1; i < points.length; i++) {
    const [prevIdx, prevCount] = points[i - 1];
    const [idx, count] = points[i];
    // Never negative: LeetCode can revoke solves, which must not subtract
    // from other cadets' activity.
    const per = Math.max(0, count - prevCount) / (idx - prevIdx);
    for (let d = prevIdx + 1; d <= idx; d++) days.set(d, per);
  }
  return { days, firstIdx };
}

// One entry per UTC day from `startDate` to `endDate` inclusive, summed over
// every cadet. Fractions from spread-out gaps are rounded once, per day, after
// summing.
export function buildDailyActivity(users: User[], startDate: string, endDate: string): DayActivity[] {
  const perUser = users.map((u) => dailyFromHistory(u.history, u.trackingStart, u.baselineSolved)).filter((x) => x !== null);
  const firstTracked = perUser.length > 0 ? Math.min(...perUser.map((p) => p.firstIdx)) : Infinity;

  const out: DayActivity[] = [];
  for (let d = dayIndex(startDate); d <= dayIndex(endDate); d++) {
    let sum = 0;
    for (const p of perUser) sum += p.days.get(d) ?? 0;
    out.push({ date: isoFromIndex(d), solved: Math.round(sum), tracked: d > firstTracked });
  }
  return out;
}

// Monday = 0 … Sunday = 6, for a calendar whose weeks start on Monday.
export function mondayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function addDays(iso: string, n: number): string {
  return isoFromIndex(dayIndex(iso) + n);
}
