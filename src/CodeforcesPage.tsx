import React, { useState } from "react";
import { ArrowUpRight, Clock, Link2, Users, CheckCheck, TrendingUp, Crown } from "lucide-react";
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

// Three bars, a nod to the platform. Purely decorative.
function CfBars() {
  return (
    <span aria-hidden="true" className="inline-flex h-4 items-end gap-0.5">
      <span className="h-2.5 w-1 rounded-sm bg-amber-400" />
      <span className="h-4 w-1 rounded-sm bg-sky-500" />
      <span className="h-3 w-1 rounded-sm bg-rose-500" />
    </span>
  );
}

// Easy / Medium / Hard (by problem rating) bar, with a balloon per bucket.
export function CodeforcesBucketBar({ buckets }: { buckets: CodeforcesBuckets }) {
  const { easy, medium, hard, unrated } = buckets;
  const total = Math.max(1, easy + medium + hard + unrated);
  const segments = [
    { label: "Easy", letter: "E", value: easy, bar: "bg-gradient-to-r from-emerald-500 to-emerald-300", text: "text-emerald-400" },
    { label: "Medium", letter: "M", value: medium, bar: "bg-gradient-to-r from-amber-500 to-amber-300", text: "text-amber-400" },
    { label: "Hard", letter: "H", value: hard, bar: "bg-gradient-to-r from-rose-500 to-rose-300", text: "text-rose-400" },
    { label: "Unrated", letter: "U", value: unrated, bar: "bg-slate-400", text: "text-mist-400" }
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
                className={`h-full rounded-full ${s.bar} transition-[width] duration-700 ease-out`}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.value} ${s.label}`}
              />
            )
        )}
      </div>
      <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
        {segments.map((s) => (
          <span key={s.label} className={`inline-flex items-center gap-1.5 ${s.text}`}>
            <span className="balloon mb-0.5" aria-hidden="true" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-mist-500">{s.letter}</span>
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

/* ---------- Rating spectrum ---------- */

// Codeforces' own rank bands, drawn as one coloured ruler.
const BANDS = [
  { min: 0, name: "Newbie", bg: "bg-slate-500" },
  { min: 1200, name: "Pupil", bg: "bg-green-500" },
  { min: 1400, name: "Specialist", bg: "bg-cyan-500" },
  { min: 1600, name: "Expert", bg: "bg-blue-500" },
  { min: 1900, name: "Candidate Master", bg: "bg-violet-500" },
  { min: 2100, name: "Master", bg: "bg-orange-500" },
  { min: 2400, name: "Grandmaster", bg: "bg-red-500" }
] as const;
const SPECTRUM_MIN = 800;
const SPECTRUM_MAX = 3000;
const SPECTRUM_TICKS = [1200, 1400, 1600, 1900, 2100, 2400];

const spectrumPct = (rating: number) =>
  Math.min(100, Math.max(0, ((rating - SPECTRUM_MIN) / (SPECTRUM_MAX - SPECTRUM_MIN)) * 100));

// Every rated member placed on the ruler, so you can see who is closing in on
// the next colour at a glance. Neighbours alternate between two heights to
// keep overlapping avatars apart.
function RatingSpectrum({ members }: { members: CodeforcesMember[] }) {
  const rated = members
    .filter((m) => m.account.rating != null)
    .sort((a, b) => a.account.rating! - b.account.rating!);
  if (rated.length === 0) return null;

  return (
    <section aria-label="Rating spectrum" className="card-aurora animate-rise p-5">
      <div className="font-mono text-[11px] uppercase tracking-widest text-mist-500">// rating.spectrum</div>
      <h2 className="mt-1 text-lg font-bold tracking-tight text-strong">Who is closing in on the next colour</h2>

      <div className="mt-4 overflow-x-auto px-4 pb-1">
        <div className="relative h-36 min-w-[34rem]">
          {rated.map(({ user, account }, i) => (
            <a
              key={user.id}
              href={`#/u/${encodeURIComponent(user.leetcodeUsername)}`}
              title={`${user.displayName} · ${account.rating!.toLocaleString()} · ${formatRankTitle(account.rankTitle)}`}
              aria-label={`${user.displayName}, rating ${account.rating}`}
              className={`group/pin absolute flex -translate-x-1/2 flex-col items-center ${focusRing}`}
              style={{ left: `${spectrumPct(account.rating!)}%`, bottom: i % 2 === 0 ? "2.4rem" : "4.9rem" }}
            >
              <img
                src={user.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="size-8 rounded-full object-cover ring-2 ring-ink-900 transition duration-200 group-hover/pin:z-10 group-hover/pin:scale-125"
              />
              <span className="font-mono text-[10px] font-bold tabular-nums text-strong">{account.rating}</span>
              <span className="h-1.5 w-px bg-line-strong" aria-hidden="true" />
            </a>
          ))}

          {/* The ruler */}
          <div className="absolute inset-x-0 bottom-7 flex h-2 overflow-hidden rounded-full">
            {BANDS.map((b, i) => {
              const from = Math.max(b.min, SPECTRUM_MIN);
              const to = i + 1 < BANDS.length ? BANDS[i + 1].min : SPECTRUM_MAX;
              return (
                <div
                  key={b.name}
                  className={`${b.bg} h-full`}
                  style={{ width: `${((to - from) / (SPECTRUM_MAX - SPECTRUM_MIN)) * 100}%` }}
                  title={b.name}
                />
              );
            })}
          </div>
          {SPECTRUM_TICKS.map((t) => (
            <span
              key={t}
              aria-hidden="true"
              className="absolute bottom-0 -translate-x-1/2 font-mono text-[10px] text-mist-500"
              style={{ left: `${spectrumPct(t)}%` }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Summary tiles ---------- */

function SummaryTile({
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

  const all = codeforcesMembers(users);
  const members = [...all].sort(compareCodeforces(sortBy));
  const weeklyMax = Math.max(25, ...members.map((m) => m.account.weeklySolved));

  const totalSolved = all.reduce((acc, m) => acc + m.account.solved, 0);
  const weeklyTotal = all.reduce((acc, m) => acc + m.account.weeklySolved, 0);
  const best = all
    .filter((m) => m.account.rating != null)
    .sort((a, b) => b.account.rating! - a.account.rating!)[0];

  return (
    <div className="space-y-6">
      {/* ---------- Summary ---------- */}
      {!loading && all.length > 0 && (
        <section aria-label="Codeforces summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryTile
            index={0}
            label="Linked"
            value={String(all.length)}
            hint={`of ${users.length} on the board`}
            Icon={Users}
            text="text-sky-400"
            bar="from-sky-400"
          />
          <SummaryTile
            index={1}
            label="Solved"
            value={totalSolved.toLocaleString()}
            hint={`${Math.round(totalSolved / all.length)} per member`}
            Icon={CheckCheck}
            text="text-emerald-400"
            bar="from-emerald-400"
          />
          <SummaryTile
            index={2}
            label="This week"
            value={`+${weeklyTotal}`}
            hint="across linked members"
            Icon={TrendingUp}
            text="text-teal-300"
            bar="from-teal-300"
          />
          <SummaryTile
            index={3}
            label="Top rating"
            value={best ? best.account.rating!.toLocaleString() : "–"}
            hint={best ? `${best.user.displayName} · ${formatRankTitle(best.account.rankTitle)}` : "nobody rated yet"}
            Icon={Crown}
            text="text-amber-300"
            bar="from-amber-300"
          />
        </section>
      )}

      {!loading && <RatingSpectrum members={all} />}

      <section
        id="codeforces-panel"
        aria-label="Codeforces leaderboard"
        className="card-aurora animate-rise overflow-hidden"
      >
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between md:p-4">
          <div className="flex items-center gap-3">
            <CfBars />
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-mist-500">// codeforces.standings</div>
              <p className="text-sm text-mist-400">
                {loading
                  ? "Loading…"
                  : `${members.length} ${members.length === 1 ? "member has" : "members have"} linked Codeforces`}
              </p>
            </div>
          </div>
          <div
            role="group"
            aria-label="Sort Codeforces leaderboard"
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

        {/* Column labels */}
        <div className="hidden grid-cols-12 gap-x-4 border-b border-line bg-ink-950/40 px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-mist-500 md:grid">
          <div className="col-span-1">#</div>
          <div className="col-span-3">Handle</div>
          <div className="col-span-3">{sortBy === "weekly" ? "Tests passed (25)" : "Problems  E · M · H"}</div>
          <div className="col-span-3">Rating</div>
          <div className="col-span-2 pr-1 text-right">&Sigma; Solved</div>
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
            <div className="animate-float mx-auto mb-3 grid size-12 place-items-center rounded-full bg-ink-800 text-mist-500 ring-1 ring-line">
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
              const filled = Math.min(25, Math.round((account.weeklySolved / weeklyMax) * 25));
              // Rating mode ranks only rated members; the rest get a dash.
              const shownRank = sortBy === "rating" && !rated ? null : rank;
              const podium = shownRank != null && shownRank <= 3;
              const stale =
                account.lastUpdated != null && now - new Date(account.lastUpdated).getTime() > STALE_AFTER_MS;

              return (
                <div
                  key={user.id}
                  id={`cf-row-${user.id}`}
                  className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-4 transition-colors hover:bg-ink-800/60 hover:shadow-[inset_3px_0_0_0_var(--color-aurora-b)] md:grid-cols-12 md:gap-x-4 md:px-5"
                >
                  {/* Rank */}
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

                  {/* Member: the handle is coloured by rank, as on Codeforces */}
                  <div className="flex min-w-0 items-center gap-3 md:col-span-3">
                    <a
                      href={`#/u/${encodeURIComponent(user.leetcodeUsername)}`}
                      title={`View profile (@${user.leetcodeUsername})`}
                      className={`group/member flex min-w-0 items-center gap-3 rounded-lg text-left ${focusRing}`}
                    >
                      <img
                        src={user.avatarUrl}
                        alt=""
                        className="size-11 shrink-0 rounded-full object-cover ring-2 ring-line-strong ring-offset-2 ring-offset-ink-900 transition duration-300 group-hover/member:scale-105 group-hover/member:ring-sky-400/80"
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-strong transition-colors group-hover/member:text-teal-300">
                          {user.displayName}
                        </div>
                        <div className={`truncate font-mono text-sm font-semibold ${rankTextClass(account.rankTitle)}`}>
                          {account.handle}
                        </div>
                      </div>
                    </a>
                  </div>

                  {/* Progress */}
                  <div className="order-last col-span-3 md:order-none md:col-span-3 md:pr-4">
                    {account.lastUpdated == null ? (
                      <span className="inline-flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-xs text-mist-400 ring-1 ring-line">
                        <Clock className="size-3" aria-hidden="true" />
                        Not synced yet
                      </span>
                    ) : sortBy === "weekly" ? (
                      <div className="flex w-full items-center gap-3">
                        <div
                          className="flex h-2.5 w-full gap-[2px]"
                          role="img"
                          aria-label={`${account.weeklySolved} solved this week`}
                        >
                          {Array.from({ length: 25 }).map((_, i) => (
                            <span
                              key={i}
                              className={`h-full flex-1 rounded-[2px] transition-colors duration-500 ${
                                i < filled
                                  ? "bg-gradient-to-b from-emerald-300 to-emerald-500 shadow-[0_0_6px_rgb(52_211_153/0.45)]"
                                  : "bg-tint"
                              }`}
                              style={{ transitionDelay: `${i * 12}ms` }}
                            />
                          ))}
                        </div>
                        <span className="w-10 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-emerald-400">
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
                    <span className="font-mono text-xs uppercase tracking-wider text-mist-500 md:hidden">Rating</span>
                    {rated ? (
                      <>
                        <span
                          className={`font-mono text-base font-bold tabular-nums ${rankTextClass(account.rankTitle)}`}
                        >
                          {account.rating!.toLocaleString()}
                        </span>
                        <span
                          className={`font-mono text-[10px] font-semibold uppercase tracking-wider md:block ${rankTextClass(account.rankTitle)}`}
                        >
                          {formatRankTitle(account.rankTitle)}
                          {account.maxRating != null && account.maxRating !== account.rating && (
                            <span className="text-mist-500"> · max {account.maxRating.toLocaleString()}</span>
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-xs uppercase tracking-wider text-mist-500">Unrated</span>
                    )}
                  </div>

                  {/* Total + handle link */}
                  <div className="flex items-center justify-end gap-1 md:col-span-2">
                    <div className="pr-1 text-right">
                      <div className="font-mono text-xl font-bold tabular-nums text-strong">{account.solved}</div>
                      <a
                        href={`https://codeforces.com/profile/${encodeURIComponent(account.handle)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-0.5 rounded font-mono text-[10px] font-bold uppercase tracking-widest text-emerald-400 hover:text-teal-300 ${focusRing}`}
                        title={`${account.handle} on Codeforces`}
                      >
                        <span>AC</span>
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
