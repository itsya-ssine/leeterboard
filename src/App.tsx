import React, { useState, useEffect } from "react";
import {
  Search,
  RefreshCw,
  Trash2,
  Flame,
  ArrowUpRight,
  Pin,
  LogIn,
  LogOut,
  Trophy,
  Clock,
  Activity,
  ListOrdered
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HistoryRecord, User } from "./types.js";
import { useAuth } from "./AuthContext.js";
import LoginModal from "./LoginModal.js";
import Modal from "./Modal.js";
import { computeBadges } from "./achievements.js";
import ActivityHeatmap from "./ActivityHeatmap.js";

/* ---------- Shared style tokens ---------- */

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const btn = `inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnPrimary = `${btn} bg-teal-400 text-ink-950 hover:bg-teal-300`;
const btnSecondary = `${btn} bg-ink-800 text-mist-100 ring-1 ring-line hover:bg-ink-700`;

const inputCls =
  "h-10 w-full rounded-lg bg-ink-950 px-3 text-sm text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50";

const rankColor = (rank: number) =>
  rank === 1
    ? "text-amber-300"
    : rank === 2
      ? "text-slate-300"
      : rank === 3
        ? "text-orange-300"
        : "text-mist-500";

const HOT_STREAK_THRESHOLD = 12;

// Polling cadence while the tab is visible. Hidden tabs don't poll at all.
const POLL_INTERVAL_MS = 15_000;

// A member whose last successful LeetCode fetch is older than this gets a
// "stale" badge. The server syncs every 30 minutes, so a full day without an
// update means their fetches are failing, not that nobody has synced.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const PINNED_STORAGE_KEY = "leeterboard:pinned";

type SortKey = "weekly" | "allTime" | "rating";

/* ---------- Pages + navbar ---------- */

// Two pages share one app shell. They are switched with the URL hash
// (#/ = leaderboard, #/stats = stats) so no server rewrite is needed: a plain
// static host or Vercel serves "/" for both.
type Page = "leaderboard" | "stats";

function readPage(): Page {
  return window.location.hash.startsWith("#/stats") ? "stats" : "leaderboard";
}

const NAV_ITEMS = [
  { page: "leaderboard", href: "#/", label: "Leaderboard", Icon: ListOrdered },
  { page: "stats", href: "#/stats", label: "Stats", Icon: Activity }
] as const;

function NavLinks({ page, className = "" }: { page: Page; className?: string }) {
  return (
    <nav aria-label="Main" className={`items-center gap-1 ${className}`}>
      {NAV_ITEMS.map(({ page: p, href, label, Icon }) => (
        <a
          key={p}
          href={href}
          aria-current={page === p ? "page" : undefined}
          className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${focusRing} ${
            page === p ? "bg-ink-800 text-white ring-1 ring-line" : "text-mist-400 hover:text-white"
          }`}
        >
          <Icon className="size-4" />
          {label}
        </a>
      ))}
    </nav>
  );
}

// Single source of truth for ordering, used for both the absolute ranks and
// the displayed list. Contest mode puts rated members first (highest rating
// first) and unrated members after them, ordered by problems solved.
function compareUsers(sortBy: SortKey) {
  return (a: User, b: User): number => {
    if (sortBy === "rating") {
      const ar = a.contestRating;
      const br = b.contestRating;
      if (ar != null && br == null) return -1;
      if (ar == null && br != null) return 1;
      if (ar != null && br != null && ar !== br) return br - ar;
      return b.allTimeSolved - a.allTimeSolved;
    }
    if (sortBy === "weekly") {
      if (b.weeklyProgress !== a.weeklyProgress) return b.weeklyProgress - a.weeklyProgress;
      return b.allTimeSolved - a.allTimeSolved;
    }
    if (b.allTimeSolved !== a.allTimeSolved) return b.allTimeSolved - a.allTimeSolved;
    return b.weeklyProgress - a.weeklyProgress;
  };
}

/* ---------- URL + localStorage state ---------- */

// ?sort=weekly&q=ali — defaults (allTime, empty search) are left out of the
// URL to keep shared links short.
function readUrlState(): { sort: SortKey; q: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    sort: ((v) => (v === "weekly" || v === "rating" ? v : "allTime"))(params.get("sort")),
    q: params.get("q") ?? ""
  };
}

function readPinned(): string[] {
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // Storage blocked (private mode, disabled cookies) or corrupt JSON.
    return [];
  }
}

