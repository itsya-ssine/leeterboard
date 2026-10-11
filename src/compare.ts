import type { User } from "./types.js";

export type Side = "a" | "b" | null;

export interface CompareRow {
  id: string;
  label: string;
  a: number | null;
  b: number | null;
  leader: Side;
  // How to print the value: "plus" = +N (progress), "days" = N days.
  format: "number" | "plus" | "days";
}

interface RowDef {
  id: string;
  label: string;
  get: (u: User) => number | null;
  format: CompareRow["format"];
  // For contest rating: having one beats not having one. For streaks null means
  // "not fetched yet", so nothing can be said and nobody leads.
  unknownLoses?: boolean;
}

const ROWS: RowDef[] = [
  { id: "solved", label: "Problems solved", get: (u) => u.allTimeSolved, format: "number" },
  { id: "easy", label: "Easy", get: (u) => u.easySolved, format: "number" },
  { id: "medium", label: "Medium", get: (u) => u.mediumSolved, format: "number" },
  { id: "hard", label: "Hard", get: (u) => u.hardSolved, format: "number" },
  { id: "weekly", label: "This week", get: (u) => u.weeklyProgress, format: "plus" },
  { id: "monthly", label: "This month", get: (u) => u.monthlyProgress, format: "plus" },
  { id: "rating", label: "Contest rating", get: (u) => (u.contestRating == null ? null : Math.round(u.contestRating)), format: "number", unknownLoses: true },
  { id: "contests", label: "Contests attended", get: (u) => u.contestsAttended, format: "number" },
  { id: "streak", label: "Current streak", get: (u) => u.currentStreak, format: "days" },
  { id: "longest", label: "Longest streak", get: (u) => u.longestStreak, format: "days" }
];

function leaderOf(a: number | null, b: number | null, unknownLoses: boolean): Side {
  if (a == null && b == null) return null;
  if (a == null || b == null) {
    if (!unknownLoses) return null;
    return a == null ? "b" : "a";
  }
  if (a === b) return null;
  return a > b ? "a" : "b";
}

// Every stat side by side, with who is ahead in each. Higher is better in all
// of them.
export function compareStats(a: User, b: User): CompareRow[] {
  return ROWS.map((def) => {
    const av = def.get(a);
    const bv = def.get(b);
    return { id: def.id, label: def.label, a: av, b: bv, leader: leaderOf(av, bv, !!def.unknownLoses), format: def.format };
  });
}

export function tallyLeads(rows: CompareRow[]): { a: number; b: number; tied: number } {
  const t = { a: 0, b: 0, tied: 0 };
  for (const r of rows) {
    if (r.leader === "a") t.a++;
    else if (r.leader === "b") t.b++;
    else t.tied++;
  }
  return t;
}

// Share of the bar given to the left-hand member, or null when a bar would say
// nothing (a value is unknown, or both are zero).
export function barShare(row: CompareRow): number | null {
  if (row.a == null || row.b == null) return null;
  const total = row.a + row.b;
  return total > 0 ? row.a / total : null;
}

export interface HistoryPoint {
  date: string;
  a: number;
  b: number;
}

export type HistoryMode = "gained" | "total";

type Snapshot = User["history"][number];

// Latest snapshot dated on or before `date`. `sorted` is oldest-first.
function valueAt(sorted: Snapshot[], date: string): number {
  let value = sorted[0].solvedCount;
  for (const r of sorted) {
    if (r.date > date) break;
    value = r.solvedCount;
  }
  return value;
}

// Both members' solved counts over the stretch of time they both have history
// for. In "gained" mode both lines start at 0 on the first shared day, so the
// chart shows who has been climbing faster rather than who started higher.
// Returns no points when there isn't enough shared history to draw a line.
export function buildHistorySeries(
  a: User,
  b: User,
  mode: HistoryMode
): { points: HistoryPoint[]; startDate: string | null } {
  const byDate = (x: Snapshot, y: Snapshot) => x.date.localeCompare(y.date);
  const ha = [...a.history].sort(byDate);
  const hb = [...b.history].sort(byDate);
  if (ha.length === 0 || hb.length === 0) return { points: [], startDate: null };

  const startDate = ha[0].date > hb[0].date ? ha[0].date : hb[0].date;
  const dates = [...new Set([...ha, ...hb].map((r) => r.date))].filter((d) => d >= startDate).sort();
  if (dates.length < 2) return { points: [], startDate };

  const baseA = mode === "gained" ? valueAt(ha, startDate) : 0;
  const baseB = mode === "gained" ? valueAt(hb, startDate) : 0;
  const points = dates.map((date) => ({
    date,
    a: valueAt(ha, date) - baseA,
    b: valueAt(hb, date) - baseB
  }));
  return { points, startDate };
}
