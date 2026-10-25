import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  RefreshCw,
  Trash2,
  Flame,
  Gamepad2,
  ArrowUpRight,
  Pin,
  LogIn,
  Clock,
  Activity,
  ListOrdered,
  ShieldCheck,
  Swords,
  Trophy,
  UserRound
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { User } from "./types.js";
import { useAuth } from "./AuthContext.js";
import LoginModal from "./LoginModal.js";
import AccountModal from "./AccountModal.js";
import AccountPage from "./AccountPage.js";
import Podium from "./Podium.js";
import SchoolTag from "./SchoolTag.js";
import RankMovement from "./RankMovement.js";
import ThemeToggle from "./ThemeToggle.js";
import NotificationBell from "./NotificationBell.js";
import AccountButton from "./AccountButton.js";
import { chartColors, useTheme } from "./theme.js";
import { computeMovements } from "./movement.js";
import Modal from "./Modal.js";
import WinnerBanner from "./WinnerBanner.js";
import AdminDashboard from "./AdminDashboard.js";
import ComparePage from "./ComparePage.js";
import type { WeeklyWinner } from "./winners.js";
import ActivityHeatmap from "./ActivityHeatmap.js";
import ProfilePage from "./ProfilePage.js";
import CodinGamePage from "./CodinGamePage.js";
import CodeforcesPage, { codeforcesBuckets, codeforcesMembers, compareCodeforces } from "./CodeforcesPage.js";

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

// The pages share one app shell. They are switched with the URL hash
// (#/ = leaderboard, #/stats = stats, #/compare/<a>/<b> = head to head,
// #/u/<username> = member profile, #/account = account settings,
// #/codeforces = Codeforces board, #/codingame = CodinGame board, #/admin = sync health for admins) so no
// server rewrite is needed: a plain
// static host or Vercel serves "/" for all.
type Page = "leaderboard" | "stats" | "codeforces" | "codingame" | "compare" | "profile" | "account" | "admin";

// Which platform the Stats page is showing.
type StatsPlatform = "leetcode" | "codeforces";

function readPage(): Page {
  const hash = window.location.hash;
  if (hash.startsWith("#/admin")) return "admin";
  if (hash.startsWith("#/compare")) return "compare";
  if (hash.startsWith("#/u/")) return "profile";
  if (hash.startsWith("#/account")) return "account";
  if (hash.startsWith("#/codeforces")) return "codeforces";
  if (hash.startsWith("#/codingame")) return "codingame";
  return hash.startsWith("#/stats") ? "stats" : "leaderboard";
}

