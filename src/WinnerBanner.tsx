import React, { useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import type { User } from "./types.js";
import { lastWeekStart, addDays, tallyWinners, type WeeklyWinner } from "./winners.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

// How many members the hall of fame lists.
const HALL_OF_FAME_SIZE = 10;

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const weekRange = (weekStart: string) => `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`;

const weeks = (n: number) => `${n} ${n === 1 ? "week" : "weeks"}`;

// Last finished week's top solver, plus a hall of fame listing each member who
// has ever won once, with how many weeks they were the top solver. Winners
// whose account no longer exists are skipped.
export default function WinnerBanner({
  winners,
  users,
  nowMs,
  onSelect
}: {
  winners: WeeklyWinner[];
  users: User[];
  nowMs: number;
  onSelect: (user: User) => void;
}) {
  const [open, setOpen] = useState(false);

  const byId = new Map(users.map((u) => [u.id, u]));
  const resolved = winners.flatMap((w) => {
    const user = byId.get(w.userId);
    return user ? [{ ...w, user }] : [];
  });
  if (resolved.length === 0) return null;

  const latest = resolved[0];

  const tally = tallyWinners(resolved);
  const wins = new Map(tally.map((t) => [t.userId, t.wins]));
  const hallOfFame = tally.slice(0, HALL_OF_FAME_SIZE).map((t) => ({ ...t, user: byId.get(t.userId)! }));
  // With a single winning week the hall of fame would just repeat the banner.
  const hasHallOfFame = resolved.length >= 2;

  const isLastWeek = latest.weekStart === lastWeekStart(nowMs);
  const heading = isLastWeek ? "Last week's top solver" : "Latest weekly winner";
  const latestWins = wins.get(latest.userId) ?? 1;

  return (
    <section
      id="winner-banner"
      aria-label="Weekly winner"
      className="mb-6 overflow-hidden rounded-xl bg-amber-300/10 ring-1 ring-amber-300/25"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 md:px-5">
        <button
          type="button"
          onClick={() => onSelect(latest.user)}
          title="View full profile"
          className={`group/winner flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left ${focusRing}`}
        >
          <span className="relative shrink-0">
            <img
              src={latest.user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-12 rounded-full object-cover ring-2 ring-amber-300/60"
            />
            <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-ink-900 ring-1 ring-amber-300/40">
              <Trophy className="size-3 text-amber-300" aria-hidden="true" />
            </span>
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium uppercase tracking-wide text-amber-300">{heading}</span>
            <span className="flex items-center gap-2">
              <span className="truncate text-lg font-semibold tracking-tight text-strong transition-colors group-hover/winner:text-teal-300">
                {latest.user.displayName}
              </span>
              {latestWins > 1 && (
                <span
                  title={`${latestWins} weekly wins`}
                  className="shrink-0 rounded bg-amber-300/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-amber-300"
                >
                  ×{latestWins}
                </span>
              )}
            </span>
            <span className="block text-sm text-mist-400">
              <span className="font-semibold tabular-nums text-strong">+{latest.gained}</span> solved ·{" "}
              {weekRange(latest.weekStart)}
            </span>
          </span>
        </button>

        {hasHallOfFame && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="hall-of-fame"
            className={`inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-ink-800 px-3.5 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 ${focusRing}`}
          >
            Hall of fame
            <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && hasHallOfFame && (
        <ol id="hall-of-fame" aria-label="Hall of fame: weeks as top solver" className="divide-y divide-line border-t border-amber-300/20 bg-ink-900">
          {hallOfFame.map((t) => (
            <li key={t.userId}>
              <button
                type="button"
                onClick={() => onSelect(t.user)}
                title="View full profile"
                className={`group/past flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink-800/60 md:px-5 ${focusRing}`}
              >
                <img
                  src={t.user.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-7 shrink-0 rounded-full object-cover ring-1 ring-line-strong"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-strong transition-colors group-hover/past:text-teal-300">
                  {t.user.displayName}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-amber-300">{weeks(t.wins)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
