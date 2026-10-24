import React, { useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import type { User } from "./types.js";
import { lastWeekStart, addDays, tallyWinners, type WeeklyWinner } from "./winners.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

// How many weeks the wall shows before "Show all".
const WALL_INITIAL = 12;

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const weekRange = (weekStart: string) => `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`;

// Last finished week's top solver, plus a hall of fame wall: one tile per
// finished week (newest first) with that week's winner's picture and name.
// Winners whose account no longer exists are skipped.
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
  const [showAll, setShowAll] = useState(false);

  const byId = new Map(users.map((u) => [u.id, u]));
  const resolved = winners.flatMap((w) => {
    const user = byId.get(w.userId);
    return user ? [{ ...w, user }] : [];
  });
  if (resolved.length === 0) return null;

  const latest = resolved[0];

  const wins = new Map(tallyWinners(resolved).map((t) => [t.userId, t.wins]));
  // With a single winning week the wall would just repeat the banner.
  const hasHallOfFame = resolved.length >= 2;
  const wall = showAll ? resolved : resolved.slice(0, WALL_INITIAL);

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
        <div id="hall-of-fame" className="border-t border-amber-300/20 bg-ink-900 p-4 md:p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-mist-400">
            Weekly winners · last {wall.length} {wall.length === 1 ? "week" : "weeks"}
          </p>

          <ol
            aria-label="Hall of fame: weekly winners, newest first"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
          >
            {wall.map((w, i) => {
              const count = wins.get(w.userId) ?? 1;
              return (
                <li key={w.weekStart}>
                  <button
                    type="button"
                    onClick={() => onSelect(w.user)}
                    title={`${w.user.displayName} · ${weekRange(w.weekStart)} · View full profile`}
                    className={`group/tile flex w-full cursor-pointer flex-col overflow-hidden rounded-xl bg-ink-800 text-left ring-1 transition hover:-translate-y-0.5 hover:ring-amber-300/60 ${
                      i === 0 ? "ring-amber-300/40" : "ring-line"
                    } ${focusRing}`}
                  >
                    <span className="relative block aspect-square w-full bg-ink-700">
                      <img
                        src={w.user.avatarUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="size-full object-cover"
                      />
                      <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
                        {weekRange(w.weekStart)}
                      </span>
                      {count > 1 && (
                        <span
                          title={`${count} weekly wins`}
                          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-200 backdrop-blur-sm"
                        >
                          <Trophy className="size-3" aria-hidden="true" />×{count}
                        </span>
                      )}
                    </span>
                    <span className="block min-w-0 px-2.5 py-2">
                      <span className="block truncate text-sm font-semibold text-strong transition-colors group-hover/tile:text-teal-300">
                        {w.user.displayName}
                      </span>
                      <span className="block text-xs text-mist-400">
                        <span className="font-semibold tabular-nums text-amber-300">+{w.gained}</span> solved
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {resolved.length > WALL_INITIAL && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className={`mt-4 inline-flex h-9 cursor-pointer items-center rounded-lg bg-ink-800 px-3.5 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 ${focusRing}`}
            >
              {showAll ? "Show fewer" : `Show all ${resolved.length} weeks`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
