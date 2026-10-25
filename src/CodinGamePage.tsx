import React, { useState } from "react";
import { ArrowUpRight, Clock, Link2 } from "lucide-react";
import type { PlatformAccount, User } from "./types.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

// For CodinGame the stored fields mean: solved = total XP, rating = level,
// weeklySolved = XP earned this week (see platforms/codingame.ts).
type Sort = "xp" | "weekly" | "level";

interface Member {
  user: User;
  account: PlatformAccount;
}

const TABS: { key: Sort; label: string; id: string }[] = [
  { key: "xp", label: "XP", id: "cg-sort-xp-btn" },
  { key: "weekly", label: "This week", id: "cg-sort-weekly-btn" },
  { key: "level", label: "Level", id: "cg-sort-level-btn" }
];

function compare(sortBy: Sort) {
  return (a: Member, b: Member): number => {
    const x = a.account;
    const y = b.account;
    if (sortBy === "level") {
      if (x.rating != null && y.rating == null) return -1;
      if (x.rating == null && y.rating != null) return 1;
      if (x.rating != null && y.rating != null && x.rating !== y.rating) return y.rating - x.rating;
      return y.solved - x.solved;
    }
    if (sortBy === "weekly") {
      if (y.weeklySolved !== x.weeklySolved) return y.weeklySolved - x.weeklySolved;
      return y.solved - x.solved;
    }
    if (y.solved !== x.solved) return y.solved - x.solved;
    return y.weeklySolved - x.weeklySolved;
  };
}

const rankColor = (rank: number) =>
  rank === 1
    ? "text-amber-300"
    : rank === 2
      ? "text-slate-300"
      : rank === 3
        ? "text-orange-300"
        : "text-mist-500";

// The CodinGame board: only members who linked a CodinGame account.
export default function CodinGamePage({ users, loading = false }: { users: User[]; loading?: boolean }) {
  const [sortBy, setSortBy] = useState<Sort>("xp");

  const members: Member[] = [];
  for (const user of users) {
    const account = user.platforms?.codingame;
    if (account) members.push({ user, account });
  }
  members.sort(compare(sortBy));
  const weeklyMax = Math.max(1, ...members.map((m) => m.account.weeklySolved));

  return (
    <section
      id="codingame-panel"
      aria-label="CodinGame leaderboard"
      className="overflow-hidden rounded-xl bg-ink-900 ring-1 ring-line"
    >
      <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between md:p-4">
        <p className="text-sm text-mist-500">
          {loading
            ? "Loading…"
            : `${members.length} ${members.length === 1 ? "member has" : "members have"} linked CodinGame`}
        </p>
        <div
          role="group"
          aria-label="Sort CodinGame leaderboard"
          className="inline-flex shrink-0 rounded-lg bg-ink-950 p-1 ring-1 ring-line"
        >
          {TABS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSortBy(opt.key)}
              aria-pressed={sortBy === opt.key}
              id={opt.id}
              className={`h-8 flex-1 cursor-pointer rounded-md px-4 text-sm font-medium transition-colors sm:flex-none ${focusRing} ${
                sortBy === opt.key ? "bg-ink-700 text-strong" : "text-mist-400 hover:text-strong"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden grid-cols-12 gap-x-4 border-b border-line px-5 py-2.5 text-xs font-medium text-mist-500 md:grid">
        <div className="col-span-1">Rank</div>
        <div className="col-span-4">Member</div>
        <div className="col-span-3">XP this week</div>
        <div className="col-span-2">Level</div>
        <div className="col-span-2 text-right">Total XP</div>
      </div>

      {loading ? (
        <div className="divide-y divide-line" aria-busy="true">
          <span className="sr-only">Loading CodinGame leaderboard</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <div className="h-4 w-5 animate-pulse rounded bg-ink-800" />
              <div className="size-10 animate-pulse rounded-full bg-ink-800" />
              <div className="h-4 w-40 animate-pulse rounded bg-ink-800" />
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-ink-800 text-mist-500">
            <Link2 className="size-4" />
          </div>
          <p className="font-medium text-strong">Nobody has linked CodinGame yet</p>
          <p className="mt-1 text-sm text-mist-500">
            Add your profile id under{" "}
            <a href="#/account" className={`rounded font-medium text-teal-300 hover:underline ${focusRing}`}>
              Account settings &gt; Linked accounts
            </a>{" "}
            to appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {members.map(({ user, account }, index) => {
            const synced = account.lastUpdated != null;
            const shownRank = sortBy === "level" && account.rating == null ? null : index + 1;
            const progress = Math.min(100, Math.round((account.weeklySolved / weeklyMax) * 100));
            return (
              <div
                key={user.id}
                id={`cg-row-${user.id}`}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 bg-ink-900 px-4 py-4 transition-colors hover:bg-ink-800/60 md:grid-cols-12 md:gap-x-4 md:px-5"
              >
                <div className="md:col-span-1">
                  <span className={`text-lg font-semibold leading-none tabular-nums ${rankColor(shownRank ?? 0)}`}>
                    {shownRank ?? "–"}
                  </span>
                </div>

                <div className="flex min-w-0 items-center gap-3 md:col-span-4">
                  <a
                    href={`#/u/${encodeURIComponent(user.leetcodeUsername)}`}
                    title="View profile"
                    className={`group/member flex min-w-0 items-center gap-3 rounded-lg ${focusRing}`}
                  >
                    <img
                      src={user.avatarUrl}
                      alt=""
                      className="size-10 shrink-0 rounded-full object-cover ring-1 ring-line-strong transition group-hover/member:ring-teal-400/70"
                      referrerPolicy="no-referrer"
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-strong transition-colors group-hover/member:text-teal-300">
                        {user.displayName}
                      </div>
                      <div className="truncate text-sm text-mist-500">@{user.leetcodeUsername}</div>
                    </div>
                  </a>
                </div>

                <div className="order-last col-span-3 md:order-none md:col-span-3 md:pr-4">
                  {!synced ? (
                    <span className="inline-flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 text-xs text-mist-400 ring-1 ring-line">
                      <Clock className="size-3" aria-hidden="true" />
                      Not synced yet
                    </span>
                  ) : (
                    <div className="flex w-full items-center gap-3">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
                        <div
                          className="h-full rounded-full bg-teal-400 transition-[width] duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-teal-300">
                        +{account.weeklySolved.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>

                <div className="order-last col-span-3 flex items-baseline gap-2 md:order-none md:col-span-2 md:block">
                  <span className="text-xs text-mist-500 md:hidden">Level</span>
                  {account.rating != null ? (
                    <span
                      className={`text-base font-semibold tabular-nums ${sortBy === "level" ? "text-teal-300" : "text-strong"}`}
                    >
                      {account.rating}
                    </span>
                  ) : (
                    <span className="text-sm text-mist-500">–</span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-1 md:col-span-2">
                  <div className="pr-1 text-right">
                    <div className="text-xl font-semibold tabular-nums text-strong">
                      {account.solved.toLocaleString()}
                    </div>
                    <a
                      href={`https://www.codingame.com/profile/${encodeURIComponent(account.handle)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-0.5 rounded text-xs text-mist-500 hover:text-teal-300 ${focusRing}`}
                      title="Open on CodinGame"
                    >
                      <span>CodinGame</span>
                      <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
