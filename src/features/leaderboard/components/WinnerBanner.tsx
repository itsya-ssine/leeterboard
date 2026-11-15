import React, { useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import type { User } from "../../../types.js";
import { lastWeekStart, addDays, tallyWinners, type WeeklyWinner } from "../utils/winners.js";
import { PixelCrown, PixelTrophy } from "../../../pixelArt.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400";

const WALL_INITIAL = 12;

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const weekRange = (weekStart: string) => `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`;

const ACCENTS: Record<number, { tile: string; avatar: string; text: string; badge: string }> = {
  1: {
    tile: "border-2 border-amber-400/80 bg-ink-950 shadow-[3px_3px_0_#78350f] hover:border-amber-300",
    avatar: "border-2 border-amber-300",
    text: "text-amber-300",
    badge: "text-amber-300 border-amber-400/80 bg-amber-950/60"
  },
  2: {
    tile: "border-2 border-slate-300/80 bg-ink-950 shadow-[3px_3px_0_#334155] hover:border-slate-200",
    avatar: "border-2 border-slate-300",
    text: "text-slate-200",
    badge: "text-slate-200 border-slate-300/80 bg-slate-900/60"
  },
  3: {
    tile: "border-2 border-orange-400/80 bg-ink-950 shadow-[3px_3px_0_#7c2d12] hover:border-orange-300",
    avatar: "border-2 border-orange-400",
    text: "text-orange-300",
    badge: "text-orange-300 border-orange-400/80 bg-orange-950/60"
  }
};

const DEFAULT_ACCENT = {
  tile: "border-2 border-ink-700 bg-ink-950 shadow-[3px_3px_0_#000] hover:border-mist-400",
  avatar: "border-2 border-ink-700",
  text: "text-mist-100",
  badge: "text-mist-400 border-ink-700 bg-ink-900"
};

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

  const tally = tallyWinners(resolved);
  const members = tally.map((t) => ({
    ...t,
    user: byId.get(t.userId)!,
    rank: tally.findIndex((x) => x.wins === t.wins) + 1
  }));
  const wins = new Map(tally.map((t) => [t.userId, t.wins]));
  const wall = showAll ? members : members.slice(0, WALL_INITIAL);
  const hasHallOfFame = resolved.length >= 2;

  const isLastWeek = latest.weekStart === lastWeekStart(nowMs);
  const heading = isLastWeek ? "Last week's top solver" : "Latest weekly winner";
  const latestWins = wins.get(latest.userId) ?? 1;

  return (
    <section
      id="winner-banner"
      aria-label="Weekly winner"
      className="mb-6 overflow-hidden border-2 border-amber-400/80 bg-ink-900 shadow-[4px_4px_0_#78350f,0_0_20px_rgba(251,191,36,0.12)]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 md:px-5">
        <button
          type="button"
          onClick={() => onSelect(latest.user)}
          title="View full profile"
          className={`group/winner flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left ${focusRing}`}
        >
          <span className="relative shrink-0">
            <img
              src={latest.user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-12 border-2 border-amber-400 bg-ink-800 object-cover shadow-[2px_2px_0_#78350f]"
            />
            <span className="absolute -bottom-1.5 -right-1.5 grid size-5 place-items-center border border-amber-400 bg-ink-950 shadow-[1px_1px_0_#000]">
              <PixelCrown size={12} />
            </span>
          </span>
          <span className="min-w-0">
            <span className="block font-pixel text-[9px] uppercase tracking-wider text-amber-300">{heading}</span>
            <span className="flex items-center gap-2">
              <span className="truncate text-base font-bold tracking-tight text-mist-100 transition-colors group-hover/winner:text-amber-300">
                {latest.user.displayName}
              </span>
              {latestWins > 1 && (
                <span
                  title={`${latestWins} weekly wins`}
                  className="shrink-0 border border-amber-400/60 bg-amber-950/70 px-1.5 py-px font-pixel text-[9px] text-amber-300"
                >
                  ×{latestWins}
                </span>
              )}
            </span>
            <span className="block text-xs text-mist-400 font-sans">
              <span className="font-bold tabular-nums text-emerald-400">+{latest.gained}</span> solved ·{" "}
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
            className={`inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-2 border-ink-700 bg-ink-800 px-3.5 font-pixel text-[11px] font-bold uppercase text-mist-100 shadow-[2px_2px_0_#000] transition-colors hover:border-mist-400 hover:bg-ink-700 active:translate-x-[1px] active:translate-y-[1px] ${focusRing}`}
          >
            Hall of fame
            <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && hasHallOfFame && (
        <div id="hall-of-fame" className="border-t-2 border-amber-400/40 bg-ink-950 p-4 md:p-5">
          <p className="mb-4 font-pixel text-[10px] uppercase tracking-wider text-mist-400">
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
                    className={`group/tile flex h-full w-full cursor-pointer flex-col items-center gap-1.5 p-3 text-center transition-transform hover:-translate-y-0.5 ${accent.tile} ${focusRing}`}
                  >
                    <span className="relative mb-1">
                      <img
                        src={m.user.avatarUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className={`size-16 object-cover bg-ink-800 ${accent.avatar}`}
                      />
                      <span
                        className={`absolute -bottom-1.5 -right-1.5 grid size-6 place-items-center border font-pixel text-[9px] font-bold ${accent.badge}`}
                      >
                        {m.rank === 1 ? <PixelCrown size={12} /> : `#${m.rank}`}
                      </span>
                    </span>

                    <span className="block w-full truncate text-xs font-semibold text-mist-100 transition-colors group-hover/tile:text-amber-300">
                      {m.user.displayName}
                    </span>

                    <span className="flex items-baseline gap-1">
                      <span className={`font-pixel text-xl font-bold leading-none tabular-nums ${accent.text}`}>{m.wins}</span>
                      <span className="font-pixel text-[9px] uppercase tracking-wide text-mist-500">
                        {m.wins === 1 ? "win" : "wins"}
                      </span>
                    </span>

                    <span className="font-mono text-[10px] text-mist-500">Won {fmt(m.lastWin)}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {members.length > WALL_INITIAL && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className={`mt-4 inline-flex h-8 cursor-pointer items-center border-2 border-ink-700 bg-ink-800 px-3 font-pixel text-[10px] uppercase text-mist-100 shadow-[2px_2px_0_#000] hover:bg-ink-700 ${focusRing}`}
            >
              {showAll ? "Show fewer" : `Show all ${members.length} winners`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
