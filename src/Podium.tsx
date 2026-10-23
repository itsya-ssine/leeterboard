import React from "react";
import { Trophy } from "lucide-react";
import type { User } from "./types.js";
import type { Movement, RankingKey } from "./movement.js";
import RankMovement from "./RankMovement.js";
import SchoolTag from "./SchoolTag.js";

// Medal styling for places 1–3.
const PLACES = [
  {
    text: "text-amber-300",
    avatarRing: "ring-amber-300/60",
    block: "bg-amber-300/10 ring-amber-300/25",
    blockHeight: "h-20",
    avatar: "size-16 sm:size-20",
    order: "order-2"
  },
  {
    text: "text-slate-300",
    avatarRing: "ring-slate-300/50",
    block: "bg-slate-300/10 ring-slate-300/20",
    blockHeight: "h-14",
    avatar: "size-12 sm:size-16",
    order: "order-1"
  },
  {
    text: "text-orange-300",
    avatarRing: "ring-orange-300/50",
    block: "bg-orange-300/10 ring-orange-300/20",
    blockHeight: "h-10",
    avatar: "size-12 sm:size-16",
    order: "order-3"
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
      className="grid grid-cols-3 items-end gap-2 border-b border-line bg-ink-950/40 px-3 pt-5 sm:gap-4 sm:px-8"
    >
      {leaders.slice(0, 3).map((user, i) => {
        const style = PLACES[i];
        const { value, label } = metric(user, sortBy);
        return (
          <li key={user.id} className={`flex min-w-0 flex-col items-center ${style.order}`}>
            <button
              type="button"
              onClick={() => onSelect(user)}
              title="View full profile"
              className="group/podium flex w-full min-w-0 cursor-pointer flex-col items-center gap-1 rounded-lg px-1 pb-3 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            >
              {i === 0 && <Trophy className="size-4 text-amber-300" aria-hidden="true" />}
              <img
                src={user.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className={`${style.avatar} shrink-0 rounded-full object-cover ring-2 ${style.avatarRing} transition group-hover/podium:brightness-110`}
              />
              <span className="mt-1 flex w-full min-w-0 items-center justify-center gap-1">
                <span className="truncate text-xs font-medium text-strong transition-colors group-hover/podium:text-teal-300 sm:text-sm">
                  {user.displayName}
                </span>
                <RankMovement movement={movements?.[user.id]} />
              </span>
              <span className="w-full truncate text-xs text-mist-500">@{user.leetcodeUsername}</span>
              <SchoolTag school={user.school} />
              <span className={`text-sm font-semibold tabular-nums ${style.text}`}>
                {value} <span className="text-xs font-normal text-mist-500">{label}</span>
              </span>
            </button>
            <div
              className={`grid w-full place-items-center rounded-t-lg ring-1 ${style.block} ${style.blockHeight}`}
              aria-hidden="true"
            >
              <span className={`text-2xl font-semibold tabular-nums ${style.text}`}>{i + 1}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
