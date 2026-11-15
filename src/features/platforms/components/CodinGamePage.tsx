import React, { useState } from "react";
import { ArrowUpRight, Clock, Link2, Search } from "lucide-react";
import type { PlatformAccount, User } from "../../../types.js";
import EmptyState from "../../../components/common/EmptyState.js";
import SearchInput from "../../../components/ui/SearchInput.js";
import { PodiumBoard, type PodiumEntry } from "../../leaderboard/components/Podium.js";
import { FramedAvatar } from "../../../components/ui/TierAvatar.js";
import { codingameTier } from "../../../tiers.js";
import { PixelRankBadge } from "../../../pixelArt.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

// For CodinGame the stored fields mean: solved = total XP, rating = level,
// weeklySolved = XP earned this week (see platforms/codingame.ts).
type Sort = "xp" | "weekly" | "level";

export interface CodingameMember {
  user: User;
  account: PlatformAccount;
}

const TABS: { key: Sort; label: string; id: string }[] = [
  { key: "xp", label: "XP", id: "cg-sort-xp-btn" },
  { key: "weekly", label: "This week", id: "cg-sort-weekly-btn" },
  { key: "level", label: "Level", id: "cg-sort-level-btn" }
];

export function compareCodingame(sortBy: Sort) {
  return (a: CodingameMember, b: CodingameMember): number => {
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

// Members who linked a CodinGame account (the CodinGame board and the Stats page).
export function codingameMembers(users: User[]): CodingameMember[] {
  const out: CodingameMember[] = [];
  for (const user of users) {
    const account = user.platforms?.codingame;
    if (account) out.push({ user, account });
  }
  return out;
}

// The hexagonal level badge (defined below), reused by the Stats page.
export { LevelBadge };

const rankColor = (rank: number) =>
  rank === 1
    ? "text-amber-300"
    : rank === 2
      ? "text-slate-300"
      : rank === 3
        ? "text-orange-300"
        : "text-mist-500";

// What the podium shows for a member under the ranking currently selected.
function podiumMetric(account: PlatformAccount, sortBy: Sort): { value: string; label: string } {
  if (sortBy === "weekly") return { value: `+${account.weeklySolved.toLocaleString()} XP`, label: "this week" };
  if (sortBy === "level") return { value: String(account.rating ?? 0), label: "level" };
  return { value: account.solved.toLocaleString(), label: "XP" };
}

// A hexagonal level badge, like an RPG rank emblem.
function LevelBadge({ level, size = "md" }: { level: number | null; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "size-11 text-base" : "size-8 text-xs";
  return (
    <span
      role="img"
      aria-label={level != null ? `Level ${level}` : "No level"}
      className={`grid shrink-0 place-items-center border-2 border-lime-400 bg-ink-950 font-pixel font-bold tabular-nums text-lime-400 shadow-[2px_2px_0_#000] ${dim}`}
    >
      {level ?? "–"}
    </span>
  );
}

// XP gained this week as a chunky segmented "health bar".
function XpBar({ value, max }: { value: number; max: number }) {
  const segments = 20;
  const filled = max > 0 ? Math.min(segments, Math.round((value / max) * segments)) : 0;
  return (
    <div className="flex h-2.5 w-full gap-[1px]" role="img" aria-label={`${value} XP this week`}>
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          className={`h-full flex-1 transition-colors duration-300 ${
            i < filled
              ? "bg-lime-400 shadow-[0_0_4px_rgba(163,230,53,0.6)]"
              : "bg-ink-800"
          }`}
          style={{ transitionDelay: `${i * 14}ms` }}
        />
      ))}
    </div>
  );
}

