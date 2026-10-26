import React, { useState } from "react";
import { ArrowUpRight, Clock, Link2, Gamepad2, Search } from "lucide-react";
import type { PlatformAccount, User } from "./types.js";
import EmptyState from "./EmptyState.js";
import SearchInput from "./SearchInput.js";
import { FramedAvatar } from "./TierAvatar.js";
import { codingameTier } from "./tiers.js";

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

// Medal styling for the three "player cards" at the top.
const CARD_MEDALS = [
  { label: "Gold", text: "text-amber-300", ring: "ring-amber-300/70", strip: "from-amber-300/15" },
  { label: "Silver", text: "text-slate-300", ring: "ring-slate-300/60", strip: "from-slate-300/15" },
  { label: "Bronze", text: "text-orange-300", ring: "ring-orange-300/60", strip: "from-orange-300/15" }
] as const;

// A hexagonal level badge, like an RPG rank emblem.
function LevelBadge({ level, size = "md" }: { level: number | null; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "size-12 text-lg" : "size-9 text-sm";
  return (
    <span
      role="img"
      aria-label={level != null ? `Level ${level}` : "No level"}
      className={`grid shrink-0 place-items-center bg-gradient-to-b from-lime-300 to-emerald-500 font-mono font-extrabold tabular-nums text-ink-950 shadow-[0_0_14px_rgb(132_204_22/0.35)] [clip-path:polygon(50%_0%,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)] ${dim}`}
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
    <div className="flex h-2.5 w-full gap-[2px]" role="img" aria-label={`${value} XP this week`}>
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          className={`h-full flex-1 rounded-[2px] transition-colors duration-500 ${
            i < filled
              ? "bg-gradient-to-b from-lime-300 to-emerald-500 shadow-[0_0_6px_rgb(132_204_22/0.5)]"
              : "bg-tint"
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

  const all: Member[] = [];
  for (const user of users) {
    const account = user.platforms?.codingame;
    if (account) all.push({ user, account });
  }
  const members = [...all].sort(compare(sortBy));
  const weeklyMax = Math.max(1, ...members.map((m) => m.account.weeklySolved));

  // Search: name, LeetCode username, school or CodinGame profile id. Ranks stay
  // the real ones, so a filtered row still shows its place on the board.
  const q = query.trim().toLowerCase();
  const matches = ({ user, account }: Member) =>
    !q ||
    user.displayName.toLowerCase().includes(q) ||
    user.leetcodeUsername.toLowerCase().includes(q) ||
    (user.school ?? "").toLowerCase().includes(q) ||
    account.handle.toLowerCase().includes(q);
  const visibleCount = members.filter(matches).length;

  // The three "player cards": the top of the ranking currently selected.
  const cards = members.filter((m) => sortBy !== "level" || m.account.rating != null).slice(0, 3);

  return (
    <div className="space-y-6">
      <section
        id="codingame-panel"
        aria-label="CodinGame leaderboard"
        className="card-aurora animate-rise overflow-hidden"
      >
        <div className="border-b border-line p-3 md:p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-lime-400/10 text-lime-400 ring-1 ring-lime-400/25">
              <Gamepad2 className="size-4" aria-hidden="true" />
            </span>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-mist-500">// codingame.arena</div>
              <p className="text-sm text-mist-400">
                {loading
                  ? "Loading…"
                  : `${members.length} ${members.length === 1 ? "member has" : "members have"} linked CodinGame`}
              </p>
            </div>
          </div>
        </div>

        {/* Search + sort */}
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center md:p-4">
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
            className="inline-flex shrink-0 rounded-xl bg-ink-950/80 p-1 ring-1 ring-line"
          >
            {TABS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSortBy(opt.key)}
                aria-pressed={sortBy === opt.key}
                id={opt.id}
                className={`h-8 flex-1 cursor-pointer rounded-lg px-4 font-mono text-xs font-semibold uppercase tracking-wider transition-colors sm:flex-none ${focusRing} ${
                  sortBy === opt.key
                    ? "bg-gradient-to-b from-ink-700 to-ink-800 text-strong ring-1 ring-line-strong"
                    : "text-mist-400 hover:text-strong"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Top three, shown inside the leaderboard (they stay in the list below too). */}
        {!loading && !q && cards.length > 0 && (
          <div className="border-b border-line bg-ink-950/30 p-3 md:p-4">
            <section aria-label="Top players" className="grid gap-3 md:grid-cols-3">
              {cards.map(({ user, account }, i) => {
                const medal = CARD_MEDALS[i];
                return (
                  <a
                    key={user.id}
                    href={`#/u/${encodeURIComponent(user.leetcodeUsername)}`}
                    className={`card-aurora flex animate-rise flex-col overflow-hidden transition-transform duration-300 hover:-translate-y-1 ${focusRing}`}
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    <div
                      className={`flex items-center justify-between border-b border-line bg-gradient-to-r ${medal.strip} to-transparent px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-widest ${medal.text}`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span className="balloon" aria-hidden="true" />#{i + 1} {medal.label}
                      </span>
                      <span>+{account.weeklySolved.toLocaleString()} XP</span>
                    </div>
                    <div className="flex flex-col gap-4 p-4">
                      <div className="flex items-center gap-3">
                        <div className="relative shrink-0">
                          <FramedAvatar
                            src={user.avatarUrl}
                            tier={codingameTier(account.rating)}
                            shape="rounded-2xl"
                            className="size-14"
                          />
                          <span className="absolute -bottom-2 -right-2">
                            <LevelBadge level={account.rating} />
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-strong">{user.displayName}</div>
                          <div className="truncate font-mono text-sm text-mist-500">@{user.leetcodeUsername}</div>
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-widest text-mist-500">
                          <span>XP this week</span>
                          <span>vs best {weeklyMax.toLocaleString()}</span>
                        </div>
                        <XpBar value={account.weeklySolved} max={weeklyMax} />
                      </div>
                      <div className="flex items-baseline justify-between border-t border-line pt-3 font-mono text-sm">
                        <span className="text-mist-400">
                          <span className="font-bold tabular-nums text-strong">{account.solved.toLocaleString()}</span> XP
                        </span>
                        <span className="text-emerald-400">
                          LV <span className="font-bold tabular-nums">{account.rating ?? "–"}</span>
                        </span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </section>
          </div>
        )}

        <div className="hidden grid-cols-12 gap-x-4 border-b border-line bg-ink-950/40 px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-mist-500 md:grid">
          <div className="col-span-1">#</div>
          <div className="col-span-4">Player</div>
          <div className="col-span-3">XP this week</div>
          <div className="col-span-2">Level</div>
          <div className="col-span-2 text-right">&Sigma; XP</div>
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
          <div className="divide-y divide-line">
            {members.map((member, index) => {
              const { user, account } = member;
              if (!matches(member)) return null;
              const synced = account.lastUpdated != null;
              const shownRank = sortBy === "level" && account.rating == null ? null : index + 1;
              const podium = shownRank != null && shownRank <= 3;
              return (
                <div
                  key={user.id}
                  id={`cg-row-${user.id}`}
                  className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-4 transition-colors hover:bg-ink-800/60 hover:shadow-[inset_3px_0_0_0_var(--color-lime-400)] md:grid-cols-12 md:gap-x-4 md:px-5"
                >
                  <div className="md:col-span-1">
                    <span
                      className={`grid size-8 place-items-center rounded-full font-mono text-sm font-bold leading-none tabular-nums ${rankColor(shownRank ?? 0)} ${
                        podium ? "bg-current/10 ring-1 ring-current/30" : ""
                      }`}
                    >
                      <span className={podium ? "text-strong" : ""}>
                        {shownRank == null ? "–" : String(shownRank).padStart(2, "0")}
                      </span>
                    </span>
                  </div>

                  <div className="flex min-w-0 items-center gap-3 md:col-span-4">
                    <a
                      href={`#/u/${encodeURIComponent(user.leetcodeUsername)}`}
                      title="View profile"
                      className={`group/member flex min-w-0 items-center gap-3 rounded-lg ${focusRing}`}
                    >
                      <FramedAvatar
                        src={user.avatarUrl}
                        tier={codingameTier(account.rating)}
                        shape="rounded-xl"
                        className="size-11 transition duration-300 group-hover/member:scale-105"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-strong transition-colors group-hover/member:text-teal-300">
                          {user.displayName}
                        </div>
                        <div className="truncate font-mono text-sm text-mist-500">@{user.leetcodeUsername}</div>
                      </div>
                    </a>
                  </div>

                  <div className="order-last col-span-3 md:order-none md:col-span-3 md:pr-4">
                    {!synced ? (
                      <span className="inline-flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-xs text-mist-400 ring-1 ring-line">
                        <Clock className="size-3" aria-hidden="true" />
                        Not synced yet
                      </span>
                    ) : (
                      <div className="flex w-full items-center gap-3">
                        <XpBar value={account.weeklySolved} max={weeklyMax} />
                        <span className="w-16 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-lime-500">
                          +{account.weeklySolved.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="order-last col-span-3 flex items-center gap-2 md:order-none md:col-span-2">
                    <span className="font-mono text-xs uppercase tracking-wider text-mist-500 md:hidden">Level</span>
                    {account.rating != null ? (
                      <>
                        <LevelBadge level={account.rating} />
                        <span
                          className={`hidden font-mono text-[10px] font-bold uppercase tracking-widest lg:inline ${
                            sortBy === "level" ? "text-emerald-400" : "text-mist-500"
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
                        className={`inline-flex items-center gap-0.5 rounded font-mono text-[10px] font-bold uppercase tracking-widest text-lime-500 hover:text-teal-300 ${focusRing}`}
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