// #/u/<username> → the username, or null when the hash isn't a profile link.
function readProfileName(): string | null {
  const match = /^#\/u\/([^/?#]+)/.exec(window.location.hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

const NAV_ITEMS = [
  { page: "leaderboard", href: "#/", label: "Leaderboard", Icon: ListOrdered },
  { page: "codeforces", href: "#/codeforces", label: "Codeforces", Icon: Trophy },
  { page: "codingame", href: "#/codingame", label: "CodinGame", Icon: Gamepad2 },
  { page: "stats", href: "#/stats", label: "Stats", Icon: Activity },
  { page: "compare", href: "#/compare", label: "Compare", Icon: Swords }
] as const;

// Only shown to admins; the page itself is also gated, and the API behind it
// checks admin rights on every request.
const ADMIN_NAV_ITEM = { page: "admin", href: "#/admin", label: "Sync health", Icon: ShieldCheck } as const;

// Labels are written out in full only when there is room; otherwise a link
// shrinks to its icon (the name stays available as a tooltip and to screen
// readers). `labelFrom` is the breakpoint at which the text appears. `fill`
// spreads the links across the full width (the bar under the header on small
// screens).
const NAV_LABEL_CLASS = { sm: "hidden sm:inline", xl: "hidden xl:inline" } as const;
const NAV_PADDING_CLASS = { sm: "px-2.5 sm:px-3", xl: "px-2.5 xl:px-3" } as const;

function NavLinks({
  page,
  isAdmin = false,
  className = "",
  labelFrom = "xl",
  fill = false
}: {
  page: Page;
  isAdmin?: boolean;
  className?: string;
  labelFrom?: keyof typeof NAV_LABEL_CLASS;
  fill?: boolean;
}) {
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
  return (
    <nav aria-label="Main" className={`items-center gap-1 ${className}`}>
      {items.map(({ page: p, href, label, Icon }) => (
        <a
          key={p}
          href={href}
          aria-current={page === p ? "page" : undefined}
          aria-label={label}
          title={label}
          className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${focusRing} ${
            NAV_PADDING_CLASS[labelFrom]
          } ${fill ? "min-w-0 flex-1" : "shrink-0"} ${
            page === p ? "bg-ink-800 text-strong ring-1 ring-line" : "text-mist-400 hover:text-strong"
          }`}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className={NAV_LABEL_CLASS[labelFrom]}>{label}</span>
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
      <div className={`flex w-full gap-0.5 overflow-hidden rounded-full bg-tint ${lg ? "h-2.5" : "h-1.5"}`}>
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

/* ---------- Group growth chart ---------- */

interface TrendPoint {
  date: string;
  solved: number;
  activeUsers: number;
}

function GroupGrowthChart({
  trend,
  description = "Problems the whole roster has solved since tracking began",
  breakdownLabel = "Solved by difficulty, whole roster"
}: {
  trend: any;
  description?: string;
  breakdownLabel?: string;
}) {
  const series: TrendPoint[] = trend?.historyTrend ?? [];
  const breakdown: { name: string; value: number }[] = trend?.difficultyBreakdown ?? [];
  const pick = (name: string) => breakdown.find((b) => b.name === name)?.value ?? 0;
  const { theme } = useTheme();
  const c = chartColors(theme);

  return (
    <section
      id="growth-panel"
      aria-label="Group growth"
      className="mb-8 rounded-xl bg-ink-900 p-5 ring-1 ring-line"
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-strong">Group growth</h2>
        <p className="mt-0.5 text-sm text-mist-500">{description}</p>
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
                  <stop offset="0%" stopColor={c.accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={c.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fill: c.tick, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                domain={[0, (max: number) => Math.max(5, Math.ceil(max * 1.1))]}
                allowDecimals={false}
                tickFormatter={(v: number) => v.toLocaleString()}
                tick={{ fill: c.tick, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: c.cursor }}
                contentStyle={{
                  background: c.tooltipBg,
                  border: `1px solid ${c.tooltipBorder}`,
                  borderRadius: 8,
                  color: c.tooltipText,
                  fontSize: 13
                }}
                labelStyle={{ color: c.tooltipLabel }}
                labelFormatter={(label) => shortDate(String(label))}
                formatter={(value) => [`+${Number(value).toLocaleString()}`, "Growth"]}
              />
              <Area
                type="monotone"
                dataKey="solved"
                stroke={c.accent}
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
          <div className="mb-3 text-sm font-medium text-mist-400">{breakdownLabel}</div>
          <DifficultyBar easy={pick("Easy")} medium={pick("Medium")} hard={pick("Hard")} size="lg" />
        </div>
      )}
    </section>
  );
}

/* ---------- App ---------- */

export default function App() {
  const { status: authStatus, user: currentUser } = useAuth();
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [lastSyncAll, setLastSyncAll] = useState<string>("");
  const [winners, setWinners] = useState<WeeklyWinner[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>(() => readUrlState().q);
  const [sortBy, setSortBy] = useState<SortKey>(() => readUrlState().sort);
  const [loading, setLoading] = useState(true);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [pinnedUsers, setPinnedUsers] = useState<string[]>(readPinned);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>(readPage);
  const [profileName, setProfileName] = useState<string | null>(readProfileName);

  // Follow the hash (nav clicks, back/forward) and start each page at the top.
  useEffect(() => {
    const onHashChange = () => {
      setPage(readPage());
      setProfileName(readProfileName());
      setSelectedUser(null);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Trend analysis state
  const [trendData, setTrendData] = useState<any>(null);

  // Stats page: which platform is shown, and the Codeforces trend. The
  // Codeforces trend is only fetched while that view is open (and re-fetched
  // whenever the board data refreshes), so the LeetCode view costs nothing extra.
  const [statsPlatform, setStatsPlatform] = useState<StatsPlatform>("leetcode");
  const [cfTrendData, setCfTrendData] = useState<any>(null);

  // Fetch users and metrics
  const loadData = async () => {
    try {
      const usersRes = await fetch("/api/users");
      const usersData = await usersRes.json();
      setUsers(usersData.users || []);
      setLastSyncAll(usersData.lastSyncAll || "");
      setWinners(usersData.winners || []);

      const trendsRes = await fetch("/api/trends");
      const trendsData = await trendsRes.json();
      setTrendData(trendsData);
    } catch (err) {
      console.error("Error loading data from server:", err);
    } finally {
      setLoading(false);
    }
  };

  // Ask the server to refresh the board if it's stale. On Vercel there is no
  // background job, so visiting is what triggers the sync. The server decides
  // whether anything needs doing (fresh boards return immediately) and works
  // through stale members within a time budget, so a big board may need a few
  // passes — hence the short loop. Failures are silent: the board just keeps
  // showing the last synced data.
  const autoSyncing = useRef(false);
  const lastAutoSyncAt = useRef(0);
  const autoSyncIfStale = async () => {
    if (autoSyncing.current || Date.now() - lastAutoSyncAt.current < 60_000) return;
    autoSyncing.current = true;
    lastAutoSyncAt.current = Date.now();
    try {
      for (let pass = 0; pass < 3; pass++) {
        const res = await fetch("/api/sync-if-stale", { method: "POST" });
        if (!res.ok) break;
        const data = await res.json();
        if (data.synced) await loadData();
        if (!data.synced || !data.partial) break;
      }
    } catch (err) {
      console.warn("Auto-sync skipped:", err);
    } finally {
      autoSyncing.current = false;
    }
  };

  useEffect(() => {
    // Poll for updates so everyone sees new stats without a manual reload —
    // the server also runs a real background sync every 30 minutes (or, on
    // Vercel, syncs when someone visits; see autoSyncIfStale). Polling
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
        autoSyncIfStale();
        startPolling();
      } else {
        stopPolling();
      }
    };

    loadData(); // always load once, even if the tab was opened in the background
    autoSyncIfStale(); // refresh the board if it has gone stale
    if (document.visibilityState === "visible") startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (page !== "stats" || statsPlatform !== "codeforces") return;
    let cancelled = false;
    fetch("/api/trends?platform=codeforces")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setCfTrendData(data);
      })
      .catch((err) => console.warn("Couldn't load Codeforces trends:", err));
    return () => {
      cancelled = true;
    };
  }, [page, statsPlatform, users]);

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
      u.leetcodeUsername.toLowerCase().includes(q) ||
      (u.school ?? "").toLowerCase().includes(q)
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

  // Stats page, Codeforces view: only members who linked an account count.
  const cfMembers = codeforcesMembers(users);
  const cfSolvedTotal = cfMembers.reduce((acc, m) => acc + m.account.solved, 0);
  const cfWeeklyTotal = cfMembers.reduce((acc, m) => acc + m.account.weeklySolved, 0);
  const cfTopWeekly = [...cfMembers].sort(compareCodeforces("weekly"))[0];

  const isCf = statsPlatform === "codeforces";

  // The three members who solved the most this week on the selected platform.
  const topCards = isCf
    ? [...cfMembers]
        .sort(compareCodeforces("weekly"))
        .slice(0, 3)
        .map(({ user, account }) => {
          const b = codeforcesBuckets(account);
          return {
            user,
            handle: account.handle,
            easy: b.easy,
            medium: b.medium,
            hard: b.hard,
            solved: account.solved,
            weekly: account.weeklySolved
          };
        })
    : topWeekly.map((user) => ({
        user,
        handle: user.leetcodeUsername,
        easy: user.easySolved,
        medium: user.mediumSolved,
        hard: user.hardSolved,
        solved: user.allTimeSolved,
        weekly: user.weeklyProgress
      }));

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

  // How far each member has climbed or dropped since a week ago, for the
  // ranking currently selected (see movement.ts).
  const movements = computeMovements(users, sortBy, compareUsers(sortBy), now);

  // Podium: the top three of the selected ranking. Hidden while searching,
  // with fewer than three eligible members, and in weekly mode before anyone
  // has solved anything this week (a podium of zeros says nothing).
  const podiumLeaders = rankedUsers.filter((u) => sortBy !== "rating" || u.contestRating != null).slice(0, 3);
  const showPodium =
    !searchQuery &&
    podiumLeaders.length === 3 &&
    (sortBy !== "weekly" || podiumLeaders[0].weeklyProgress > 0);
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

  interface StatCard {
    label: string;
    value: string;
    hint: string;
    accent?: boolean;
    isName?: boolean;
  }
  const statCards: StatCard[] = isCf
    ? [
        {
          label: "Members on Codeforces",
          value: String(cfMembers.length),
          hint: `of ${users.length} on the board`
        },
        {
          label: "Problems solved",
          value: cfSolvedTotal.toLocaleString(),
          hint: `${cfMembers.length ? Math.round(cfSolvedTotal / cfMembers.length) : 0} per member on average`
        },
        {
          label: "Solved this week",
          value: `+${cfWeeklyTotal}`,
          hint: "Across linked members",
          accent: true
        },
        {
          label: "Top solver this week",
          value: cfTopWeekly && cfTopWeekly.account.weeklySolved > 0 ? cfTopWeekly.user.displayName : "N/A",
          hint: `+${cfTopWeekly?.account.weeklySolved ?? 0} problems`,
          isName: true
        }
      ]
    : stats;

  return (
    <div className="min-h-screen bg-ink-950 text-mist-100">
      {/* ---------- Top bar ---------- */}
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex items-center gap-6">
            <a href="#/" className={`flex items-center rounded-lg ${focusRing}`} aria-label="Leeterboard home">
              {/* Wordmark: "Leet" large in the accent colour, "erboard" in the
                  strong text colour (white in dark mode, near-black in light mode
                  so it stays readable on both themes). */}
              <span className="flex items-baseline font-logo font-bold leading-none tracking-tight">
                <span className="text-2xl text-teal-400 sm:text-[1.75rem]">Leet</span>
                <span className="text-base text-strong sm:text-lg">erboard</span>
              </span>
            </a>
            <NavLinks page={page} isAdmin={!!currentUser?.isAdmin} labelFrom="xl" className="hidden md:flex" />
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

            <ThemeToggle />

            {/* Notifications — signed-in members only. Keyed by member so
                switching accounts never shows the previous person's list. */}
            {authStatus === "authenticated" && currentUser && <NotificationBell key={currentUser.id} />}

            {/* Auth control */}
            {authStatus === "authenticated" && currentUser ? (
              <div className="relative">
                <AccountButton
                  user={currentUser}
                  open={isAccountOpen}
                  onClick={() => setIsAccountOpen((v) => !v)}
                />
                <AccountModal open={isAccountOpen} onClose={() => setIsAccountOpen(false)} />
              </div>
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
        <NavLinks
          page={page}
          isAdmin={!!currentUser?.isAdmin}
          labelFrom="sm"
          fill
          className="mx-auto flex max-w-6xl px-4 py-2"
        />
      </div>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-8 md:pt-14">
        {/* ---------- Intro (the profile and account pages have their own header) ---------- */}
        {page !== "profile" && page !== "account" && (
        <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-strong md:text-4xl">
              {page === "admin"
                ? "Sync health"
                : page === "compare"
                  ? "Head to head"
                  : page === "stats"
                    ? "Roster stats"
                    : page === "codeforces"
                      ? "Codeforces ladder"
                      : page === "codingame"
                        ? "CodinGame ladder"
                        : "Weekly LeetCode sprint"}
            </h1>
            <p className="mt-2 max-w-xl text-base text-mist-400">
              {page === "admin"
                ? "Who failed to sync, when everyone was last updated, and which LeetCode accounts have gone missing."
                : page === "compare"
                  ? "Pick two members and see who is ahead, stat by stat and over time."
                  : page === "stats"
                  ? "tachou makaynch f top 3."
                  : page === "codeforces"
                    ? "Members who linked their Codeforces account, by problems solved, this week or rating."
                    : page === "codingame"
                      ? "Members who linked their CodinGame account, by total XP, XP earned this week or level."
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
        )}

        {/* ======== Profile page ======== */}
        {page === "profile" &&
          (loading ? (
            <div className="space-y-4" aria-busy="true">
              <span className="sr-only">Loading profile</span>
              <div className="h-56 animate-pulse rounded-2xl bg-ink-900 ring-1 ring-line" />
              <div className="h-32 animate-pulse rounded-xl bg-ink-900 ring-1 ring-line" />
            </div>
          ) : (
            <ProfilePage users={users} winners={winners} username={profileName} lastSyncAll={lastSyncAll} />
          ))}

        {/* ======== Account settings page ======== */}
        {page === "account" && <AccountPage onChanged={loadData} />}

        {/* ======== Compare page ======== */}
        {page === "compare" && !loading && <ComparePage users={users} />}

        {/* ======== Admin page ======== */}
        {page === "admin" &&
          (currentUser?.isAdmin ? (
            <AdminDashboard onChanged={loadData} />
          ) : authStatus === "loading" ? (
            <p className="py-10 text-center text-sm text-mist-500">Checking your access…</p>
          ) : (
            <p className="rounded-xl bg-ink-900 px-5 py-10 text-center text-sm text-mist-400 ring-1 ring-line">
              This page is for admins. Sign in with an admin account to see it.
            </p>
          ))}

        {/* ======== Codeforces page ======== */}
        {page === "codeforces" && <CodeforcesPage users={users} loading={loading} />}

        {/* ======== CodinGame page ======== */}
        {page === "codingame" && <CodinGamePage users={users} loading={loading} />}

        {/* ======== Stats page ======== */}
        {page === "stats" && (
          <>
        {/* ---------- Platform switcher ---------- */}
        <div
          role="group"
          aria-label="Stats platform"
          className="mb-6 inline-flex rounded-lg bg-ink-950 p-1 ring-1 ring-line"
        >
          {(
            [
              { key: "leetcode", label: "LeetCode", id: "stats-platform-leetcode-btn" },
              { key: "codeforces", label: "Codeforces", id: "stats-platform-codeforces-btn" }
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setStatsPlatform(opt.key)}
              aria-pressed={statsPlatform === opt.key}
              id={opt.id}
              className={`h-8 cursor-pointer rounded-md px-4 text-sm font-medium transition-colors ${focusRing} ${
                statsPlatform === opt.key ? "bg-ink-700 text-strong" : "text-mist-400 hover:text-strong"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* ---------- Roster stats ---------- */}
        <section
          id="stats-banner"
          aria-label="Roster statistics"
          className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line lg:grid-cols-4"
        >
          {statCards.map((s) => (
            <div key={s.label} className="min-w-0 bg-ink-900 p-5">
              <div className="text-sm text-mist-500">{s.label}</div>
              <div
                className={`mt-2 truncate font-semibold tracking-tight tabular-nums ${
                  s.isName ? "text-xl leading-9" : "text-3xl"
                } ${s.accent ? "text-teal-300" : "text-strong"}`}
              >
                {s.value}
              </div>
              <div className="mt-1 truncate text-sm text-mist-500">{s.hint}</div>
            </div>
          ))}
        </section>

        {/* ---------- Top solvers this week (weekly progress only) ---------- */}
        {!loading && topCards.length > 0 && (
          <section aria-label="Top solvers this week" className="mb-8">
            <h2 className="mb-3 text-base font-semibold tracking-tight text-strong">Top solvers this week</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {topCards.map(({ user, handle, easy, medium, hard, solved, weekly }, i) => (
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
                        <span className="truncate font-semibold text-strong">{user.displayName}</span>
                        {weekly >= HOT_STREAK_THRESHOLD && <HotStreak />}
                      </div>
                      <div className="truncate text-sm text-mist-500">@{handle}</div>
                      <SchoolTag school={user.school} className="mt-1" />
                    </div>
                  </div>

                  <DifficultyBar easy={easy} medium={medium} hard={hard} />

                  <div className="flex items-baseline justify-between border-t border-line pt-3 text-sm">
                    <span className="text-mist-400">
                      <span className="font-semibold tabular-nums">{solved}</span> solved
                    </span>
                    <span className="text-teal-300">
                      <span className="font-semibold tabular-nums">+{weekly}</span> this week
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ---------- Group growth ---------- */}
        {!loading && !isCf && <GroupGrowthChart trend={trendData} />}
        {!loading && isCf && (
          <GroupGrowthChart
            trend={cfTrendData}
            description="Codeforces problems the linked members have solved since they linked their account"
            breakdownLabel="Solved by problem rating: under 1200, 1200 to 1699, 1700 and up"
          />
        )}

        {/* ---------- Group activity heatmap (LeetCode submissions only) ---------- */}
        {!loading && !isCf && <ActivityHeatmap users={users} />}

          </>
        )}

        {/* ======== Leaderboard page ======== */}
        {page === "leaderboard" && !loading && (
          <WinnerBanner winners={winners} users={users} nowMs={now} onSelect={setSelectedUser} />
        )}
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
                placeholder="Search by name, username or school"
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
                      ? "bg-ink-700 text-strong"
                      : "text-mist-400 hover:text-strong"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {!loading && showPodium && (
            <Podium leaders={podiumLeaders} sortBy={sortBy} movements={movements} onSelect={setSelectedUser} />
          )}

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
                    <p className="font-medium text-strong">
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
                        <div className="flex flex-col items-start gap-1 md:col-span-1">
                          <span
                            className={`text-lg font-semibold leading-none tabular-nums ${rankColor(actualRank ?? 0)}`}
                          >
                            {actualRank ?? "–"}
                          </span>
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
                              <span className="truncate font-medium text-strong transition-colors group-hover/member:text-teal-300">
                                {user.displayName}
                              </span>
                              {user.weeklyProgress >= HOT_STREAK_THRESHOLD && <HotStreak />}
                              <RankMovement movement={movements[user.id]} />
                            </div>
                            <div className="truncate text-sm text-mist-500">@{user.leetcodeUsername}</div>
                            <SchoolTag school={user.school} className="mt-1" />
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
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
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
                                  sortBy === "rating" ? "text-teal-300" : "text-strong"
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
                          <div className="pr-2 text-xl font-semibold tabular-nums text-strong">
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
                            className={`grid size-8 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-tint ${focusRing} ${
                              isPinned ? "text-teal-300" : "text-mist-500 hover:text-strong"
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

        {/* ---------- Member card ---------- */}
        {/* A short summary that opens when a member is clicked; the full
            profile lives on its own page (#/u/<username>). */}
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
                    <h3 className="truncate text-xl font-semibold tracking-tight text-strong">
                      {selectedUser.displayName}
                    </h3>
                    {selectedUser.weeklyProgress >= HOT_STREAK_THRESHOLD && <HotStreak className="size-4" />}
                  </div>
                  <div className="truncate text-sm text-mist-500">@{selectedUser.leetcodeUsername}</div>
                  <div className="mt-0.5 text-sm text-mist-400">
                    {sortBy === "rating" ? "Contest rank" : "Rank"}{" "}
                    <span className={`font-semibold tabular-nums ${rankColor(displayRank(selectedUser) ?? 0)}`}>
                      {displayRank(selectedUser) != null ? `#${displayRank(selectedUser)}` : "Unranked"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress figures */}
              <div className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line">
                <div className="bg-ink-950 p-3.5">
                  <div className="text-2xl font-semibold tabular-nums text-strong">{selectedUser.allTimeSolved}</div>
                  <div className="mt-0.5 text-xs text-mist-500">All time</div>
                </div>
                <div className="bg-ink-950 p-3.5">
                  <div className="text-2xl font-semibold tabular-nums text-teal-300">+{selectedUser.weeklyProgress}</div>
                  <div className="mt-0.5 text-xs text-mist-500">This week</div>
                </div>
                <div className="bg-ink-950 p-3.5">
                  <div className="text-2xl font-semibold tabular-nums text-strong">+{selectedUser.monthlyProgress}</div>
                  <div className="mt-0.5 text-xs text-mist-500">This month</div>
                </div>
              </div>

              {/* Difficulty breakdown */}
              <div className="rounded-xl bg-ink-950 p-4 ring-1 ring-line">
                <DifficultyBar
                  easy={selectedUser.easySolved}
                  medium={selectedUser.mediumSolved}
                  hard={selectedUser.hardSolved}
                  size="lg"
                />
              </div>

              {/* One-line extras */}
              <div className="mt-3 flex items-center justify-between gap-3 text-sm text-mist-500">
                <span className="inline-flex items-center gap-1.5">
                  <Flame
                    className={`size-4 ${(selectedUser.currentStreak ?? 0) > 0 ? "text-amber-400" : "text-mist-500"}`}
                    aria-hidden="true"
                  />
                  <span className="font-semibold tabular-nums text-strong">{selectedUser.currentStreak ?? "–"}</span>
                  day streak
                </span>
                <span>
                  {selectedUser.contestRating != null ? (
                    <>
                      Rated{" "}
                      <span className="font-semibold tabular-nums text-strong">
                        {selectedUser.contestRating.toLocaleString()}
                      </span>
                    </>
                  ) : (
                    "Unrated"
                  )}
                </span>
              </div>

              {/* Actions */}
              <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
                <a
                  href={`#/u/${encodeURIComponent(selectedUser.leetcodeUsername)}`}
                  onClick={() => setSelectedUser(null)}
                  className={`${btnPrimary} w-full`}
                  id="view-full-profile-btn"
                >
                  <UserRound className="size-4" aria-hidden="true" />
                  View full profile
                </a>
                <div className="flex gap-2">
                  <a
                    href={`https://leetcode.com/${encodeURIComponent(selectedUser.leetcodeUsername)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${btnSecondary} min-w-0 flex-1`}
                  >
                    <span className="truncate">LeetCode</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-amber-300" />
                  </a>
                  <a
                    href={`#/compare/${encodeURIComponent(selectedUser.leetcodeUsername)}`}
                    onClick={() => setSelectedUser(null)}
                    className={`${btnSecondary} min-w-0 flex-1`}
                  >
                    <Swords className="size-3.5 shrink-0" aria-hidden="true" />
                    Compare
                  </a>
                </div>
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