// The CodinGame board: only members who linked a CodinGame account.
export default function CodinGamePage({ users, loading = false }: { users: User[]; loading?: boolean }) {
  const [sortBy, setSortBy] = useState<Sort>("xp");
  const [query, setQuery] = useState("");

  const members = codingameMembers(users).sort(compareCodingame(sortBy));
  const weeklyMax = Math.max(1, ...members.map((m) => m.account.weeklySolved));

  // Search: name, LeetCode username, school or CodinGame profile id. Ranks stay
  // the real ones, so a filtered row still shows its place on the board.
  const q = query.trim().toLowerCase();
  const matches = ({ user, account }: CodingameMember) =>
    !q ||
    user.displayName.toLowerCase().includes(q) ||
    user.loginUsername.toLowerCase().includes(q) ||
    user.leetcodeUsername.toLowerCase().includes(q) ||
    (user.school ?? "").toLowerCase().includes(q) ||
    account.handle.toLowerCase().includes(q);
  const visibleCount = members.filter(matches).length;

  // The podium: the top three of the ranking currently selected (level mode
  // counts members with a level only). Shown on every tab (XP, this week, level)
  // whenever there is someone to show; places nobody holds yet stay as empty
  // pedestals. Hidden only while searching.
  const leaders = members.filter((m) => sortBy !== "level" || m.account.rating != null).slice(0, 3);
  const showPodium = !loading && !q && leaders.length > 0;
  const podiumEntries: PodiumEntry[] = leaders.map(({ user, account }) => ({
    id: user.id,
    name: user.displayName,
    handle: `@${user.loginUsername}`,
    school: user.school,
    ...podiumMetric(account, sortBy),
    href: `#/u/${encodeURIComponent(user.loginUsername)}`,
    avatar: (className) => (
      <FramedAvatar
        src={user.avatarUrl}
        tier={codingameTier(account.rating)}
        shape="rounded-2xl"
        showGem
        gemSize="sm"
        className={className}
      />
    )
  }));

  return (
    <div className="space-y-6">
      <section
        id="codingame-panel"
        aria-label="CodinGame leaderboard"
        className="pixel-card animate-rise overflow-hidden"
      >
        {/* Search + sort */}
        <div className="flex flex-col gap-3 border-b-2 border-ink-700 bg-ink-950/90 p-3 sm:flex-row sm:items-center md:p-4">
          <SearchInput
            id="cg-search"
            label="Search members"
            placeholder="Search by name, username, school or profile id"
            value={query}
            onChange={setQuery}
          />
          <div
            role="group"
            aria-label="Sort CodinGame leaderboard"
            className="inline-flex shrink-0 border-2 border-ink-700 bg-ink-950 p-0.5 shadow-[2px_2px_0_#000]"
          >
            {TABS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSortBy(opt.key)}
                aria-pressed={sortBy === opt.key}
                id={opt.id}
                className={`h-8 flex-1 cursor-pointer px-4 font-pixel text-[9px] uppercase tracking-wider transition-colors sm:flex-none ${focusRing} ${
                  sortBy === opt.key
                    ? "bg-lime-400 font-bold text-ink-950 shadow-[1px_1px_0_#000]"
                    : "text-mist-400 hover:bg-ink-900 hover:text-strong"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Top three, shown inside the leaderboard (they stay in the list below too). */}
        {showPodium && <PodiumBoard entries={podiumEntries} />}

        <div className="hidden grid-cols-12 gap-x-4 border-b-2 border-ink-700 bg-ink-950 px-5 py-2.5 font-pixel text-[9px] font-bold uppercase tracking-wider text-mist-400 md:grid">
          <div className="col-span-1">#</div>
          <div className="col-span-4">Player</div>
          <div className="col-span-3">XP this week</div>
          <div className="col-span-2">Level</div>
          <div className="col-span-2 text-right">&Sigma; XP</div>
        </div>

        {loading ? (
          <div className="divide-y-2 divide-ink-800" aria-busy="true">
            <span className="sr-only">Loading CodinGame leaderboard</span>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-4 w-5 animate-pulse bg-ink-800" />
                <div className="size-10 animate-pulse bg-ink-800" />
                <div className="h-4 w-40 animate-pulse bg-ink-800" />
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            bare
            icon={<Link2 className="size-5" aria-hidden="true" />}
            title="Nobody has linked CodinGame yet"
            description="Add your profile id under Account settings > Linked accounts to appear here."
            action={{ label: "Link my account", href: "#/account" }}
          />
        ) : visibleCount === 0 ? (
          <EmptyState
            bare
            icon={<Search className="size-5" aria-hidden="true" />}
            title="No members match your search"
            description="Try a different name, username or handle."
            action={{ label: "Clear search", onClick: () => setQuery("") }}
          />
        ) : (
          <div className="divide-y border-t border-ink-800 divide-ink-800/80">
            {members.map((member, index) => {
              const { user, account } = member;
              if (!matches(member)) return null;
              const synced = account.lastUpdated != null;
              const shownRank = sortBy === "level" && account.rating == null ? null : index + 1;
              return (
                <div
                  key={user.id}
                  id={`cg-row-${user.id}`}
                  className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-3.5 transition-colors hover:bg-ink-900/60 md:grid-cols-12 md:gap-x-4 md:px-5"
                >
                  <div className="md:col-span-1">
                    {shownRank != null ? (
                      <PixelRankBadge rank={shownRank} />
                    ) : (
                      <span className="font-mono text-xs text-mist-500">—</span>
                    )}
                  </div>

                  <div className="flex min-w-0 items-center gap-3 md:col-span-4">
                    <a
                      href={`#/u/${encodeURIComponent(user.loginUsername)}`}
                      title="View profile"
                      className={`group/member flex min-w-0 items-center gap-3 rounded text-left ${focusRing}`}
                    >
                      <FramedAvatar
                        src={user.avatarUrl}
                        tier={codingameTier(account.rating)}
                        shape="rounded-xl"
                        className="size-10 transition duration-150 group-hover/member:scale-105"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-strong transition-colors group-hover/member:text-teal-300">
                          {user.displayName}
                        </div>
                        <div className="truncate font-mono text-xs text-mist-500">@{user.loginUsername}</div>
                      </div>
                    </a>
                  </div>

                  <div className="order-last col-span-3 md:order-none md:col-span-3 md:pr-4">
                    {!synced ? (
                      <span className="inline-flex items-center gap-1 border border-ink-700 bg-ink-900 px-2 py-0.5 font-pixel text-[8px] uppercase text-mist-400">
                        <Clock className="size-3" aria-hidden="true" />
                        Not synced yet
                      </span>
                    ) : (
                      <div className="flex w-full items-center gap-3">
                        <XpBar value={account.weeklySolved} max={weeklyMax} />
                        <span className="w-16 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-lime-400">
                          +{account.weeklySolved.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="order-last col-span-3 flex items-center gap-2 md:order-none md:col-span-2">
                    <span className="font-pixel text-[8px] uppercase tracking-wider text-mist-500 md:hidden">Level</span>
                    {account.rating != null ? (
                      <>
                        <LevelBadge level={account.rating} />
                        <span
                          className={`hidden font-pixel text-[8px] font-bold uppercase tracking-widest lg:inline ${
                            sortBy === "level" ? "text-lime-400" : "text-mist-500"
                          }`}
                        >
                          LV
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-xs uppercase tracking-wider text-mist-500">–</span>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-1 md:col-span-2">
                    <div className="pr-1 text-right">
                      <div className="font-mono text-xl font-bold tabular-nums text-strong">
                        {account.solved.toLocaleString()}
                      </div>
                      <a
                        href={`https://www.codingame.com/profile/${encodeURIComponent(account.handle)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-0.5 border border-lime-500/40 bg-lime-950/20 px-1.5 py-0.5 font-pixel text-[8px] font-bold uppercase tracking-widest text-lime-400 hover:border-lime-300 hover:text-lime-300 ${focusRing}`}
                        title="Open on CodinGame"
                      >
                        <span>XP</span>
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
    </div>
  );
}
