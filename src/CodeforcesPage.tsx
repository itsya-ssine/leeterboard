import React, { useState } from "react";
import { ArrowUpRight, Clock, Link2 } from "lucide-react";
import type { PlatformAccount, User } from "./types.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

/* ---------- Rank titles ---------- */

// Colours follow Codeforces' own rank colours. The mid shades (500) are used on
// purpose: the light theme only remaps the 300/400 hues, and these stay readable
// on both the dark and the light surface.
const RANK_TEXT: Record<string, string> = {
  newbie: "text-slate-500",
  pupil: "text-green-500",
  specialist: "text-cyan-500",
  expert: "text-blue-500",
  "candidate master": "text-violet-500",
  master: "text-orange-500",
  "international master": "text-orange-500",
  grandmaster: "text-red-500",
  "international grandmaster": "text-red-500",
  "legendary grandmaster": "text-red-500"
};

export function rankTextClass(title: string | null | undefined): string {
  return RANK_TEXT[(title ?? "").toLowerCase()] ?? "text-mist-400";
}

export function formatRankTitle(title: string | null | undefined): string {
  if (!title) return "Unrated";
  return title.replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---------- Helpers shared with the Stats page ---------- */

// Codeforces members: everyone who linked a Codeforces account.
export interface CodeforcesMember {
  user: User;
  account: PlatformAccount;
}

export function codeforcesMembers(users: User[]): CodeforcesMember[] {
  const out: CodeforcesMember[] = [];
  for (const user of users) {
    const account = user.platforms?.codeforces;
    if (account) out.push({ user, account });
  }
  return out;
}

export interface CodeforcesBuckets {
  easy: number;
  medium: number;
  hard: number;
  unrated: number;
}

// Difficulty buckets by problem rating, stored by the server in `extra.buckets`.
export function codeforcesBuckets(account: PlatformAccount): CodeforcesBuckets {
  const raw = (account.extra as { buckets?: Partial<Record<keyof CodeforcesBuckets, unknown>> } | undefined)?.buckets;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { easy: num(raw?.easy), medium: num(raw?.medium), hard: num(raw?.hard), unrated: num(raw?.unrated) };
}

export type CodeforcesSort = "solved" | "weekly" | "rating";

// Single ordering used for ranks and for the list. Rating mode puts rated
// members first (highest rating first), the rest after them by problems solved.
export function compareCodeforces(sortBy: CodeforcesSort) {
  return (a: CodeforcesMember, b: CodeforcesMember): number => {
    const x = a.account;
    const y = b.account;
    if (sortBy === "rating") {
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

/* ---------- Small pieces ---------- */

const rankColor = (rank: number) =>
  rank === 1
    ? "text-amber-300"
    : rank === 2
      ? "text-slate-300"
      : rank === 3
        ? "text-orange-300"
        : "text-mist-500";

// Easy / Medium / Hard (by problem rating) bar, same look as the LeetCode one.
export function CodeforcesBucketBar({ buckets }: { buckets: CodeforcesBuckets }) {
  const { easy, medium, hard, unrated } = buckets;
  const total = Math.max(1, easy + medium + hard + unrated);
  const segments = [
    { label: "Easy", value: easy, bar: "bg-emerald-400", text: "text-emerald-300" },
    { label: "Medium", value: medium, bar: "bg-amber-400", text: "text-amber-300" },
    { label: "Hard", value: hard, bar: "bg-rose-400", text: "text-rose-300" },
    { label: "Unrated", value: unrated, bar: "bg-slate-400", text: "text-mist-400" }
  ].filter((s) => s.value > 0 || s.label !== "Unrated");

  return (
    <div
      className="flex w-full flex-col gap-2"
      role="img"
      aria-label={`${easy} easy, ${medium} medium, ${hard} hard${unrated ? `, ${unrated} unrated` : ""}`}
    >
      <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-tint">
        {segments.map(
          (s) =>
            s.value > 0 && (
              <div
                key={s.label}
                className={`h-full ${s.bar}`}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.value} ${s.label}`}
              />
            )
        )}
      </div>
      <div className="flex items-center gap-3 text-xs tabular-nums">
        {segments.map((s) => (
          <span key={s.label} className={`inline-flex items-center gap-1.5 ${s.text}`}>
            <span className={`size-1.5 rounded-full ${s.bar}`} />
            <span className="font-semibold">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function formatAge(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// A linked account whose last successful sync is older than this gets a badge.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/* ---------- Page ---------- */

const TABS: { key: CodeforcesSort; label: string; id: string }[] = [
  { key: "solved", label: "Solved", id: "cf-sort-solved-btn" },
  { key: "weekly", label: "This week", id: "cf-sort-weekly-btn" },
  { key: "rating", label: "Rating", id: "cf-sort-rating-btn" }
];

// The Codeforces board: only members who linked a Codeforces account.
export default function CodeforcesPage({ users, loading = false }: { users: User[]; loading?: boolean }) {
  const [sortBy, setSortBy] = useState<CodeforcesSort>("solved");
  const now = Date.now();

  const members = codeforcesMembers(users).sort(compareCodeforces(sortBy));
  const weeklyMax = Math.max(25, ...members.map((m) => m.account.weeklySolved));

  return (
    <section
      id="codeforces-panel"
      aria-label="Codeforces leaderboard"
      className="overflow-hidden rounded-xl bg-ink-900 ring-1 ring-line"
    >
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between md:p-4">
        <p className="text-sm text-mist-500">
          {loading
            ? "Loading…"
            : `${members.length} ${members.length === 1 ? "member has" : "members have"} linked Codeforces`}
        </p>
        <div
          role="group"
          aria-label="Sort Codeforces leaderboard"
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

      {/* Column labels */}
      <div className="hidden grid-cols-12 gap-x-4 border-b border-line px-5 py-2.5 text-xs font-medium text-mist-500 md:grid">
        <div className="col-span-1">Rank</div>
        <div className="col-span-3">Member</div>
        <div className="col-span-3">{sortBy === "weekly" ? "Solved this week" : "Solved by difficulty"}</div>
        <div className="col-span-3">Rating</div>
        <div className="col-span-2 text-right">Solved</div>
      </div>

      {loading ? (
        <div className="divide-y divide-line" aria-busy="true">
          <span className="sr-only">Loading Codeforces leaderboard</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <div className="h-4 w-5 animate-pulse rounded bg-ink-800" />
              <div className="size-10 animate-pulse rounded-full bg-ink-800" />
              <div className="h-4 w-40 animate-pulse rounded bg-ink-800" />
              <div className="ml-auto h-4 w-12 animate-pulse rounded bg-ink-800" />
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-ink-800 text-mist-500">
            <Link2 className="size-4" />
          </div>
          <p className="font-medium text-strong">Nobody has linked Codeforces yet</p>
          <p className="mt-1 text-sm text-mist-500">
            Add your handle under{" "}
            <a href="#/account" className={`rounded font-medium text-teal-300 hover:underline ${focusRing}`}>
              Account settings &gt; Linked accounts
            </a>{" "}
            to appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {members.map(({ user, account }, index) => {
            const rank = index + 1;
            const rated = account.rating != null;
            const buckets = codeforcesBuckets(account);
            const progress = Math.min(100, Math.round((account.weeklySolved / weeklyMax) * 100));
            // Rating mode ranks only rated members; the rest get a dash.
            const shownRank = sortBy === "rating" && !rated ? null : rank;
            const stale =
              account.lastUpdated != null && now - new Date(account.lastUpdated).getTime() > STALE_AFTER_MS;

            return (
              <div
                key={user.id}
                id={`cf-row-${user.id}`}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 bg-ink-900 px-4 py-4 transition-colors hover:bg-ink-800/60 md:grid-cols-12 md:gap-x-4 md:px-5"
              >
                {/* Rank */}
                <div className="md:col-span-1">
                  <span className={`text-lg font-semibold leading-none tabular-nums ${rankColor(shownRank ?? 0)}`}>
                    {shownRank ?? "–"}
                  </span>
                </div>

                {/* Member */}
                <div className="flex min-w-0 items-center gap-3 md:col-span-3">
                  <a
                    href={`#/u/${encodeURIComponent(user.leetcodeUsername)}`}
                    title="View profile"
                    className={`group/member flex min-w-0 items-center gap-3 rounded-lg text-left ${focusRing}`}
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

                {/* Progress */}
                <div className="order-last col-span-3 md:order-none md:col-span-3 md:pr-4">
                  {account.lastUpdated == null ? (
                    <span className="inline-flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 text-xs text-mist-400 ring-1 ring-line">
                      <Clock className="size-3" aria-hidden="true" />
                      Not synced yet
                    </span>
                  ) : sortBy === "weekly" ? (
                    <div className="flex w-full items-center gap-3">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
                        <div
                          className="h-full rounded-full bg-teal-400 transition-[width] duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-teal-300">
                        +{account.weeklySolved}
                      </span>
                    </div>
                  ) : (
                    <CodeforcesBucketBar buckets={buckets} />
                  )}
                  {stale && account.lastUpdated && (
                    <div
                      className="mt-1 inline-flex items-center gap-1 rounded bg-amber-400/10 px-1.5 py-0.5 text-xs text-amber-300 ring-1 ring-amber-300/20"
                      title={`Last successful Codeforces fetch: ${new Date(account.lastUpdated).toLocaleString()}`}
                    >
                      <Clock className="size-3" aria-hidden="true" />
                      Updated {formatAge(account.lastUpdated, now)}
                    </div>
                  )}
                </div>

                {/* Rating + rank title */}
                <div className="order-last col-span-3 flex items-baseline gap-2 md:order-none md:col-span-3 md:block">
                  <span className="text-xs text-mist-500 md:hidden">Rating</span>
                  {rated ? (
                    <>
                      <span
                        className={`text-base font-semibold tabular-nums ${rankTextClass(account.rankTitle)}`}
                      >
                        {account.rating!.toLocaleString()}
                      </span>
                      <span className={`text-xs md:block ${rankTextClass(account.rankTitle)}`}>
                        {formatRankTitle(account.rankTitle)}
                        {account.maxRating != null && account.maxRating !== account.rating && (
                          <span className="text-mist-500"> · max {account.maxRating.toLocaleString()}</span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-mist-500">Unrated</span>
                  )}
                </div>

                {/* Total + handle link */}
                <div className="flex items-center justify-end gap-1 md:col-span-2">
                  <div className="pr-1 text-right">
                    <div className="text-xl font-semibold tabular-nums text-strong">{account.solved}</div>
                    <a
                      href={`https://codeforces.com/profile/${encodeURIComponent(account.handle)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-0.5 rounded text-xs text-mist-500 hover:text-teal-300 ${focusRing}`}
                      title={`${account.handle} on Codeforces`}
                    >
                      <span className="max-w-24 truncate">{account.handle}</span>
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
