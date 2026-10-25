import React, { useState } from "react";
import { ArrowUpRight, Clock, Link2, Gamepad2, Users, Swords, TrendingUp, Crown } from "lucide-react";
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

function HudTile({
  label,
  value,
  hint,
  Icon,
  text,
  bar,
  index
}: {
  label: string;
  value: string;
  hint: string;
  Icon: React.ComponentType<{ className?: string }>;
  text: string;
  bar: string;
  index: number;
}) {
  return (
    <div
      className="card-aurora relative min-w-0 animate-rise overflow-hidden p-4 transition-transform duration-300 hover:-translate-y-0.5"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-[11px] uppercase tracking-widest text-mist-500">{label}</div>
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg bg-tint ring-1 ring-line ${text}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-3 truncate font-mono text-2xl font-bold tabular-nums text-strong">{value}</div>
      <div className="mt-1 truncate text-sm text-mist-500">{hint}</div>
      <div aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r ${bar} to-transparent`} />
    </div>
  );
}

// The CodinGame board: only members who linked a CodinGame account.
export default function CodinGamePage({ users, loading = false }: { users: User[]; loading?: boolean }) {
  const [sortBy, setSortBy] = useState<Sort>("xp");

  const all: Member[] = [];
  for (const user of users) {
    const account = user.platforms?.codingame;
    if (account) all.push({ user, account });
  }
  const members = [...all].sort(compare(sortBy));
  const weeklyMax = Math.max(1, ...members.map((m) => m.account.weeklySolved));

  const squadXp = all.reduce((acc, m) => acc + m.account.solved, 0);
  const weeklyXp = all.reduce((acc, m) => acc + m.account.weeklySolved, 0);
  const topLevel = all
    .filter((m) => m.account.rating != null)
    .sort((a, b) => b.account.rating! - a.account.rating!)[0];

  // The three "player cards": the top of the ranking currently selected.
  const cards = members.filter((m) => sortBy !== "level" || m.account.rating != null).slice(0, 3);

  return (
    <div className="space-y-6">
      {/* ---------- HUD ---------- */}
      {!loading && all.length > 0 && (
        <section aria-label="CodinGame summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HudTile
            index={0}
            label="Players"
            value={String(all.length)}
            hint={`of ${users.length} on the board`}
            Icon={Users}
            text="text-sky-400"
            bar="from-sky-400"
          />
          <HudTile
            index={1}
            label="Squad XP"
            value={squadXp.toLocaleString()}
            hint={`${Math.round(squadXp / all.length).toLocaleString()} per player`}
            Icon={Swords}
            text="text-lime-400"
            bar="from-lime-400"
          />
          <HudTile
            index={2}
            label="XP this week"
            value={`+${weeklyXp.toLocaleString()}`}
            hint="across linked players"
            Icon={TrendingUp}
            text="text-emerald-400"
            bar="from-emerald-400"
          />
          <HudTile
            index={3}
            label="Highest level"
            value={topLevel ? `LV ${topLevel.account.rating}` : "–"}
            hint={topLevel ? topLevel.user.displayName : "nobody levelled yet"}
            Icon={Crown}
            text="text-amber-300"
            bar="from-amber-300"
          />
        </section>
      )}

      {/* ---------- Player cards ---------- */}
      {!loading && cards.length > 0 && (
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
                      <img
                        src={user.avatarUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className={`size-14 rounded-2xl object-cover ring-2 ring-offset-2 ring-offset-ink-900 ${medal.ring}`}
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
      )}

      <section
        id="codingame-panel"
        aria-label="CodinGame leaderboard"
        className="card-aurora animate-rise overflow-hidden"
      >
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between md:p-4">
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
          <div className="px-6 py-16 text-center">
            <div className="animate-float mx-auto mb-3 grid size-12 place-items-center rounded-full bg-ink-800 text-mist-500 ring-1 ring-line">
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
                      <img
                        src={user.avatarUrl}
                        alt=""
                        className="size-11 shrink-0 rounded-xl object-cover ring-2 ring-line-strong ring-offset-2 ring-offset-ink-900 transition duration-300 group-hover/member:scale-105 group-hover/member:ring-lime-400/80"
                        referrerPolicy="no-referrer"
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
