// Pure streak maths for LeetCode's submission calendar. Kept free of I/O so it
// can be unit-tested; the network side lives in server.ts (fetchStreaks).

export const DAY_SECONDS = 86_400;

export interface StreakInfo {
  current: number;
  longest: number;
}

// LeetCode's submissionCalendar is a JSON string mapping a UTC-midnight unix
// timestamp (seconds) to the number of submissions that day, e.g.
// '{"1759449600": 3, "1759536000": 1}'. Returns the UTC day indexes
// (timestamp / 86400) that had at least one submission, or null if the value
// isn't in that shape — callers must treat null as "no answer", never as
// "no activity".
export function parseSubmissionCalendar(raw: unknown): number[] | null {
  if (typeof raw !== "string") return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;

  const days: number[] = [];
  for (const [ts, count] of Object.entries(obj as Record<string, unknown>)) {
    const t = Number(ts);
    if (Number.isFinite(t) && Number(count) > 0) days.push(Math.floor(t / DAY_SECONDS));
  }
  return days;
}

// `days` may span several calendar years; duplicates are fine. The current
// streak stays alive if the latest active day is today or yesterday (the same
// rule LeetCode's profile uses), and drops to 0 once a full day is missed.
export function streaksFromDays(days: Iterable<number>, todayIdx: number): StreakInfo {
  const sorted = [...new Set(days)].filter((d) => d <= todayIdx).sort((a, b) => a - b);

  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  const current = prev !== null && prev >= todayIdx - 1 ? run : 0;
  return { current, longest };
}
