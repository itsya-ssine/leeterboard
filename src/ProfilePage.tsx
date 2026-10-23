import React, { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Calendar,
  Check,
  Clock,
  Crown,
  Flame,
  Link2,
  Share2,
  Swords,
  Target,
  Trophy,
  Zap
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { User } from "./types.js";
import type { WeeklyWinner } from "./winners.js";
import { chartColors, useTheme } from "./theme.js";
import { computeBadges, computeGroupAwards } from "./achievements.js";
import { addDays, mondayIndex, type DayActivity } from "./activity.js";
import { computeProfile, WEEKDAYS, type ProfileStats, type RankInfo } from "./profile.js";
import ShareCardModal from "./ShareCardModal.js";

/* ---------- Shared bits ---------- */

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";
const btn = `inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors ${focusRing}`;
const btnSecondary = `${btn} bg-ink-800 text-mist-100 ring-1 ring-line hover:bg-ink-700`;

const HOT_STREAK_THRESHOLD = 12;
const HEATMAP_WEEKS = 10;

const rankColor = (rank: number | null) =>
  rank === 1
    ? "text-amber-300"
    : rank === 2
      ? "text-slate-300"
      : rank === 3
        ? "text-orange-300"
        : "text-strong";

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });

const profileHref = (u: User) => `#/u/${encodeURIComponent(u.leetcodeUsername)}`;

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

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

// Sections fade up one after another.
function Reveal({
  delay = 0,
  className = "",
  children
}: {
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: "easeOut" }}
      className={`h-full ${className}`}
    >
      {children}
    </motion.div>
  );
}

