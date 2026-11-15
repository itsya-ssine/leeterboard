import { useMemo } from "react";
import type { User } from "../../../types.js";
import { addDays, buildDailyActivity, mondayIndex, type DayActivity } from "../utils/activity.js";

// History keeps at most 60 daily snapshots, so ~10 weeks is all there is to show.
const WEEKS = 10;

const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

// Level 0 = tracked but nobody solved anything; 1–4 = share of the busiest day.
const LEVEL_CLASS = [
  "bg-ink-900 border border-ink-800",
  "bg-emerald-950 border border-emerald-800",
  "bg-emerald-800 border border-emerald-600",
  "bg-emerald-500 border border-emerald-400",
  "bg-emerald-300 border border-white shadow-[0_0_8px_rgba(52,211,153,0.8)]"
];
const NO_DATA_CLASS = "bg-transparent border border-dashed border-ink-700";

function levelFor(solved: number, max: number): number {
  if (solved <= 0 || max <= 0) return 0;
  const ratio = solved / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function cellTitle(day: DayActivity): string {
  if (!day.tracked) return `${longDate(day.date)}: not tracked yet`;
  return `${longDate(day.date)}: ${day.solved} solved`;
}

function Kpi({ label, value, tone = "text-strong" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border-2 border-ink-700 bg-ink-950 px-3 py-1.5 shadow-[2px_2px_0_#000]">
      <div className="font-pixel text-[8px] uppercase tracking-wider text-mist-500">{label}</div>
      <div className={`font-pixel text-sm font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

export default function ActivityHeatmap({ users }: { users: User[] }) {
  const { columns, total, busiest, max, hasData, activeDays } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    // Start on the Monday WEEKS-1 weeks before this week's Monday so the grid
    // is a whole number of Monday-first columns ending with the current week.
    const start = addDays(today, -mondayIndex(today) - (WEEKS - 1) * 7);
    const days = buildDailyActivity(users, start, today);

    const cols: (DayActivity | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      const col: (DayActivity | null)[] = days.slice(i, i + 7);
      while (col.length < 7) col.push(null); // days after today
      cols.push(col);
    }

    const tracked = days.filter((d) => d.tracked);
    const busiestDay = tracked.reduce<DayActivity | null>((best, d) => (!best || d.solved > best.solved ? d : best), null);
    return {
      columns: cols,
      total: tracked.reduce((acc, d) => acc + d.solved, 0),
      busiest: busiestDay && busiestDay.solved > 0 ? busiestDay : null,
      max: busiestDay?.solved ?? 0,
      hasData: tracked.length > 0,
      activeDays: tracked.filter((d) => d.solved > 0).length
    };
  }, [users]);

  return (
    <section
      id="activity-panel"
      aria-label="Group activity"
      className="pixel-card mb-8 p-5"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-ink-700 pb-4">
        <div>
          <div className="font-pixel text-[9px] uppercase tracking-widest text-emerald-400">// submissions.heatmap</div>
          <h2 className="mt-1 font-pixel text-base font-bold tracking-wide text-strong">Group activity</h2>
          <p className="mt-1 font-mono text-xs text-mist-400">Problems solved per day by the whole roster, in UTC days</p>
        </div>
        {hasData && (
          <div className="flex flex-wrap gap-2">
            <Kpi label={`Last ${WEEKS} weeks`} value={total.toLocaleString()} tone="text-emerald-400" />
            <Kpi label="Active days" value={String(activeDays)} />
            {busiest && <Kpi label={`Peak ${longDate(busiest.date)}`} value={`+${busiest.solved}`} tone="text-amber-300" />}
          </div>
        )}
      </div>

      {!hasData ? (
        <p className="py-10 text-center font-mono text-sm text-mist-500">
          The heatmap fills in once the board has more than one day of history.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto pb-1">
            <div
              role="img"
              aria-label={`Activity heatmap for the last ${WEEKS} weeks: ${total} problems solved in total`}
              className="flex w-max gap-2"
            >
              <div aria-hidden="true" className="flex flex-col gap-1 pr-1">
                {WEEKDAY_LABELS.map((label, i) => (
                  <div key={i} className="h-4 font-mono text-[10px] uppercase leading-4 text-mist-500">
                    {label}
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5">
                {columns.map((col, ci) => (
                  <div key={ci} className="flex flex-col gap-1.5">
                    {col.map((day, ri) =>
                      day ? (
                        <div
                          key={day.date}
                          title={cellTitle(day)}
                          className={`size-4 transition-transform duration-100 hover:z-10 hover:scale-125 ${
                            day.tracked ? LEVEL_CLASS[levelFor(day.solved, max)] : NO_DATA_CLASS
                          }`}
                        />
                      ) : (
                        <div key={`future-${ri}`} className="size-4" />
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-ink-700/60 pt-4 font-mono text-xs uppercase tracking-wider text-mist-500">
            <div className="flex items-center gap-1.5">
              <span className={`size-3.5 ${NO_DATA_CLASS}`} />
              Not tracked
            </div>
            <div className="flex items-center gap-1.5">
              Less
              {LEVEL_CLASS.map((cls, i) => (
                <span key={i} className={`size-3.5 ${cls}`} />
              ))}
              More
            </div>
          </div>
        </>
      )}
    </section>
  );
}