/* ---------- Freshness helpers ---------- */

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

function isStale(iso: string, now: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && now - t > STALE_AFTER_MS;
}

const shortDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

/* ---------- Difficulty bar ---------- */

// Segmented Easy/Medium/Hard solve-count bar with the raw counts underneath.
// "sm" is used in leaderboard rows and podium cards, "lg" in the profile modal.
function DifficultyBar({
  easy,
  medium,
  hard,
  size = "sm"
}: {
  easy: number;
  medium: number;
  hard: number;
  size?: "sm" | "lg";
}) {
  const total = Math.max(1, easy + medium + hard);
  const lg = size === "lg";
  const segments = [
    { label: "Easy", value: easy, bar: "bg-emerald-400", text: "text-emerald-300" },
    { label: "Medium", value: medium, bar: "bg-amber-400", text: "text-amber-300" },
    { label: "Hard", value: hard, bar: "bg-rose-400", text: "text-rose-300" }
  ];

  return (
    <div
      className="flex w-full flex-col gap-2"
      role="img"
      aria-label={`${easy} easy, ${medium} medium, ${hard} hard`}
    >
      <div className={`flex w-full gap-0.5 overflow-hidden rounded-full bg-white/5 ${lg ? "h-2.5" : "h-1.5"}`}>
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
      <div className={`flex items-center tabular-nums ${lg ? "gap-5 text-sm" : "gap-3 text-xs"}`}>
        {segments.map((s) => (
          <span key={s.label} className={`inline-flex items-center gap-1.5 ${s.text}`}>
            <span className={`size-1.5 rounded-full ${s.bar}`} />
            {lg && <span className="text-mist-400">{s.label}</span>}
            <span className="font-semibold">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function HotStreak({ className = "size-3.5" }: { className?: string }) {
  return (
    <span title="Hot solve streak" className="shrink-0">
      <Flame className={`${className} text-amber-400`} />
    </span>
  );
}

/* ---------- Sparkline (profile modal) ---------- */

// Cumulative solved count over the last `days` days, from the member's own
// history snapshots (the server keeps up to 60).
function ActivitySparkline({ history, days = 30 }: { history: HistoryRecord[]; days?: number }) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const points = [...(history || [])]
    .filter((h) => h.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length < 2) {
    return (
      <p className="text-sm text-mist-500">Not enough history yet. Check back after a couple of syncs.</p>
    );
  }

  const W = 300;
  const H = 64;
  const PAD = 4;
  const values = points.map((p) => p.solvedCount);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => (max === min ? H / 2 : H - PAD - ((v - min) / (max - min)) * (H - PAD * 2));

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.solvedCount).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`;
  const gained = values[values.length - 1] - values[0];
  const last = points[points.length - 1];

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between text-sm">
        <span className="font-medium text-mist-400">Last {days} days</span>
        <span className="font-semibold tabular-nums text-teal-300">+{gained} solved</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-16 w-full text-teal-300"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Solved count rose from ${values[0]} to ${values[values.length - 1]} over the last ${days} days`}
      >
        <path d={area} fill="currentColor" fillOpacity={0.12} />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(points.length - 1)} cy={y(last.solvedCount)} r={3} fill="currentColor" />
      </svg>
      <div className="mt-2 flex justify-between text-xs tabular-nums text-mist-500">
        <span>{shortDate(points[0].date)}</span>
        <span>{shortDate(last.date)}</span>
      </div>
    </div>
  );
}

/* ---------- Streaks + badges (profile modal) ---------- */

