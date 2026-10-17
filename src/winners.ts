import type { User } from "./types.js";

// One entry per finished week: who solved the most, and how many. Only the id
// is kept, so names and avatars always come from the member's current profile
// and a member who leaves the board takes their wins with them.
export interface WeeklyWinner {
  weekStart: string; // the Monday, ISO YYYY-MM-DD (UTC)
  userId: string;
  gained: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

// A snapshot has to be this close to the edge of a week to count as "the start"
// or "the end" of it. Anything older would credit a member with days that
// belong to a different week (e.g. after a run of failed syncs).
const EDGE_DAYS = 3;

// How many finished weeks to look back over when rebuilding from history.
const LOOKBACK_WEEKS = 8;

// How many winners the stored archive keeps.
const ARCHIVE_LIMIT = 52;

export function addDays(iso: string, days: number): string {
  return isoDay(dayMs(iso) + days * DAY_MS);
}

// Weeks run Monday to Sunday, in UTC like the history snapshots.
export function weekStartOf(ms: number): string {
  const d = new Date(ms);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - sinceMonday * DAY_MS);
}

// The Monday of the most recent finished week.
export function lastWeekStart(nowMs: number): string {
  return addDays(weekStartOf(nowMs), -7);
}

type Snapshot = User["history"][number];

// Latest snapshot dated within [minDay, maxDay]; ISO dates compare as strings.
function latestBetween(history: User["history"], minDay: string, maxDay: string): Snapshot | null {
  let best: Snapshot | null = null;
  for (const record of history) {
    if (record.date >= minDay && record.date <= maxDay && (best === null || record.date > best.date)) {
      best = record;
    }
  }
  return best;
}

// Winners of the last few finished weeks, newest first, rebuilt from the daily
// history snapshots. A member's score for a week is their solved count at the
// end of it minus their count at the end of the week before, so:
//  - members who joined mid-week are scored from the total they had when they
//    joined (their first week runs from the joining day to Sunday);
//  - members with no snapshot near either edge are skipped rather than guessed;
//  - weeks nobody improved in have no winner.
// Ties go to whoever has solved more overall, then alphabetically.
export function computeWeeklyWinners(users: User[], nowMs: number, weeks = LOOKBACK_WEEKS): WeeklyWinner[] {
  const winners: WeeklyWinner[] = [];
  const thisWeek = weekStartOf(nowMs);

  for (let k = 1; k <= weeks; k++) {
    const weekStart = addDays(thisWeek, -7 * k);
    const weekEnd = addDays(weekStart, 6);

    let best: { user: User; gained: number } | null = null;
    for (const user of users) {
      const before = latestBetween(user.history, addDays(weekStart, -EDGE_DAYS), addDays(weekStart, -1));
      const after = latestBetween(user.history, addDays(weekEnd, -(EDGE_DAYS - 1)), weekEnd);
      // A member who joined during this week has no snapshot before it, so
      // their score is measured from the total they had when they joined: their
      // first week runs from the joining day to Sunday.
      const joinedThisWeek =
        !before && !!user.trackingStart && user.trackingStart >= weekStart && user.trackingStart <= weekEnd;
      const startCount = before ? before.solvedCount : joinedThisWeek ? user.baselineSolved : null;
      if (startCount === null || !after) continue;

      const gained = after.solvedCount - startCount;
      if (gained <= 0) continue;

      if (
        best === null ||
        gained > best.gained ||
        (gained === best.gained &&
          (user.allTimeSolved > best.user.allTimeSolved ||
            (user.allTimeSolved === best.user.allTimeSolved &&
              user.displayName.localeCompare(best.user.displayName) < 0)))
      ) {
        best = { user, gained };
      }
    }

    if (best) winners.push({ weekStart, userId: best.user.id, gained: best.gained });
  }
  return winners;
}

export interface WinnerTally {
  userId: string;
  wins: number; // number of weeks they were the top solver
  lastWin: string; // Monday of their most recent winning week
}

// One entry per member who has ever won a week, with how many weeks they won.
// Most wins first; ties go to whoever won most recently.
export function tallyWinners(winners: WeeklyWinner[]): WinnerTally[] {
  const byUser = new Map<string, WinnerTally>();
  for (const w of winners) {
    const t = byUser.get(w.userId);
    if (!t) byUser.set(w.userId, { userId: w.userId, wins: 1, lastWin: w.weekStart });
    else {
      t.wins += 1;
      if (w.weekStart > t.lastWin) t.lastWin = w.weekStart;
    }
  }
  return [...byUser.values()].sort(
    (a, b) => b.wins - a.wins || b.lastWin.localeCompare(a.lastWin) || a.userId.localeCompare(b.userId)
  );
}

// History only keeps ~60 daily snapshots, so winners are archived once they're
// known and the archive is what the hall of fame reads from. For a week that is
// already archived the stored entry wins: later recomputation (with older
// snapshots trimmed away) must not rewrite history.
export function mergeWinnerArchive(stored: WeeklyWinner[], computed: WeeklyWinner[]): WeeklyWinner[] {
  const byWeek = new Map<string, WeeklyWinner>();
  for (const w of computed) byWeek.set(w.weekStart, w);
  for (const w of stored) byWeek.set(w.weekStart, w);
  return [...byWeek.values()]
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .slice(0, ARCHIVE_LIMIT);
}

// Reads the archive back from its JSON form, dropping anything malformed.
export function parseWinnerArchive(raw: string | null): WeeklyWinner[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w): w is WeeklyWinner =>
        !!w &&
        typeof w.weekStart === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(w.weekStart) &&
        typeof w.userId === "string" &&
        Number.isFinite(w.gained)
    );
  } catch {
    return [];
  }
}