function Panel({
  title,
  subtitle,
  right,
  className = "",
  children
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className={`h-full rounded-xl bg-ink-900 p-5 ring-1 ring-line ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-strong">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-mist-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function SegmentedToggle<T extends string | number>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-ink-950 p-1 ring-1 ring-line">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`h-7 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors ${focusRing} ${
            value === opt.value ? "bg-ink-700 text-strong" : "text-mist-400 hover:text-strong"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Hero ---------- */

function Hero({
  user,
  users,
  stats,
  usersCount
}: {
  user: User;
  users: User[];
  stats: ProfileStats;
  usersCount: number;
}) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const badgesEarned = useMemo(
    () => computeBadges(user, computeGroupAwards(users, Date.now())).filter((b) => b.earned).length,
    [user, users]
  );
  const overall = stats.ranks[0];
  const hot = user.weeklyProgress >= HOT_STREAK_THRESHOLD;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the address bar already holds the shareable link.
    }
  };

  return (
    <section
      id="profile-hero"
      aria-label={`${user.displayName} profile`}
      className="relative overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-line"
    >
      <div
        aria-hidden="true"
        className="h-24 bg-linear-to-r from-teal-400/30 via-teal-400/5 to-amber-400/20 md:h-32"
      />
      <div className="px-5 pb-6 md:px-8">
        <div className="-mt-12 flex flex-col gap-5 md:-mt-14 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end">
            <div className="relative shrink-0">
              <img
                src={user.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="size-24 rounded-full bg-ink-800 object-cover ring-4 ring-ink-900 md:size-28"
              />
              {overall.rank != null && overall.rank <= 3 && (
                <span
                  className={`absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full bg-ink-900 ring-2 ring-line-strong ${rankColor(overall.rank)}`}
                  title={`Rank ${overall.rank} on the board`}
                >
                  <Crown className="size-4" aria-hidden="true" />
                </span>
              )}
            </div>
            <div className="min-w-0 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-strong md:text-3xl">
                  {user.displayName}
                </h1>
                {hot && (
                  <span title="Hot solve streak" className="shrink-0">
                    <Flame className="size-5 text-amber-400" />
                  </span>
                )}
              </div>
              <a
                href={`https://leetcode.com/${encodeURIComponent(user.leetcodeUsername)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-0.5 inline-flex items-center gap-1 rounded text-sm text-mist-400 transition-colors hover:text-teal-300 ${focusRing}`}
              >
                @{user.leetcodeUsername}
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>

              <ul className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                {overall.rank != null && (
                  <li className="inline-flex items-center gap-1.5 rounded-full bg-tint px-2.5 py-1 ring-1 ring-line">
                    <Trophy className={`size-3 ${rankColor(overall.rank)}`} aria-hidden="true" />
                    <span className={`tabular-nums ${rankColor(overall.rank)}`}>#{overall.rank}</span>
                    <span className="text-mist-400">of {usersCount} all time</span>
                  </li>
                )}
                {overall.topPercent != null && usersCount > 1 && (
                  <li className="rounded-full bg-teal-400/10 px-2.5 py-1 text-teal-300 ring-1 ring-teal-400/30">
                    Top {overall.topPercent}%
                  </li>
                )}
                {stats.wins.length > 0 && (
                  <li className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-amber-300 ring-1 ring-amber-300/30">
                    <Crown className="size-3" aria-hidden="true" />
                    {stats.wins.length} weekly {stats.wins.length === 1 ? "win" : "wins"}
                  </li>
                )}
                {stats.joinedOrder != null && (
                  <li className="rounded-full bg-tint px-2.5 py-1 text-mist-400 ring-1 ring-line">
                    Member #{stats.joinedOrder}
                  </li>
                )}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <a href="#/" className={btnSecondary}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Leaderboard
            </a>
            <a href={`#/compare/${encodeURIComponent(user.leetcodeUsername)}`} className={btnSecondary}>
              <Swords className="size-4" aria-hidden="true" />
              Compare
            </a>
            <button type="button" onClick={copyLink} className={btnSecondary}>
              {copied ? (
                <Check className="size-4 text-teal-300" aria-hidden="true" />
              ) : (
                <Link2 className="size-4" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy link"}
            </button>
            <button type="button" onClick={() => setSharing(true)} id="share-card-btn" className={btnSecondary}>
              <Share2 className="size-4" aria-hidden="true" />
              Share card
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {sharing && (
          <ShareCardModal
            user={user}
            rank={overall.rank}
            rankOf={overall.of}
            topPercent={overall.topPercent}
            badgesEarned={badgesEarned}
            onClose={() => setSharing(false)}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

/* ---------- KPI cards ---------- */

interface Kpi {
  label: string;
  value: React.ReactNode;
  hint: React.ReactNode;
  accent?: boolean;
  icon: React.ReactNode;
}

function KpiGrid({ user, stats }: { user: User; stats: ProfileStats }) {
  const overall = stats.ranks[0];
  const delta = stats.weekDelta;
  const streak = user.currentStreak;

  const kpis: Kpi[] = [
    {
      label: "Problems solved",
      value: user.allTimeSolved.toLocaleString(),
      hint: overall.rank != null ? `#${overall.rank} of ${overall.of} members` : "Not ranked yet",
      icon: <Target className="size-4" />
    },
    {
      label: "This week",
      value: `+${user.weeklyProgress}`,
      accent: true,
      hint:
        delta == null ? (
          "No full week to compare yet"
        ) : delta === 0 ? (
          "Same as last week"
        ) : (
          <span className={`inline-flex items-center gap-1 ${delta > 0 ? "text-emerald-300" : "text-rose-300"}`}>
            {delta > 0 ? (
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            ) : (
              <ArrowDownRight className="size-3.5" aria-hidden="true" />
            )}
            {Math.abs(delta)} {delta > 0 ? "more" : "fewer"} than last week
          </span>
        ),
      icon: <Zap className="size-4" />
    },
    {
      label: "This month",
      value: `+${user.monthlyProgress}`,
      hint: stats.avgPerDay != null ? `${fmt1(stats.avgPerDay)} problems per day` : "Not enough history",
      icon: <Calendar className="size-4" />
    },
    {
      label: "Current streak",
      value: (
        <span className="inline-flex items-center gap-1.5">
          <Flame className={`size-6 ${(streak ?? 0) > 0 ? "text-amber-400" : "text-mist-500"}`} aria-hidden="true" />
          {streak ?? "–"}
        </span>
      ),
      hint: user.longestStreak != null ? `Longest: ${user.longestStreak} days` : "Not fetched yet",
      icon: <Flame className="size-4" />
    },
    {
      label: "Contest rating",
      value: user.contestRating != null ? user.contestRating.toLocaleString() : "Unrated",
      hint:
        user.contestRating != null
          ? `${user.contestsAttended} ${user.contestsAttended === 1 ? "contest" : "contests"} entered`
          : "No contest entered yet",
      icon: <Trophy className="size-4" />
    },
    {
      label: "Active days",
      value:
        stats.trackedDays30 > 0 ? (
          <>
            {stats.activeDays30}
            <span className="text-lg font-medium text-mist-500">/{stats.trackedDays30}</span>
          </>
        ) : (
          "–"
        ),
      hint: stats.consistency != null ? `${stats.consistency}% consistency, last 30 days` : "Not enough history",
      icon: <Check className="size-4" />
    },
    {
      label: "Best day",
      value: stats.bestDay ? stats.bestDay.solved : "–",
      hint: stats.bestDay ? longDate(stats.bestDay.date) : "Nothing recorded yet",
      icon: <Zap className="size-4" />
    },
    {
      label: "Hard problems",
      value: user.hardSolved.toLocaleString(),
      hint: `${Math.round(stats.hardShare * 100)}% of everything solved`,
      icon: <Target className="size-4" />
    }
  ];

  return (
    <section
      id="profile-stats"
      aria-label="Key stats"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line lg:grid-cols-4"
    >
      {kpis.map((k) => (
        <div key={k.label} className="min-w-0 bg-ink-900 p-5">
          <div className="flex items-center justify-between gap-2 text-sm text-mist-500">
            <span className="truncate">{k.label}</span>
            <span className="shrink-0 text-mist-500/70" aria-hidden="true">
              {k.icon}
            </span>
          </div>
          <div
            className={`mt-2 truncate text-3xl font-semibold tracking-tight tabular-nums ${
              k.accent ? "text-teal-300" : "text-strong"
            }`}
          >
            {k.value}
          </div>
          <div className="mt-1 truncate text-sm text-mist-500">{k.hint}</div>
        </div>
      ))}
    </section>
  );
}

/* ---------- Progress chart ---------- */

type ChartMode = "total" | "daily";

function ProgressChart({ user, stats }: { user: User; stats: ProfileStats }) {
  const [range, setRange] = useState<14 | 30 | 60>(30);
  const [mode, setMode] = useState<ChartMode>("total");
  const { theme } = useTheme();
  const c = chartColors(theme);

  const cutoff = addDays(stats.today, -(range - 1));
  const totals = [...(user.history ?? [])]
    .filter((h) => h.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => ({ date: h.date, value: h.solvedCount }));
  const perDay = stats.daily.filter((d) => d.tracked && d.date >= cutoff).map((d) => ({ date: d.date, value: d.solved }));

  const series = mode === "total" ? totals : perDay;
  const gained = mode === "total" && totals.length > 1 ? totals[totals.length - 1].value - totals[0].value : null;
  const dailySum = mode === "daily" ? perDay.reduce((a, d) => a + d.value, 0) : null;

  const tooltipProps = {
    cursor: { stroke: c.cursor, fill: c.grid },
    contentStyle: {
      background: c.tooltipBg,
      border: `1px solid ${c.tooltipBorder}`,
      borderRadius: 8,
      color: c.tooltipText,
      fontSize: 13
    },
    labelStyle: { color: c.tooltipLabel },
    labelFormatter: (label: unknown) => shortDate(String(label))
  };
  const axisTick = { fill: c.tick, fontSize: 12 };

  return (
    <Panel
      title="Progress"
      subtitle={
        mode === "total"
          ? gained != null
            ? `+${gained} problems in the last ${range} days`
            : "Total problems solved over time"
          : dailySum != null
            ? `${dailySum} problems solved in the last ${range} days`
            : "Problems solved per day"
      }
      right={
        <div className="flex flex-wrap gap-2">
          <SegmentedToggle<ChartMode>
            label="Chart type"
            value={mode}
            onChange={setMode}
            options={[
              { value: "total", label: "Total" },
              { value: "daily", label: "Per day" }
            ]}
          />
          <SegmentedToggle<14 | 30 | 60>
            label="Time range"
            value={range}
            onChange={setRange}
            options={[
              { value: 14, label: "14d" },
              { value: 30, label: "30d" },
              { value: 60, label: "60d" }
            ]}
          />
        </div>
      }
    >
      {series.length < 2 ? (
        <p className="py-16 text-center text-sm text-mist-500">
          The chart appears once there are a couple of days of history.
        </p>
      ) : (
        <div
          className="h-64 w-full"
          role="img"
          aria-label={`${mode === "total" ? "Total solved" : "Solved per day"} for ${user.displayName} over the last ${range} days`}
        >
          <ResponsiveContainer width="100%" height="100%">
            {mode === "total" ? (
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="profileFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={axisTick} tickLine={false} axisLine={false} minTickGap={32} />
                <YAxis
                  domain={[
                    (min: number) => Math.max(0, Math.floor(min - 2)),
                    (max: number) => Math.ceil(max + 2)
                  ]}
                  allowDecimals={false}
                  tickFormatter={(v: number) => v.toLocaleString()}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip {...tooltipProps} formatter={(v) => [Number(v).toLocaleString(), "Solved"]} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={c.accent}
                  strokeWidth={2}
                  fill="url(#profileFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            ) : (
              <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={axisTick} tickLine={false} axisLine={false} minTickGap={32} />
                <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={32} />
                <Tooltip {...tooltipProps} formatter={(v) => [Number(v).toLocaleString(), "Solved"]} />
                <Bar dataKey="value" fill={c.accent} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

/* ---------- Milestone + records ---------- */

function MilestoneAndRecords({ user, stats }: { user: User; stats: ProfileStats }) {
  const m = stats.milestone;
  const pct = m ? Math.min(100, Math.round(((user.allTimeSolved - m.previous) / (m.target - m.previous)) * 100)) : 100;

  const rows: { label: string; value: string }[] = [
    { label: "Best day", value: stats.bestDay ? `${stats.bestDay.solved} · ${shortDate(stats.bestDay.date)}` : "–" },
    {
      label: "Best full week",
      value: stats.bestWeek ? `${stats.bestWeek.solved} · from ${shortDate(stats.bestWeek.weekStart)}` : "–"
    },
    {
      label: "Strongest weekday",
      value:
        stats.bestWeekday != null
          ? `${WEEKDAYS[stats.bestWeekday]} · avg ${fmt1(stats.weekdayAvg[stats.bestWeekday] ?? 0)}`
          : "–"
    },
    {
      label: "Per active day",
      value: stats.avgPerActiveDay != null ? `${fmt1(stats.avgPerActiveDay)} problems` : "–"
    },
    {
      label: "Last solve",
      value:
        stats.idleDays == null
          ? "–"
          : stats.idleDays === 0
            ? "Today"
            : stats.idleDays === 1
              ? "Yesterday"
              : `${stats.idleDays} days ago`
    },
    { label: "Tracked since", value: stats.trackedSince ? shortDate(stats.trackedSince) : "–" }
  ];

  return (
    <Panel title="Next milestone" subtitle={m ? `Heading for ${m.target.toLocaleString()} solved` : "Every milestone reached"}>
      {m ? (
        <div className="mb-5">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-semibold tabular-nums text-strong">{user.allTimeSolved.toLocaleString()}</span>
            <span className="tabular-nums text-mist-500">{m.target.toLocaleString()}</span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-tint"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={`${pct}% of the way to ${m.target} solved`}
          >
            <div className="h-full rounded-full bg-linear-to-r from-teal-400 to-teal-300 transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm text-mist-400">
            <span className="font-semibold tabular-nums text-strong">{m.remaining}</span> to go
            {m.etaDays != null && (
              <>
                , about <span className="font-semibold tabular-nums text-teal-300">{m.etaDays}</span>{" "}
                {m.etaDays === 1 ? "day" : "days"} at the current pace
              </>
            )}
            .
          </p>
        </div>
      ) : null}

      <dl className="divide-y divide-line border-t border-line text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-mist-500">{r.label}</dt>
            <dd className="text-right font-medium tabular-nums text-strong">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/* ---------- Difficulty ---------- */

const DIFFS = [
  { key: "easy", label: "Easy", stroke: "stroke-emerald-400", bar: "bg-emerald-400", text: "text-emerald-300" },
  { key: "medium", label: "Medium", stroke: "stroke-amber-400", bar: "bg-amber-400", text: "text-amber-300" },
  { key: "hard", label: "Hard", stroke: "stroke-rose-400", bar: "bg-rose-400", text: "text-rose-300" }
] as const;

function Donut({ easy, medium, hard }: { easy: number; medium: number; hard: number }) {
  const total = easy + medium + hard;
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const values = { easy, medium, hard };

  return (
    <div className="relative size-40 shrink-0">
      <svg viewBox="0 0 140 140" className="size-full -rotate-90" role="img" aria-label={`${easy} easy, ${medium} medium, ${hard} hard`}>
        <circle cx="70" cy="70" r={R} fill="none" strokeWidth="14" className="stroke-ink-800" />
        {total > 0 &&
          DIFFS.map((d) => {
            const len = (values[d.key] / total) * C;
            const gap = values[d.key] > 0 && len > 3 ? 2 : 0;
            const el = (
              <circle
                key={d.key}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                strokeWidth="14"
                strokeLinecap="butt"
                strokeDasharray={`${Math.max(0, len - gap)} ${C}`}
                strokeDashoffset={-offset}
                className={d.stroke}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-2xl font-semibold tabular-nums text-strong">{total.toLocaleString()}</div>
          <div className="text-xs text-mist-500">solved</div>
        </div>
      </div>
    </div>
  );
}

function DifficultyPanel({ user, stats }: { user: User; stats: ProfileStats }) {
  const total = user.easySolved + user.mediumSolved + user.hardSolved;
  const values = { easy: user.easySolved, medium: user.mediumSolved, hard: user.hardSolved };
  const avg = stats.rosterAvg;
  const gained = stats.gained30;

  return (
    <Panel title="Difficulty" subtitle="How the solved problems split, and how that compares with the board">
      <div className="flex flex-col items-center gap-6 sm:flex-row">
        <Donut easy={user.easySolved} medium={user.mediumSolved} hard={user.hardSolved} />
        <ul className="w-full min-w-0 flex-1 space-y-3.5">
          {DIFFS.map((d) => {
            const v = values[d.key];
            const a = avg ? avg[d.key] : null;
            const scale = Math.max(1, v, a ?? 0);
            const diff = a == null ? null : Math.round(v - a);
            return (
              <li key={d.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                  <span className={`inline-flex items-center gap-2 ${d.text}`}>
                    <span className={`size-2 rounded-full ${d.bar}`} aria-hidden="true" />
                    <span className="text-mist-400">{d.label}</span>
                    <span className="font-semibold tabular-nums">{v}</span>
                    <span className="text-xs tabular-nums text-mist-500">
                      {total > 0 ? Math.round((v / total) * 100) : 0}%
                    </span>
                  </span>
                  {diff != null && (
                    <span
                      className={`text-xs tabular-nums ${
                        diff > 0 ? "text-emerald-300" : diff < 0 ? "text-mist-500" : "text-mist-500"
                      }`}
                      title={`Board average: ${fmt1(a ?? 0)}`}
                    >
                      {diff > 0 ? "+" : ""}
                      {diff} vs avg
                    </span>
                  )}
                </div>
                <div className="relative h-2 rounded-full bg-tint" aria-hidden="true">
                  <div className={`h-full rounded-full ${d.bar}`} style={{ width: `${(v / scale) * 100}%` }} />
                  {a != null && (
                    <span
                      className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded bg-strong/70"
                      style={{ left: `calc(${(a / scale) * 100}% - 1px)` }}
                      title={`Board average: ${fmt1(a)}`}
                    />
                  )}
                </div>
              </li>
            );
          })}
          {avg && <li className="text-xs text-mist-500">The white tick marks the board average.</li>}
        </ul>
      </div>

      {gained && (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-4 text-sm">
          <span className="font-medium text-mist-400">Last 30 days</span>
          {DIFFS.map((d) => (
            <span key={d.key} className={`inline-flex items-center gap-1.5 ${d.text}`}>
              <span className={`size-1.5 rounded-full ${d.bar}`} aria-hidden="true" />
              <span className="font-semibold tabular-nums">+{gained[d.key]}</span>
              <span className="text-mist-500">{d.label.toLowerCase()}</span>
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------- Heatmap ---------- */

const LEVEL_CLASS = ["bg-ink-800", "bg-teal-400/25", "bg-teal-400/50", "bg-teal-400/75", "bg-teal-300"];
const NO_DATA_CLASS = "bg-transparent ring-1 ring-inset ring-line";
const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

function levelFor(solved: number, max: number): number {
  if (solved <= 0 || max <= 0) return 0;
  const ratio = solved / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function Heatmap({ stats }: { stats: ProfileStats }) {
  const { columns, max, total } = useMemo(() => {
    const start = addDays(stats.today, -mondayIndex(stats.today) - (HEATMAP_WEEKS - 1) * 7);
    const byDate = new Map(stats.daily.map((d) => [d.date, d]));
    const days: DayActivity[] = [];
    for (let d = start; d <= stats.today; d = addDays(d, 1)) {
      days.push(byDate.get(d) ?? { date: d, solved: 0, tracked: false });
    }
    const cols: (DayActivity | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      const col: (DayActivity | null)[] = days.slice(i, i + 7);
      while (col.length < 7) col.push(null);
      cols.push(col);
    }
    const tracked = days.filter((d) => d.tracked);
    return {
      columns: cols,
      max: tracked.reduce((m, d) => Math.max(m, d.solved), 0),
      total: tracked.reduce((a, d) => a + d.solved, 0)
    };
  }, [stats]);

  return (
    <Panel
      title="Activity"
      subtitle="Problems solved per day, in UTC days"
      right={
        stats.hasHistory ? (
          <div className="text-sm text-mist-400">
            <span className="font-semibold tabular-nums text-strong">{total.toLocaleString()}</span> in the last{" "}
            {HEATMAP_WEEKS} weeks
          </div>
        ) : undefined
      }
    >
      {!stats.hasHistory ? (
        <p className="py-10 text-center text-sm text-mist-500">
          The heatmap fills in once this member has more than one day of history.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto pb-1">
            <div
              role="img"
              aria-label={`Activity heatmap for the last ${HEATMAP_WEEKS} weeks: ${total} problems solved`}
              className="flex w-max gap-2"
            >
              <div aria-hidden="true" className="flex flex-col gap-1 pr-1">
                {WEEKDAY_LABELS.map((label, i) => (
                  <div key={i} className="h-5 text-xs leading-5 text-mist-500">
                    {label}
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                {columns.map((col, ci) => (
                  <div key={ci} className="flex flex-col gap-1">
                    {col.map((day, ri) =>
                      day ? (
                        <div
                          key={day.date}
                          title={day.tracked ? `${longDate(day.date)}: ${day.solved} solved` : `${longDate(day.date)}: not tracked yet`}
                          className={`size-5 rounded-[4px] ${day.tracked ? LEVEL_CLASS[levelFor(day.solved, max)] : NO_DATA_CLASS}`}
                        />
                      ) : (
                        <div key={`future-${ri}`} className="size-5" />
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-xs text-mist-500">
            <div className="flex items-center gap-1.5">
              <span className={`size-3.5 rounded-[3px] ${NO_DATA_CLASS}`} />
              Not tracked
            </div>
            <div className="flex items-center gap-1.5">
              Less
              {LEVEL_CLASS.map((cls, i) => (
                <span key={i} className={`size-3.5 rounded-[3px] ${cls}`} />
              ))}
              More
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------- Weekly sprints + weekday pattern ---------- */

function WeeklySprints({ stats }: { stats: ProfileStats }) {
  const max = Math.max(1, ...stats.weeks.map((w) => w.solved));
  const hasAny = stats.weeks.some((w) => w.tracked);

  return (
    <Panel title="Weekly sprints" subtitle="Problems solved per week, Monday to Sunday">
      {!hasAny ? (
        <p className="py-10 text-center text-sm text-mist-500">Weekly bars appear once history builds up.</p>
      ) : (
        <>
          <ol className="flex h-44 items-end gap-2" aria-label="Solved per week, oldest first">
            {stats.weeks.map((w) => {
              const h = w.tracked ? Math.max(4, (w.solved / max) * 100) : 0;
              return (
                <li
                  key={w.weekStart}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                  title={`Week of ${shortDate(w.weekStart)}: ${w.tracked ? `${w.solved} solved` : "not tracked"}${
                    w.partial && w.tracked ? " (partial week)" : ""
                  }${w.won ? " · topped the board" : ""}`}
                >
                  <span className="flex h-4 items-center text-xs font-medium tabular-nums text-mist-400">
                    {w.won && <Crown className="mr-0.5 size-3 text-amber-300" aria-label="Won the week" />}
                    {w.tracked ? w.solved : ""}
                  </span>
                  <div className="flex w-full flex-1 items-end">
                    {w.tracked ? (
                      <div
                        className={`w-full rounded-t-md ${
                          w.current ? "bg-teal-300" : w.partial ? "bg-teal-400/40" : "bg-teal-400/70"
                        }`}
                        style={{ height: `${h}%` }}
                      />
                    ) : (
                      <div className="h-1 w-full rounded bg-tint" />
                    )}
                  </div>
                  <span className="text-[11px] text-mist-500">{shortDate(w.weekStart)}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-mist-500">
            The bright bar is the current week. Faded bars are weeks that started before tracking began.
          </p>
        </>
      )}
    </Panel>
  );
}

function WeekdayPattern({ stats }: { stats: ProfileStats }) {
  const vals = stats.weekdayAvg;
  const max = Math.max(0.0001, ...vals.map((v) => v ?? 0));
  const any = vals.some((v) => v != null);

  return (
    <Panel
      title="Weekday rhythm"
      subtitle={
        stats.bestWeekday != null ? `Strongest on ${WEEKDAYS[stats.bestWeekday]}s` : "Average problems solved per weekday"
      }
    >
      {!any ? (
        <p className="py-10 text-center text-sm text-mist-500">Not enough history yet.</p>
      ) : (
        <ol className="flex h-44 items-end gap-2" aria-label="Average solved per weekday">
          {WEEKDAYS.map((name, i) => {
            const v = vals[i];
            const best = i === stats.bestWeekday;
            return (
              <li key={name} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${name}: ${v == null ? "no data" : `${fmt1(v)} per day on average`}`}>
                <span className={`text-xs font-medium tabular-nums ${best ? "text-teal-300" : "text-mist-400"}`}>
                  {v == null ? "" : fmt1(v)}
                </span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t-md ${best ? "bg-teal-300" : "bg-teal-400/45"}`}
                    style={{ height: `${v == null ? 0 : Math.max(4, (v / max) * 100)}%` }}
                  />
                </div>
                <span className={`text-[11px] ${best ? "font-medium text-strong" : "text-mist-500"}`}>{name}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

/* ---------- Standing on the board ---------- */

function rankRow(r: RankInfo) {
  const pct = r.rank == null || r.of === 0 ? 0 : Math.round(((r.of - r.rank + 1) / r.of) * 100);
  return (
    <li key={r.key} className="py-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-mist-400">{r.label}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-xs tabular-nums text-mist-500">{r.value}</span>
          {r.rank != null ? (
            <span className={`font-semibold tabular-nums ${rankColor(r.rank)}`}>
              #{r.rank}
              <span className="ml-1 text-xs font-normal text-mist-500">of {r.of}</span>
            </span>
          ) : (
            <span className="text-mist-500">Unranked</span>
          )}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-tint" aria-hidden="true">
        <div className="h-full rounded-full bg-teal-400/80 transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

function NeighbourCard({
  neighbour,
  direction
}: {
  neighbour: { user: User; gap: number };
  direction: "above" | "below";
}) {
  const { user, gap } = neighbour;
  return (
    <a
      href={profileHref(user)}
      className={`group flex items-center gap-3 rounded-lg bg-ink-950 p-3 ring-1 ring-line transition-colors hover:ring-line-strong ${focusRing}`}
    >
      <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-full bg-ink-800 object-cover ring-1 ring-line-strong" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-strong transition-colors group-hover:text-teal-300">{user.displayName}</div>
        <div className="truncate text-xs text-mist-500">
          {direction === "above" ? "Next up" : "Right behind"} · {user.allTimeSolved.toLocaleString()} solved
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={`text-sm font-semibold tabular-nums ${direction === "above" ? "text-amber-300" : "text-teal-300"}`}>
          {gap === 0 ? "Level" : direction === "above" ? `${gap} ahead` : `${gap} behind`}
        </div>
      </div>
    </a>
  );
}

function Standing({ user, stats }: { user: User; stats: ProfileStats }) {
  const { above, below } = stats.neighbours;
  return (
    <Panel title="Standing on the board" subtitle="Where this member ranks in every category">
      <ul className="divide-y divide-line">
        {stats.ranks.map(rankRow)}
      </ul>
      {(above || below) && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          {above && <NeighbourCard neighbour={above} direction="above" />}
          {below && <NeighbourCard neighbour={below} direction="below" />}
        </div>
      )}
    </Panel>
  );
}

/* ---------- Weekly wins ---------- */

function WeeklyWins({ stats }: { stats: ProfileStats }) {
  const wins = stats.wins;
  return (
    <Panel
      title="Weekly wins"
      subtitle="Weeks this member solved the most on the board"
      right={
        wins.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-sm font-semibold tabular-nums text-amber-300 ring-1 ring-amber-300/30">
            <Crown className="size-3.5" aria-hidden="true" />
            {wins.length}
          </span>
        ) : undefined
      }
    >
      {wins.length === 0 ? (
        <p className="py-6 text-center text-sm text-mist-500">No weekly wins yet. Top the board for a week to earn one.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {wins.slice(0, 6).map((w) => (
            <li key={w.weekStart} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-mist-400">Week of {shortDate(w.weekStart)}</span>
              <span className="font-semibold tabular-nums text-teal-300">+{w.gained}</span>
            </li>
          ))}
          {wins.length > 6 && <li className="pt-2.5 text-xs text-mist-500">and {wins.length - 6} earlier</li>}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- Badges ---------- */

function parseProgress(p: string): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(p);
  if (!m) return null;
  const total = Number(m[2]);
  return total > 0 ? Math.min(100, Math.round((Number(m[1]) / total) * 100)) : null;
}

function BadgesPanel({ user, users, nowMs }: { user: User; users: User[]; nowMs: number }) {
  const badges = computeBadges(user, computeGroupAwards(users, nowMs));
  const earned = badges.filter((b) => b.earned).length;

  return (
    <Panel
      title="Badges"
      subtitle="Milestones earned and the ones still to go"
      right={
        <span className="text-sm tabular-nums text-mist-500">
          <span className="font-semibold text-strong">{earned}</span>/{badges.length} earned
        </span>
      }
    >
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {badges.map((b) => {
          const pct = b.earned ? 100 : parseProgress(b.progress);
          return (
            <li
              key={b.id}
              className={`rounded-lg p-3.5 ring-1 ${
                b.earned ? "bg-teal-400/[0.07] ring-teal-400/30" : "bg-ink-950 ring-line"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                    b.earned ? "bg-teal-400/15 text-teal-300" : "bg-tint text-mist-500"
                  }`}
                  aria-hidden="true"
                >
                  {b.earned ? <Trophy className="size-4" /> : <Clock className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium ${b.earned ? "text-strong" : "text-mist-400"}`}>
                    {b.label}
                    <span className="sr-only"> {b.earned ? "(earned)" : "(locked)"}</span>
                  </div>
                  <div className="mt-0.5 text-xs leading-snug text-mist-500">{b.description}</div>
                </div>
              </div>
              {!b.earned && pct != null && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-tint" aria-hidden="true">
                    <div className="h-full rounded-full bg-teal-400/60" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs tabular-nums text-mist-500">{b.progress}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ---------- Page ---------- */

export default function ProfilePage({
  users,
  winners,
  username,
  lastSyncAll
}: {
  users: User[];
  winners: WeeklyWinner[];
  username: string | null;
  lastSyncAll: string;
}) {
  const user = username
    ? users.find((u) => u.leetcodeUsername.toLowerCase() === username.toLowerCase())
    : undefined;
  const nowMs = Date.now();

  const stats = useMemo(
    () => (user ? computeProfile(user, users, winners, Date.now()) : null),
    [user, users, winners]
  );

  if (!user || !stats) {
    return (
      <div className="rounded-xl bg-ink-900 px-5 py-14 text-center ring-1 ring-line" id="profile-missing">
        <p className="font-medium text-strong">Member not found</p>
        <p className="mt-1 text-sm text-mist-500">
          {username ? `Nobody on the board is called @${username}. They may have left or changed their username.` : "No member selected."}
        </p>
        <a href="#/" className={`${btnSecondary} mt-5`}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to the leaderboard
        </a>
      </div>
    );
  }

  const synced = user.lastUpdated || lastSyncAll;

  return (
    <div id="profile-page" className="space-y-4">
      <Reveal>
        <Hero user={user} users={users} stats={stats} usersCount={users.length} />
      </Reveal>

      <Reveal delay={0.05}>
        <KpiGrid user={user} stats={stats} />
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal delay={0.1} className="lg:col-span-2">
          <ProgressChart user={user} stats={stats} />
        </Reveal>
        <Reveal delay={0.12}>
          <MilestoneAndRecords user={user} stats={stats} />
        </Reveal>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Reveal delay={0.14} className="lg:col-span-3">
          <DifficultyPanel user={user} stats={stats} />
        </Reveal>
        <Reveal delay={0.16} className="lg:col-span-2">
          <Standing user={user} stats={stats} />
        </Reveal>
      </div>

      <Reveal delay={0.18}>
        <Heatmap stats={stats} />
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal delay={0.2} className="lg:col-span-2">
          <WeeklySprints stats={stats} />
        </Reveal>
        <Reveal delay={0.22}>
          <WeekdayPattern stats={stats} />
        </Reveal>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal delay={0.24} className="lg:col-span-2">
          <BadgesPanel user={user} users={users} nowMs={nowMs} />
        </Reveal>
        <Reveal delay={0.26}>
          <WeeklyWins stats={stats} />
        </Reveal>
      </div>

      <p className="flex items-center justify-end gap-2 pt-2 text-sm text-mist-500">
        <Clock className="size-3.5" aria-hidden="true" />
        {synced ? `Stats last synced ${formatAge(synced, nowMs)}` : "Waiting for first sync"}
      </p>
    </div>
  );
}
