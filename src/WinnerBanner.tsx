import React, { useState } from "react";
import { ChevronDown, Crown, Trophy } from "lucide-react";
import type { User } from "./types.js";
import { lastWeekStart, addDays, tallyWinners, type WeeklyWinner } from "./winners.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

// How many members the wall shows before "Show all".
const WALL_INITIAL = 12;

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const weekRange = (weekStart: string) => `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`;

// Gold / silver / bronze accents for ranks 1-3 (ties share a rank). Class names
// are spelled out in full so Tailwind can see them.
const ACCENTS: Record<number, { tile: string; avatar: string; text: string; badge: string }> = {
  1: {
    tile: "bg-linear-to-b from-amber-300/20 to-ink-800 ring-amber-300/50 hover:ring-amber-300",
    avatar: "ring-amber-300",
    text: "text-amber-300",
    badge: "text-amber-300 ring-amber-300/60"
  },
  2: {
    tile: "bg-linear-to-b from-slate-300/15 to-ink-800 ring-slate-300/40 hover:ring-slate-300",
    avatar: "ring-slate-300",
    text: "text-slate-300",
    badge: "text-slate-300 ring-slate-300/60"
  },
  3: {
    tile: "bg-linear-to-b from-orange-300/15 to-ink-800 ring-orange-300/40 hover:ring-orange-300",
    avatar: "ring-orange-300",
    text: "text-orange-300",
    badge: "text-orange-300 ring-orange-300/60"
  }
};
const DEFAULT_ACCENT = {
  tile: "bg-ink-800 ring-line hover:ring-line-strong",
  avatar: "ring-line-strong",
  text: "text-strong",
  badge: "text-mist-400 ring-line-strong"
};

// Last finished week's top solver, plus a hall of fame wall: one tile per
// member who has ever won a week, ranked by how many weeks they won. Winners
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
  const [showAll, setShowAll] = useState(false);

  const byId = new Map(users.map((u) => [u.id, u]));
  const resolved = winners.flatMap((w) => {
    const user = byId.get(w.userId);
    return user ? [{ ...w, user }] : [];
  });
  if (resolved.length === 0) return null;

  const latest = resolved[0];

  // One entry per member, most wins first. Ties share a rank.
  const tally = tallyWinners(resolved);
  const members = tally.map((t) => ({
    ...t,
    user: byId.get(t.userId)!,
    rank: tally.findIndex((x) => x.wins === t.wins) + 1
  }));
  const wins = new Map(tally.map((t) => [t.userId, t.wins]));
  const wall = showAll ? members : members.slice(0, WALL_INITIAL);
  // With a single winning week the wall would just repeat the banner.
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
        <div id="hall-of-fame" className="border-t border-amber-300/20 bg-ink-900 p-4 md:p-5">
          <p className="mb-4 text-xs font-medium uppercase tracking-wide text-mist-400">
            {members.length} {members.length === 1 ? "winner" : "winners"} · {resolved.length}{" "}
            {resolved.length === 1 ? "week" : "weeks"} played
          </p>

          <ol
            aria-label="Hall of fame: members ranked by weekly wins"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
          >
            {wall.map((m) => {
              const accent = ACCENTS[m.rank] ?? DEFAULT_ACCENT;
              return (
                <li key={m.userId}>
                  <button
                    type="button"
                    onClick={() => onSelect(m.user)}
                    title={`${m.user.displayName} · last won ${weekRange(m.lastWin)} · View full profile`}
                    className={`group/tile flex h-full w-full cursor-pointer flex-col items-center gap-1 rounded-2xl px-3 pb-4 pt-5 text-center ring-1 transition hover:-translate-y-0.5 ${accent.tile} ${focusRing}`}
                  >
                    <span className="relative mb-2">
                      <img
                        src={m.user.avatarUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className={`size-20 rounded-full object-cover ring-2 ring-offset-2 ring-offset-ink-800 ${accent.avatar}`}
                      />
                      <span
                        className={`absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full bg-ink-900 text-xs font-bold tabular-nums ring-1 ${accent.badge}`}
                      >
                        {m.rank === 1 ? <Crown className="size-3.5" aria-hidden="true" /> : m.rank}
                      </span>
                    </span>

                    <span className="block w-full truncate text-sm font-semibold text-strong transition-colors group-hover/tile:text-teal-300">
                      {m.user.displayName}
                    </span>

                    <span className="mt-1 flex items-baseline gap-1">
                      <span className={`text-3xl font-bold leading-none tabular-nums ${accent.text}`}>{m.wins}</span>
                      <span className="text-xs font-medium uppercase tracking-wide text-mist-400">
                        {m.wins === 1 ? "win" : "wins"}
                      </span>
                    </span>

                    <span className="text-[11px] text-mist-500">Last won {fmt(m.lastWin)}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {members.length > WALL_INITIAL && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className={`mt-4 inline-flex h-9 cursor-pointer items-center rounded-lg bg-ink-800 px-3.5 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 ${focusRing}`}
            >
              {showAll ? "Show fewer" : `Show all ${members.length} winners`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
