import React from "react";
import { Crown } from "lucide-react";
import type { User } from "./types.js";
import type { Movement, RankingKey } from "./movement.js";
import RankMovement from "./RankMovement.js";
import SchoolTag from "./SchoolTag.js";

// Medal styling for places 1–3. `glow` is the soft halo behind the avatar,
// `block` the gradient pedestal, `delay` staggers the entrance animation.
const PLACES = [
  {
    text: "text-amber-300",
    avatarRing: "ring-amber-300/70",
    glow: "bg-amber-300/30",
    block: "bg-gradient-to-t from-amber-300/5 via-amber-300/15 to-amber-300/30 ring-amber-300/30",
    blockHeight: "h-24",
    avatar: "size-18 sm:size-24",
    order: "order-2",
    delay: "0.15s"
  },
  {
    text: "text-slate-300",
    avatarRing: "ring-slate-300/60",
    glow: "bg-slate-300/20",
    block: "bg-gradient-to-t from-slate-300/5 via-slate-300/10 to-slate-300/20 ring-slate-300/25",
    blockHeight: "h-16",
    avatar: "size-14 sm:size-18",
    order: "order-1",
    delay: "0.3s"
  },
  {
    text: "text-orange-300",
    avatarRing: "ring-orange-300/60",
    glow: "bg-orange-300/20",
    block: "bg-gradient-to-t from-orange-300/5 via-orange-300/10 to-orange-300/20 ring-orange-300/25",
    blockHeight: "h-12",
    avatar: "size-14 sm:size-18",
    order: "order-3",
    delay: "0.45s"
  }
] as const;

function metric(user: User, sortBy: RankingKey): { value: string; label: string } {
  if (sortBy === "weekly") return { value: `+${user.weeklyProgress}`, label: "this week" };
  if (sortBy === "rating") return { value: String(user.contestRating ?? 0), label: "rating" };
  return { value: user.allTimeSolved.toLocaleString(), label: "solved" };
}

// The top three for the ranking currently selected. `leaders` is [1st, 2nd,
// 3rd]; the list stays in that order for screen readers while CSS `order`
// lays it out as the classic 2nd–1st–3rd podium.
export default function Podium({
  leaders,
  sortBy,
  movements,
  onSelect
}: {
  leaders: User[];
  sortBy: RankingKey;
  movements?: Record<string, Movement>;
  onSelect: (user: User) => void;
}) {
  return (
    <ol
      aria-label="Top three"
      className="relative grid grid-cols-3 items-end gap-2 overflow-hidden border-b border-line bg-gradient-to-b from-transparent to-ink-950/50 px-3 pt-8 sm:gap-4 sm:px-8"
    >
      {/* Spotlight cone above the winner */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-full w-2/3 -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--color-amber-300)_16%,transparent),transparent_65%)]"
      />
      {leaders.slice(0, 3).map((user, i) => {
        const style = PLACES[i];
        const { value, label } = metric(user, sortBy);
        return (
          <li
            key={user.id}
            className={`relative flex min-w-0 animate-rise flex-col items-center ${style.order}`}
            style={{ animationDelay: style.delay }}
          >
            <button
              type="button"
              onClick={() => onSelect(user)}
              title="View full profile"
              className="group/podium flex w-full min-w-0 cursor-pointer flex-col items-center gap-1 rounded-lg px-1 pb-3 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            >
              {i === 0 && (
                <Crown
                  className="animate-float size-5 fill-amber-300/30 text-amber-300 drop-shadow-[0_0_8px_rgb(252_211_77/0.6)]"
                  aria-hidden="true"
                />
              )}
              <span className="relative mt-1 grid place-items-center">
                <span
                  aria-hidden="true"
                  className={`animate-glow absolute inset-0 -z-0 scale-125 rounded-full blur-xl ${style.glow}`}
                />
                <img
                  src={user.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className={`${style.avatar} relative shrink-0 rounded-full object-cover ring-2 ring-offset-2 ring-offset-ink-900 ${style.avatarRing} transition duration-300 group-hover/podium:-translate-y-1 group-hover/podium:scale-105`}
                />
                <span
                  aria-hidden="true"
                  className={`absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-ink-900 text-xs font-bold tabular-nums ring-2 ring-current ${style.text}`}
                >
                  {i + 1}
                </span>
              </span>
              <span className="mt-2 flex w-full min-w-0 items-center justify-center gap-1">
                <span className="truncate text-xs font-semibold text-strong transition-colors group-hover/podium:text-teal-300 sm:text-sm">
                  {user.displayName}
                </span>
                <RankMovement movement={movements?.[user.id]} />
              </span>
              <span className="w-full truncate text-xs text-mist-500">@{user.leetcodeUsername}</span>
              <SchoolTag school={user.school} />
              <span className={`mt-0.5 text-base font-bold tabular-nums sm:text-lg ${style.text}`}>
                {value} <span className="text-xs font-normal text-mist-500">{label}</span>
              </span>
            </button>
            <div
              className={`relative grid w-full place-items-center overflow-hidden rounded-t-xl ring-1 ${style.block} ${style.blockHeight}`}
              aria-hidden="true"
            >
              {i === 0 && <div className="gold-sheen absolute inset-0" />}
              <span className={`relative text-4xl font-bold tabular-nums opacity-80 font-logo ${style.text}`}>
                {i + 1}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