// Daily-submission streaks (LeetCode's own numbers, stored by the server at
// sync time) and milestone badges. A null streak means it hasn't been fetched
// yet, which is shown as a dash rather than a misleading 0.
function StreaksAndBadges({ user }: { user: User }) {
  const current = user.currentStreak;
  const longest = user.longestStreak;
  const badges = computeBadges(user);
  const earned = badges.filter((b) => b.earned).length;

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line">
        <div className="bg-ink-900 p-3">
          <div className="flex items-center gap-1.5 text-xl font-semibold tabular-nums text-white">
            <Flame className={`size-4 ${(current ?? 0) > 0 ? "text-amber-400" : "text-mist-500"}`} />
            {current ?? "–"}
          </div>
          <div className="mt-0.5 text-xs text-mist-500">Current streak (days)</div>
        </div>
        <div className="bg-ink-900 p-3">
          <div className="text-xl font-semibold tabular-nums text-white">{longest ?? "–"}</div>
          <div className="mt-0.5 text-xs text-mist-500">Longest streak (days)</div>
        </div>
      </div>

      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium text-mist-400">Badges</span>
        <span className="tabular-nums text-mist-500">
          {earned}/{badges.length}
        </span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {badges.map((b) => (
          <li
            key={b.id}
            title={b.earned ? b.description : `${b.description}${b.progress ? ` (${b.progress})` : ""}`}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
              b.earned
                ? "bg-teal-400/10 text-teal-300 ring-teal-400/30"
                : "bg-white/5 text-mist-500 ring-line"
            }`}
          >
            {b.earned ? <Trophy className="size-3" /> : <Clock className="size-3" />}
            <span>{b.label}</span>
            {!b.earned && b.progress && <span className="tabular-nums text-mist-500">{b.progress}</span>}
            <span className="sr-only">{b.earned ? "(earned)" : "(locked)"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Group growth chart ---------- */

interface TrendPoint {
  date: string;
  solved: number;
  activeUsers: number;
}

function GroupGrowthChart({ trend }: { trend: any }) {
  const series: TrendPoint[] = trend?.historyTrend ?? [];
  const breakdown: { name: string; value: number }[] = trend?.difficultyBreakdown ?? [];
  const pick = (name: string) => breakdown.find((b) => b.name === name)?.value ?? 0;

  return (
    <section
      id="growth-panel"
      aria-label="Group growth"
      className="mb-8 rounded-xl bg-ink-900 p-5 ring-1 ring-line"
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-white">Group growth</h2>
        <p className="mt-0.5 text-sm text-mist-500">Total problems solved by the whole roster over time</p>
      </div>

      {series.length < 2 ? (
        <p className="py-10 text-center text-sm text-mist-500">
          The chart appears once the board has more than one day of history.
        </p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fill: "#7d8799", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                domain={[
                  (min: number) => Math.max(0, Math.floor(min * 0.98)),
                  (max: number) => Math.ceil(max * 1.02)
                ]}
                allowDecimals={false}
                tickFormatter={(v: number) => v.toLocaleString()}
                tick={{ fill: "#7d8799", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.18)" }}
                contentStyle={{
                  background: "#171c25",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 8,
                  color: "#e8ebf1",
                  fontSize: 13
                }}
                labelStyle={{ color: "#a3acbb" }}
                labelFormatter={(label) => shortDate(String(label))}
                formatter={(value) => [Number(value).toLocaleString(), "Solved"]}
              />
              <Area
                type="monotone"
                dataKey="solved"
                stroke="#2dd4bf"
                strokeWidth={2}
                fill="url(#growthFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {breakdown.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-3 text-sm font-medium text-mist-400">Solved by difficulty, whole roster</div>
          <DifficultyBar easy={pick("Easy")} medium={pick("Medium")} hard={pick("Hard")} size="lg" />
        </div>
      )}
    </section>
  );
}

/* ---------- App ---------- */

export default function App() {
  const { status: authStatus, user: currentUser, logout } = useAuth();
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [lastSyncAll, setLastSyncAll] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>(() => readUrlState().q);
  const [sortBy, setSortBy] = useState<SortKey>(() => readUrlState().sort);
  const [loading, setLoading] = useState(true);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [pinnedUsers, setPinnedUsers] = useState<string[]>(readPinned);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>(readPage);

  // Follow the hash (nav clicks, back/forward) and start each page at the top.
  useEffect(() => {
    const onHashChange = () => {
      setPage(readPage());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Trend analysis state
  const [trendData, setTrendData] = useState<any>(null);

  // Fetch users and metrics
  const loadData = async () => {
    try {
      const usersRes = await fetch("/api/users");
      const usersData = await usersRes.json();
      setUsers(usersData.users || []);
      setLastSyncAll(usersData.lastSyncAll || "");

      const trendsRes = await fetch("/api/trends");
      const trendsData = await trendsRes.json();
      setTrendData(trendsData);
    } catch (err) {
      console.error("Error loading data from server:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Poll for updates so everyone sees new stats without a manual reload —
    // the server also runs a real background sync every 30 minutes. Polling
    // only runs while the tab is visible: a hidden tab stops hitting
    // /api/users and /api/trends, and catches up with one fetch the moment
    // it becomes visible again.
    let timer: ReturnType<typeof setInterval> | undefined;
    const startPolling = () => {
      if (timer === undefined) timer = setInterval(loadData, POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadData();
        startPolling();
      } else {
        stopPolling();
      }
    };

    loadData(); // always load once, even if the tab was opened in the background
    if (document.visibilityState === "visible") startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Mirror the view into the address bar (?sort=weekly&q=ali) so it can be
  // shared. replaceState, not pushState, so typing doesn't flood the back
  // button. Other params and the hash are preserved.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (sortBy === "allTime") params.delete("sort");
    else params.set("sort", sortBy);
    if (searchQuery) params.set("q", searchQuery);
    else params.delete("q");
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", next);
  }, [sortBy, searchQuery]);

  // Pinned members survive a refresh.
  useEffect(() => {
    try {
      window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinnedUsers));
    } catch {
      // Storage unavailable — pins still work for this session.
    }
  }, [pinnedUsers]);

  // Handle batch refresh / sync — admin only (button is hidden for
  // everyone else, and the server enforces this too).
  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    try {
      const res = await fetch("/api/refresh-all", { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to sync entire roster.");
      }
      await loadData();
    } catch (err) {
      alert("Failed to batch update. Try again later.");
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Handle remove user
  const handleRemoveUser = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove Member ${name} from the board?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error("Error removing member:", err);
    }
  };

  // Toggle pinned/compare users
  const togglePinUser = (id: string) => {
    if (pinnedUsers.includes(id)) {
      setPinnedUsers(pinnedUsers.filter(userId => userId !== id));
    } else {
      setPinnedUsers([...pinnedUsers, id]);
    }
  };

  // Filter and sort user list
  const filteredUsers = users.filter(u => {
    const q = searchQuery.toLowerCase();
    return (
      u.displayName.toLowerCase().includes(q) ||
      u.leetcodeUsername.toLowerCase().includes(q)
    );
  });

  // Calculate dynamic absolute ranks based on selected sortBy criteria (independent of pinning or search filtering)
  const rankedUsers = [...users].sort(compareUsers(sortBy));

  // Map user ID to their dynamic absolute rank
  const userRanks: Record<string, number> = {};
  rankedUsers.forEach((user, index) => {
    userRanks[user.id] = index + 1;
  });

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    // Pinned users always stay on top
    const aPinned = pinnedUsers.includes(a.id);
    const bPinned = pinnedUsers.includes(b.id);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    return compareUsers(sortBy)(a, b);
  });

  // The rank to display for a member. In contest mode, unrated members have no
  // position in that ranking, so they get a dash instead of a misleading #N.
  const displayRank = (u: User): number | null =>
    sortBy === "rating" && u.contestRating == null ? null : userRanks[u.id] || u.rank;

  // Derived stats values
  const totalSolvedAggregate = users.reduce((acc, u) => acc + u.allTimeSolved, 0);
  const averageSolved = users.length > 0 ? Math.round(totalSolvedAggregate / users.length) : 0;
  const topSolverWeekly = trendData?.topSolverThisWeek || "N/A";
  const topSolverWeeklyCount = trendData?.topSolverThisWeekCount || 0;
  const groupWeeklyVelocity = users.reduce((acc, u) => acc + u.weeklyProgress, 0);

  // Stats page: the three members who solved the most this week (ties broken
  // by total solved), independent of the leaderboard's sort or search.
  const topWeekly = [...users].sort(compareUsers("weekly")).slice(0, 3);

  // Formatting Last Sync time
  const formatSyncTime = (isoString: string) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch {
      return "";
    }
  };
  const syncTime = formatSyncTime(lastSyncAll);

  // Freshness. If the whole board hasn't synced in a day, the sync job is
  // the problem, so we flag that once in the header instead of badging every
  // row. Otherwise a stale row means that one member's LeetCode fetch is
  // failing.
  const now = Date.now();
  const boardStale = isStale(lastSyncAll, now);

  const stats = [
    {
      label: "Members on the board",
      value: String(users.length),
      hint: "Registered"
    },
    {
      label: "Problems solved",
      value: totalSolvedAggregate.toLocaleString(),
      hint: `${averageSolved} per member on average`
    },
    {
      label: "Solved this week",
      value: `+${groupWeeklyVelocity}`,
      hint: "Across all members",
      accent: true
    },
    {
      label: "Top solver this week",
      value: topSolverWeekly,
      hint: `+${topSolverWeeklyCount} problems`,
      isName: true
    }
  ];

  return (
    <div className="min-h-screen bg-ink-950 text-mist-100">
      {/* ---------- Top bar ---------- */}
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex items-center gap-6">
            <a href="#/" className={`flex items-center gap-2.5 rounded-lg ${focusRing}`} aria-label="Leeterboard home">
              <span className="grid size-8 place-items-center rounded-lg bg-teal-400 text-ink-950">
                <Trophy className="size-4" strokeWidth={2.25} />
              </span>
              <span className="text-base font-semibold tracking-tight text-white">Leeterboard</span>
            </a>
            <NavLinks page={page} className="hidden md:flex" />
          </div>

          <div className="flex items-center gap-2">
            {/* Force sync — admin only */}
            {currentUser?.isAdmin && (
              <button
                onClick={handleSyncAll}
                disabled={isSyncingAll || loading}
                className={btnSecondary}
                id="sync-all-btn"
              >
                <RefreshCw className={`size-4 ${isSyncingAll ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{isSyncingAll ? "Syncing…" : "Sync all"}</span>
              </button>
            )}

            {/* Auth control */}
            {authStatus === "authenticated" && currentUser ? (
              <>
                <span className="hidden text-sm text-mist-400 md:inline">
                  Signed in as <span className="font-medium text-white">@{currentUser.leetcodeUsername}</span>
                </span>
                <button onClick={() => logout()} className={btnSecondary}>
                  <LogOut className="size-4" />
                  <span className="hidden sm:inline">Log out</span>
                </button>
              </>
            ) : (
              <button onClick={() => setIsLoginOpen(true)} className={btnPrimary} id="open-login-btn">
                <LogIn className="size-4" />
                Log in
              </button>
            )}
          </div>
        </div>
      </header>
      <div className="border-b border-line md:hidden">
        <NavLinks page={page} className="mx-auto flex max-w-6xl px-4 py-2" />
      </div>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-8 md:pt-14">
        {/* ---------- Intro ---------- */}
        <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
              {page === "stats" ? "Roster stats" : "Weekly LeetCode sprint"}
            </h1>
            <p className="mt-2 max-w-xl text-base text-mist-400">
              {page === "stats"
                ? "tachou makaynch f top 3."
                : "9raa wziid 9ra."}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-mist-400">
            <span
              className={`size-2 rounded-full ${boardStale ? "bg-amber-400" : "bg-teal-400"}`}
              aria-hidden="true"
            />
            {boardStale ? (
              <span className="text-amber-300">Last synced {formatAge(lastSyncAll, now)}</span>
            ) : syncTime ? (
              <span>
                Last synced at <span className="font-medium tabular-nums text-mist-100">{syncTime}</span>
              </span>
            ) : (
              <span>Waiting for first sync</span>
            )}
          </div>
        </div>

        {/* ======== Stats page ======== */}
        {page === "stats" && (
          <>
        {/* ---------- Roster stats ---------- */}
        <section
          id="stats-banner"
          aria-label="Roster statistics"
          className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line lg:grid-cols-4"
        >
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 bg-ink-900 p-5">
              <div className="text-sm text-mist-500">{s.label}</div>
              <div
                className={`mt-2 truncate font-semibold tracking-tight tabular-nums ${
                  s.isName ? "text-xl leading-9" : "text-3xl"
                } ${s.accent ? "text-teal-300" : "text-white"}`}
              >
                {s.value}
              </div>
              <div className="mt-1 truncate text-sm text-mist-500">{s.hint}</div>
            </div>
          ))}
        </section>

        {/* ---------- Top solvers this week (weekly progress only) ---------- */}
        {!loading && topWeekly.length > 0 && (
          <section aria-label="Top solvers this week" className="mb-8">
            <h2 className="mb-3 text-base font-semibold tracking-tight text-white">Top solvers this week</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {topWeekly.map((user, i) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUser(user)}
                  className={`flex cursor-pointer flex-col gap-4 rounded-xl bg-ink-900 p-4 text-left ring-1 ring-line transition-colors hover:ring-line-strong ${focusRing}`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-5 text-2xl font-semibold tabular-nums ${rankColor(i + 1)}`}>{i + 1}</span>
                    <img
                      src={user.avatarUrl}
                      alt=""
                      className="size-11 shrink-0 rounded-full object-cover ring-1 ring-line-strong"
                      referrerPolicy="no-referrer"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold text-white">{user.displayName}</span>
                        {user.weeklyProgress >= HOT_STREAK_THRESHOLD && <HotStreak />}
                      </div>
                      <div className="truncate text-sm text-mist-500">@{user.leetcodeUsername}</div>
                    </div>
                  </div>

                  <DifficultyBar easy={user.easySolved} medium={user.mediumSolved} hard={user.hardSolved} />

                  <div className="flex items-baseline justify-between border-t border-line pt-3 text-sm">
                    <span className="text-mist-400">
                      <span className="font-semibold tabular-nums">{user.allTimeSolved}</span> solved
                    </span>
                    <span className="text-teal-300">
                      <span className="font-semibold tabular-nums">+{user.weeklyProgress}</span> this week
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ---------- Group growth ---------- */}
        {!loading && <GroupGrowthChart trend={trendData} />}

        {/* ---------- Group activity heatmap ---------- */}
        {!loading && <ActivityHeatmap users={users} />}

          </>
        )}

        {/* ======== Leaderboard page ======== */}
        {page === "leaderboard" && (
        <section
          id="leaderboard-panel"
          aria-label="Leaderboard"
          className="overflow-hidden rounded-xl bg-ink-900 ring-1 ring-line"
        >
          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center md:p-4">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" />
              <input
                type="text"
                placeholder="Search by name or LeetCode username"
                aria-label="Search members"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${inputCls} pl-9`}
                id="leaderboard-search"
              />
            </div>

            <div
              role="group"
              aria-label="Sort leaderboard"
              className="inline-flex shrink-0 rounded-lg bg-ink-950 p-1 ring-1 ring-line"
            >
              {(
                [
                  { key: "weekly", label: "This week", id: "sort-weekly-btn" },
                  { key: "allTime", label: "All time", id: "sort-alltime-btn" },
                  { key: "rating", label: "Contest", id: "sort-rating-btn" }
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setSortBy(opt.key)}
                  aria-pressed={sortBy === opt.key}
                  id={opt.id}
                  className={`h-8 flex-1 cursor-pointer rounded-md px-4 text-sm font-medium transition-colors sm:flex-none ${focusRing} ${
                    sortBy === opt.key
                      ? "bg-ink-700 text-white"
                      : "text-mist-400 hover:text-white"
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
            <div className="col-span-4">
              {sortBy === "weekly" ? "Solved this week" : "Solved by difficulty"}
            </div>
            <div className="col-span-2">Contest rating</div>
            <div className="col-span-2 text-right">Total</div>
          </div>

          {loading ? (
            <div className="divide-y divide-line" aria-busy="true">
              <span className="sr-only">Loading leaderboard</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-4 w-5 animate-pulse rounded bg-ink-800" />
                  <div className="size-10 animate-pulse rounded-full bg-ink-800" />
                  <div className="h-4 w-40 animate-pulse rounded bg-ink-800" />
                  <div className="ml-auto h-4 w-12 animate-pulse rounded bg-ink-800" />
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-line">
              <AnimatePresence mode="popLayout">
                {sortedUsers.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="px-6 py-16 text-center"
                  >
                    <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-ink-800 text-mist-500">
                      <Search className="size-4" />
                    </div>
                    <p className="font-medium text-white">
                      {searchQuery ? "No members match your search" : "No members on the board yet"}
                    </p>
                    <p className="mt-1 text-sm text-mist-500">
                      {searchQuery
                        ? "Try a different name or LeetCode username."
                        : "Sign up to add yourself."}
                    </p>
                  </motion.div>
                ) : (
                  sortedUsers.map((user) => {
                    const isPinned = pinnedUsers.includes(user.id);
                    const actualRank = displayRank(user);

                    // Weekly bar is scaled against 25 problems/week
                    const progressPercentage = Math.min(100, Math.round((user.weeklyProgress / 25) * 100));

                    return (
                      <motion.div
                        key={user.id}
                        layoutId={user.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-4 transition-colors md:grid-cols-12 md:gap-x-4 md:px-5 ${
                          isPinned
                            ? "bg-teal-400/[0.06] shadow-[inset_2px_0_0_0_var(--color-teal-400)]"
                            : "bg-ink-900 hover:bg-ink-800/60"
                        }`}
                        id={`member-row-${user.id}`}
                      >
                        {/* Rank */}
                        <div
                          className={`text-lg font-semibold tabular-nums md:col-span-1 ${rankColor(actualRank ?? 0)}`}
                        >
                          {actualRank ?? "–"}
                        </div>

                        {/* Member — opens the full profile */}
                        <button
                          type="button"
                          onClick={() => setSelectedUser(user)}
                          title="View full profile"
                          className={`group/member flex min-w-0 cursor-pointer items-center gap-3 rounded-lg text-left md:col-span-3 ${focusRing}`}
                        >
                          <img
                            src={user.avatarUrl}
                            alt=""
                            className="size-10 shrink-0 rounded-full object-cover ring-1 ring-line-strong transition group-hover/member:ring-teal-400/70"
                            referrerPolicy="no-referrer"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-white transition-colors group-hover/member:text-teal-300">
                                {user.displayName}
                              </span>
                              {user.weeklyProgress >= HOT_STREAK_THRESHOLD && <HotStreak />}
                            </div>
                            <div className="truncate text-sm text-mist-500">@{user.leetcodeUsername}</div>
                            {!boardStale && isStale(user.lastUpdated, now) && (
                              <div
                                className="mt-1 inline-flex items-center gap-1 rounded bg-amber-400/10 px-1.5 py-0.5 text-xs text-amber-300 ring-1 ring-amber-300/20"
                                title={`Last successful LeetCode fetch: ${new Date(user.lastUpdated).toLocaleString()}. The board synced more recently, so LeetCode's API may be failing for this account.`}
                              >
                                <Clock className="size-3" aria-hidden="true" />
                                Updated {formatAge(user.lastUpdated, now)}
                              </div>
                            )}
                          </div>
                        </button>

                        {/* Progress — weekly bar when sorted by week, difficulty split otherwise.
                            Drops below the member on small screens. */}
                        <div className="order-last col-span-3 md:order-none md:col-span-4 md:pr-4">
                          {sortBy === "weekly" ? (
                            <div className="flex w-full items-center gap-3">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                                <div
                                  className="h-full rounded-full bg-teal-400 transition-[width] duration-500"
                                  style={{ width: `${progressPercentage}%` }}
                                />
                              </div>
                              <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-teal-300">
                                +{user.weeklyProgress}
                              </span>
                            </div>
                          ) : (
                            <DifficultyBar
                              easy={user.easySolved}
                              medium={user.mediumSolved}
                              hard={user.hardSolved}
                              size="sm"
                            />
                          )}
                        </div>

                        {/* Contest rating — number + contests entered; "Unrated" when none.
                            Drops below the progress bar on small screens. */}
                        <div className="order-last col-span-3 flex items-baseline gap-2 md:order-none md:col-span-2 md:block">
                          <span className="text-xs text-mist-500 md:hidden">Contest rating</span>
                          {user.contestRating != null ? (
                            <>
                              <span
                                className={`text-base font-semibold tabular-nums ${
                                  sortBy === "rating" ? "text-teal-300" : "text-white"
                                }`}
                              >
                                {user.contestRating.toLocaleString()}
                              </span>
                              <span className="text-xs text-mist-500 md:block">
                                {user.contestsAttended} {user.contestsAttended === 1 ? "contest" : "contests"}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm text-mist-500">Unrated</span>
                          )}
                        </div>

                        {/* Total & controls */}
                        <div className="flex items-center justify-end gap-1 md:col-span-2">
                          <div className="pr-2 text-xl font-semibold tabular-nums text-white">
                            {user.allTimeSolved}
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePinUser(user.id);
                            }}
                            aria-pressed={isPinned}
                            aria-label={isPinned ? `Unpin ${user.displayName}` : `Pin ${user.displayName} to the top`}
                            title={isPinned ? "Unpin member" : "Pin member to the top"}
                            className={`grid size-8 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-white/5 ${focusRing} ${
                              isPinned ? "text-teal-300" : "text-mist-500 hover:text-white"
                            }`}
                          >
                            <Pin className="size-3.5 fill-current" />
                          </button>

                          {/* Remove — admin only */}
                          {currentUser?.isAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveUser(user.id, user.displayName);
                              }}
                              aria-label={`Remove ${user.displayName}`}
                              title="Remove member"
                              className={`grid size-8 cursor-pointer place-items-center rounded-lg text-mist-500 transition-colors hover:bg-rose-500/10 hover:text-rose-300 ${focusRing}`}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </div>
          )}
        </section>

        )}

        <LoginModal open={isLoginOpen} onClose={() => setIsLoginOpen(false)} onAuthenticated={loadData} />

        {/* ---------- Member profile ---------- */}
        <AnimatePresence>
          {selectedUser && (
            <Modal
              onClose={() => setSelectedUser(null)}
              label={`${selectedUser.displayName} profile`}
              id="profile-modal"
            >
              {/* Identity */}
              <div className="mb-5 flex items-center gap-4 pr-8">
                <img
                  src={selectedUser.avatarUrl}
                  alt=""
                  className="size-16 shrink-0 rounded-full object-cover ring-2 ring-line-strong"
                  referrerPolicy="no-referrer"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-xl font-semibold tracking-tight text-white">
                      {selectedUser.displayName}
                    </h3>
                    {selectedUser.weeklyProgress >= HOT_STREAK_THRESHOLD && <HotStreak className="size-4" />}
                  </div>
                  <div className="mt-0.5 text-sm text-mist-400">
                    {sortBy === "rating" ? "Contest rank" : "Rank"}{" "}
                    <span className={`font-semibold tabular-nums ${rankColor(displayRank(selectedUser) ?? 0)}`}>
                      {displayRank(selectedUser) != null ? `#${displayRank(selectedUser)}` : "Unranked"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Profile links */}
              <div className="mb-5">
                <a
                  href={`https://leetcode.com/${encodeURIComponent(selectedUser.leetcodeUsername)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${btnSecondary} w-full min-w-0`}
                >
                  <span className="truncate">LeetCode: {selectedUser.leetcodeUsername}</span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-amber-300" />
                </a>
              </div>

              {/* Progress figures */}
              <div className="mb-5 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line">
                <div className="bg-ink-950 p-3.5">
                  <div className="text-2xl font-semibold tabular-nums text-white">{selectedUser.allTimeSolved}</div>
                  <div className="mt-0.5 text-xs text-mist-500">All time</div>
                </div>
                <div className="bg-ink-950 p-3.5">
                  <div className="text-2xl font-semibold tabular-nums text-teal-300">+{selectedUser.weeklyProgress}</div>
                  <div className="mt-0.5 text-xs text-mist-500">This week</div>
                </div>
                <div className="bg-ink-950 p-3.5">
                  <div className="text-2xl font-semibold tabular-nums text-white">+{selectedUser.monthlyProgress}</div>
                  <div className="mt-0.5 text-xs text-mist-500">This month</div>
                </div>
              </div>

              {/* Contest rating */}
              <div className="mb-5 flex items-center justify-between gap-3 rounded-xl bg-ink-950 p-3.5 ring-1 ring-line">
                <div className="text-sm text-mist-500">Contest rating</div>
                {selectedUser.contestRating != null ? (
                  <div className="text-right">
                    <span className="text-2xl font-semibold tabular-nums text-white">
                      {selectedUser.contestRating.toLocaleString()}
                    </span>
                    <span className="ml-2 text-xs text-mist-500">
                      {selectedUser.contestsAttended} {selectedUser.contestsAttended === 1 ? "contest" : "contests"}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-mist-500">Unrated</span>
                )}
              </div>

              {/* Difficulty breakdown */}
              <div className="rounded-xl bg-ink-950 p-4 ring-1 ring-line">
                <div className="mb-3 text-sm font-medium text-mist-400">Solved by difficulty</div>
                <DifficultyBar
                  easy={selectedUser.easySolved}
                  medium={selectedUser.mediumSolved}
                  hard={selectedUser.hardSolved}
                  size="lg"
                />
              </div>

              {/* Recent solves */}
              <div className="mt-3 rounded-xl bg-ink-950 p-4 ring-1 ring-line">
                <ActivitySparkline history={selectedUser.history} days={30} />
              </div>

              {/* Streaks and badges */}
              <div className="mt-3 rounded-xl bg-ink-950 p-4 ring-1 ring-line">
                <StreaksAndBadges user={selectedUser} />
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4 text-sm text-mist-500">
                <span>Last synced</span>
                <span
                  className={!boardStale && isStale(selectedUser.lastUpdated, now) ? "text-amber-300" : "text-mist-100"}
                >
                  {selectedUser.lastUpdated ? new Date(selectedUser.lastUpdated).toLocaleString() : "Never"}
                  {selectedUser.lastUpdated && isStale(selectedUser.lastUpdated, now) && (
                    <> ({formatAge(selectedUser.lastUpdated, now)})</>
                  )}
                </span>
              </div>
            </Modal>
          )}
        </AnimatePresence>

      </main>

      {/* ---------- Footer ---------- */}
      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-mist-500 md:px-8">
          Leeterboard · Weekly LeetCode leaderboard
        </div>
      </footer>
    </div>
  );
}