import type { HistoryRecord, User } from "../../shared/types.js";

/**
 * Calculates problems solved over the last `days` days.
 * Linearly interpolated between the two snapshots that bracket it
 * (the current total counts as a snapshot taken now).
 * A gap in history is spread over the days it covers instead of dumped into the window.
 * If the member joined inside the window, progress is measured from their joined baseline.
 * Monotonic guard: lower live total (e.g. solve revocation) never produces negative progress.
 * Returns null when there is no history at all.
 */
export function computeProgressFromHistory(
  history: HistoryRecord[],
  currentTotal: number,
  days: number,
  now: number = Date.now(),
  joined?: { date: string; solved: number }
): number | null {
  if (!history || history.length === 0) return null;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const endOfToday = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS - 1;
  const target = endOfToday - days * DAY_MS;

  // One point per date; a snapshot represents the total at the end of its
  // UTC day (overwritten by later syncs that day), capped at `now`.
  const byDate = new Map<string, { t: number; count: number }>();
  for (const r of history) {
    const t = Date.parse(`${r.date}T23:59:59.999Z`);
    if (!Number.isFinite(t) || t > now) continue;
    byDate.set(r.date, { t, count: r.solvedCount });
  }

  // The member's total when they joined is the earliest known point, taken at
  // the start of their joining day.
  if (joined && /^\d{4}-\d{2}-\d{2}$/.test(joined.date)) {
    const t = Date.parse(`${joined.date}T00:00:00.000Z`);
    if (Number.isFinite(t) && t <= now) byDate.set(`joined:${joined.date}`, { t, count: joined.solved });
  }
  const points = [...byDate.values()].sort((a, b) => a.t - b.t);

  // Live total is the newest point.
  points.push({ t: now, count: currentTotal });

  let before: { t: number; count: number } | null = null;
  let after: { t: number; count: number } | null = null;
  for (const p of points) {
    if (p.t <= target) before = p;
    else {
      after = p;
      break;
    }
  }

  let baseline: number;
  if (!before) {
    baseline = points[0].count; // tracking started inside the window
  } else if (!after || after.t === before.t) {
    baseline = before.count;
  } else {
    const ratio = (target - before.t) / (after.t - before.t);
    baseline = before.count + (after.count - before.count) * ratio;
  }

  return Math.max(0, Math.round(currentTotal - baseline));
}

/**
 * A member's starting point for progress maths (see User.trackingStart).
 */
export function baselineOf(user: User): { date: string; solved: number } {
  return { date: user.trackingStart, solved: user.baselineSolved };
}

/**
 * Number of UTC days in the current Monday-to-Sunday week, up to and including
 * today: 1 on Monday, 7 on Sunday.
 */
export function daysIntoWeek(now: number = Date.now()): number {
  return ((new Date(now).getUTCDay() + 6) % 7) + 1;
}

/**
 * Problems solved so far in the current calendar week (Monday 00:00 UTC to now).
 * Baseline is the total at the end of last Sunday, so counter starts from 0 for everyone on Monday.
 */
export function computeWeeklyProgressFromHistory(
  history: HistoryRecord[],
  currentTotal: number,
  now: number = Date.now(),
  joined?: { date: string; solved: number }
): number | null {
  return computeProgressFromHistory(history, currentTotal, daysIntoWeek(now), now, joined);
}
