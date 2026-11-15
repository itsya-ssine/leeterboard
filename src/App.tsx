import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search,
  RefreshCw,
  Trash2,
  Flame,
  Gamepad2,
  ArrowUpRight,
  Pin,
  Clock,
  Activity,
  ListOrdered,
  ShieldCheck,
  Swords,
  Trophy,
  UserRound,
  Timer,
  Users,
  CheckCheck,
  TrendingUp,
  Crown,
  Lock,
  AlertTriangle,
  WifiOff
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { User } from "./types.js";
import { useAuth } from "./AuthContext.js";
import AccountModal from "./AccountModal.js";
import AccountPage from "./AccountPage.js";
import Podium from "./Podium.js";
import SchoolTag from "./SchoolTag.js";
import RankMovement from "./RankMovement.js";
import { useI18n } from "./i18n.js";
import NotificationBell from "./NotificationBell.js";
import AccountButton from "./AccountButton.js";
import { computeMovements } from "./movement.js";
import Modal from "./Modal.js";
import WinnerBanner from "./WinnerBanner.js";
import AdminDashboard from "./AdminDashboard.js";
import FeedbackWidget from "./FeedbackWidget.js";
import SiteFooter from "./SiteFooter.js";
import ComparePage from "./ComparePage.js";
import type { WeeklyWinner } from "./winners.js";
import ActivityHeatmap from "./ActivityHeatmap.js";
import ProfilePage from "./ProfilePage.js";
import CodinGamePage, { LevelBadge, codingameMembers, compareCodingame } from "./CodinGamePage.js";
import EmptyState from "./EmptyState.js";
import { leetcodeMembers } from "./linkedAccounts.js";
import TierAvatar from "./TierAvatar.js";
import { ratingTier } from "./tiers.js";
import AnimatedNumber from "./AnimatedNumber.js";
import { CompareSkeleton, ProfileSkeleton } from "./Skeleton.js";
import CodeforcesPage, { codeforcesBuckets, codeforcesMembers, compareCodeforces } from "./CodeforcesPage.js";
import { PixelCrown, PixelTrophy, PixelFlame, PixelRankBadge, PixelLed, PixelCheck } from "./pixelArt.js";

/* ---------- Shared style tokens ---------- */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400";

const btn = `inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 px-3.5 text-xs font-pixel font-bold uppercase transition-all disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnPrimary = `${btn} border-2 border-emerald-600 bg-emerald-400 text-ink-950 shadow-[2px_2px_0_#022c22] hover:brightness-110 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none`;
const btnSecondary = `${btn} border-2 border-ink-700 bg-ink-800 text-mist-100 shadow-[2px_2px_0_#000] hover:border-mist-400 hover:bg-ink-700 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none`;

const inputCls =
  "h-10 w-full border-2 border-ink-700 bg-ink-950 px-3 font-sans text-sm text-mist-100 placeholder:text-mist-500 shadow-[2px_2px_0_#000] transition focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:opacity-50";

const rankColor = (rank: number) =>
  rank === 1 ? "text-amber-300" : rank === 2 ? "text-slate-200" : rank === 3 ? "text-orange-300" : "text-mist-400";

const HOT_STREAK_THRESHOLD = 12;

// Polling cadence while the tab is visible. Sized to 60s (UX-01 / SEC-04) with
// adaptive backoff to reduce battery, data usage, and avoid 429 rate limits on shared networks.
const POLL_INTERVAL_MS = 60_000;
const BASE_POLL_INTERVAL_MS = POLL_INTERVAL_MS;
const MAX_POLL_INTERVAL_MS = 120_000;

// A member whose last successful LeetCode fetch is older than this gets a
// "stale" badge. The server syncs every 30 minutes, so a full day without an
// update means their fetches are failing, not that nobody has synced.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const PINNED_STORAGE_KEY = "leeterboard:pinned";

import RoundTimer, {
  nextRoundStartMs,
  formatLocalReset,
  isoWeek
} from "./features/leaderboard/components/RoundTimer.js";
import SubmissionTicker from "./features/leaderboard/components/SubmissionTicker.js";
import NavLinks, { type Page, NAV_ITEMS, ADMIN_NAV_ITEM } from "./components/navigation/NavLinks.js";
import DifficultyBar from "./components/ui/DifficultyBar.js";
import GroupGrowthChart from "./features/statistics/components/GroupGrowthChart.js";

type SortKey = "weekly" | "allTime" | "rating";

// Stats page tiles: icon + accent per summary card, and medal styling for the
// top-three cards.
const STAT_TILES = [
  { Icon: Users, text: "text-sky-400", bar: "from-sky-400" },
  { Icon: CheckCheck, text: "text-emerald-400", bar: "from-emerald-400" },
  { Icon: TrendingUp, text: "text-teal-300", bar: "from-teal-300" },
  { Icon: Crown, text: "text-amber-300", bar: "from-amber-300" }
] as const;

const TOP_MEDALS = [
  {
    label: "Gold",
    text: "text-amber-300",
    ring: "ring-amber-300/70",
    strip: "from-amber-300/15",
    bar: "from-amber-300 to-amber-500"
  },
  {
    label: "Silver",
    text: "text-slate-300",
    ring: "ring-slate-300/60",
    strip: "from-slate-300/15",
    bar: "from-slate-300 to-slate-500"
  },
  {
    label: "Bronze",
    text: "text-orange-300",
    ring: "ring-orange-300/60",
    strip: "from-orange-300/15",
    bar: "from-orange-300 to-orange-500"
  }
] as const;

/* ---------- Pages + navbar ---------- */

// The pages share one app shell. They are switched with the URL hash
// (#/ = leaderboard, #/stats = stats, #/compare/<a>/<b> = head to head,
// #/u/<username> = member profile, #/account = account settings,
// #/codeforces = Codeforces board, #/codingame = CodinGame board, #/admin = sync health for admins) so no
// server rewrite is needed: a plain
// static host or Vercel serves "/" for all.
// Which platform the Stats page is showing.
type StatsPlatform = "leetcode" | "codeforces" | "codingame";

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

function HotStreak({ className = "" }: { className?: string }) {
  return (
    <span title="Hot solve streak" className={`inline-flex shrink-0 ${className}`}>
      <PixelFlame size={14} className="animate-glow" />
    </span>
  );
}

/* ---------- Group growth chart ---------- */

/* ---------- App ---------- */

const PAGE_TITLES: Record<Page, string> = {
  leaderboard: "Weekly Sprint — Leeterboard",
  stats: "Roster Analytics — Leeterboard",
  compare: "Head to Head — Leeterboard",
  codeforces: "Codeforces Standings — Leeterboard",
  codingame: "CodinGame Arena — Leeterboard",
  account: "Account Settings — Leeterboard",
  admin: "Sync Health & Admin — Leeterboard",
  profile: "Member Profile — Leeterboard"
};

export default function App() {
  const { user: currentUser } = useAuth();
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  // Every member, whatever they have linked. Only the pages that work across
  // platforms (profiles, Codeforces, CodinGame) get this list; the LeetCode
  // board, its stats and the compare page use `users`, which is just the
  // members who linked LeetCode.
  const [members, setMembers] = useState<User[]>([]);
  const users = useMemo(() => leetcodeMembers(members), [members]);
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

  const [offline, setOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const lastSyncSeenRef = useRef<string>("");
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentIntervalRef = useRef<number>(BASE_POLL_INTERVAL_MS);

  const { t } = useI18n();
  const [selectedCohort, setSelectedCohort] = useState<string>("");

  // Keyboard shortcut: '/' focuses the search input on the leaderboard (UX-10)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tagName = target?.tagName?.toLowerCase();
        if (tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable) {
          return;
        }
        const searchInput = document.getElementById("leaderboard-search") as HTMLInputElement | null;
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Sync document title and accessibility focus on page/profile change (UX-02)
  useEffect(() => {
    if (page === "profile" && profileName) {
      document.title = `${profileName}'s Profile — Leeterboard`;
    } else {
      document.title = PAGE_TITLES[page] ?? "Leeterboard";
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [page, profileName]);

  // Follow the hash (nav clicks, back/forward) and start each page at the top.
  useEffect(() => {
    const onHashChange = () => {
      setPage(readPage());
      setProfileName(readProfileName());
      setSelectedUser(null);
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Trend analysis state
  const [trendData, setTrendData] = useState<any>(null);

  // Stats page: which platform is shown, and the trend of each extra platform.
  // A platform's trend is only fetched while its view is open (and re-fetched
  // whenever the board data refreshes), so the LeetCode view costs nothing extra.
  const [statsPlatform, setStatsPlatform] = useState<StatsPlatform>("leetcode");
  const [platformTrends, setPlatformTrends] = useState<Partial<Record<Exclude<StatsPlatform, "leetcode">, any>>>({});

  // Fetch users and metrics
  const loadData = async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setOffline(true);
      setLoading(false);
      return;
    }
    setOffline(false);
    try {
      const usersRes = await fetch("/api/users");
      if (usersRes.status === 429) {
        const retryAfter = usersRes.headers.get("Retry-After");
        const secs = retryAfter ? parseInt(retryAfter, 10) : 60;
        setRateLimitMessage(`You're going fast — try again in ${secs}s.`);
        return;
      }
      if (!usersRes.ok) throw new Error(`HTTP ${usersRes.status}`);
      setRateLimitMessage(null);
      const usersData = await usersRes.json();
      setMembers(usersData.users || []);
      const syncVal = usersData.lastSyncAll || "";
      setLastSyncAll(syncVal);
      lastSyncSeenRef.current = syncVal;
      setWinners(usersData.winners || []);

      const trendsRes = await fetch("/api/trends");
      if (trendsRes.ok) {
        const trendsData = await trendsRes.json();
        setTrendData(trendsData);
      }
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
    // Polling with adaptive backoff (UX-01 / SEC-04):
    // Polls /api/version and fetches the full board only when data changed.
    // Backs off from 60s to 120s when data does not change; resets to 60s
    // on user activity (clicks, keys) and tab visibility.
    const pollTick = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        scheduleNext(BASE_POLL_INTERVAL_MS);
        return;
      }
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const verRes = await fetch("/api/version");
        if (verRes.ok) {
          const verData = await verRes.json();
          if (verData.lastSyncAll && verData.lastSyncAll !== lastSyncSeenRef.current) {
            // New sync on server: refresh full board immediately & reset cadence
            await loadData();
            currentIntervalRef.current = BASE_POLL_INTERVAL_MS;
          } else {
            // Board unchanged: back off adaptively
            currentIntervalRef.current = Math.min(MAX_POLL_INTERVAL_MS, currentIntervalRef.current * 1.5);
          }
        }
      } catch {
        // Network hitch or server restart: back off
        currentIntervalRef.current = Math.min(MAX_POLL_INTERVAL_MS, currentIntervalRef.current * 1.5);
      }

      scheduleNext(currentIntervalRef.current);
    };

    const scheduleNext = (delayMs: number) => {
      if (pollTimerRef.current !== undefined) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(pollTick, delayMs);
    };

    const resetAndPoll = () => {
      currentIntervalRef.current = BASE_POLL_INTERVAL_MS;
      scheduleNext(BASE_POLL_INTERVAL_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadData();
        autoSyncIfStale();
        resetAndPoll();
      } else if (pollTimerRef.current !== undefined) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = undefined;
      }
    };

    const onOnline = () => {
      setOffline(false);
      loadData();
      resetAndPoll();
    };

    const onOffline = () => {
      setOffline(true);
      if (pollTimerRef.current !== undefined) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = undefined;
      }
    };

    // Reset backoff to base interval on user interaction
    const onUserActivity = () => {
      currentIntervalRef.current = BASE_POLL_INTERVAL_MS;
    };

    loadData();
    autoSyncIfStale();
    if (document.visibilityState === "visible") {
      scheduleNext(BASE_POLL_INTERVAL_MS);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pointerdown", onUserActivity, { passive: true });
    window.addEventListener("keydown", onUserActivity, { passive: true });

    return () => {
      if (pollTimerRef.current !== undefined) clearTimeout(pollTimerRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pointerdown", onUserActivity);
      window.removeEventListener("keydown", onUserActivity);
    };
  }, []);

  useEffect(() => {
    if (page !== "stats" || statsPlatform === "leetcode") return;
    const platform = statsPlatform;
    let cancelled = false;
    fetch(`/api/trends?platform=${platform}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setPlatformTrends((prev) => ({ ...prev, [platform]: data }));
      })
      .catch((err) => console.warn(`Couldn't load ${platform} trends:`, err));
    return () => {
      cancelled = true;
    };
  }, [page, statsPlatform, members]);

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
      setPinnedUsers(pinnedUsers.filter((userId) => userId !== id));
    } else {
      setPinnedUsers([...pinnedUsers, id]);
    }
  };

  // Distinct cohorts from registered members
  const cohorts = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => {
      const s = u.school?.trim();
      if (s) set.add(s);
    });
    return Array.from(set).sort();
  }, [users]);

  // Filter and sort user list
  const filteredUsers = users.filter((u) => {
    if (selectedCohort && (u.school ?? "").trim().toLowerCase() !== selectedCohort.toLowerCase()) {
      return false;
    }
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (
      u.displayName.toLowerCase().includes(q) ||
      u.loginUsername.toLowerCase().includes(q) ||
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

  // Stats page, Codeforces and CodinGame views: only members who linked an
  // account count.
  const cfMembers = codeforcesMembers(members);
  const cfSolvedTotal = cfMembers.reduce((acc, m) => acc + m.account.solved, 0);
  const cfWeeklyTotal = cfMembers.reduce((acc, m) => acc + m.account.weeklySolved, 0);
  const cfTopWeekly = [...cfMembers].sort(compareCodeforces("weekly"))[0];

  // CodinGame has no solved count: `solved` holds total XP, `rating` the level
  // and `weeklySolved` the XP earned this week (see platforms/codingame.ts).
  const cgMembers = codingameMembers(members);
  const cgXpTotal = cgMembers.reduce((acc, m) => acc + m.account.solved, 0);
  const cgWeeklyTotal = cgMembers.reduce((acc, m) => acc + m.account.weeklySolved, 0);
  const cgTopWeekly = [...cgMembers].sort(compareCodingame("weekly"))[0];

  const isCf = statsPlatform === "codeforces";
  const isCg = statsPlatform === "codingame";

  // What the cards count: problems (AC) on LeetCode and Codeforces, XP on CodinGame.
  const weeklyUnit = isCg ? "XP" : "AC";
  const totalUnit = isCg ? "XP" : "solved";

  // The three members who solved (or, on CodinGame, earned) the most this week
  // on the selected platform.
  const topCards = isCg
    ? [...cgMembers]
        .sort(compareCodingame("weekly"))
        .slice(0, 3)
        .map(({ user, account }) => ({
          user,
          handle: user.loginUsername,
          easy: 0,
          medium: 0,
          hard: 0,
          level: account.rating,
          solved: account.solved,
          weekly: account.weeklySolved
        }))
    : isCf
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
              level: null,
              solved: account.solved,
              weekly: account.weeklySolved
            };
          })
      : topWeekly.map((user) => ({
          user,
          handle: user.loginUsername,
          easy: user.easySolved,
          medium: user.mediumSolved,
          hard: user.hardSolved,
          level: null,
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
    !searchQuery && podiumLeaders.length === 3 && (sortBy !== "weekly" || podiumLeaders[0].weeklyProgress > 0);
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
  const statCards: StatCard[] = isCg
    ? [
        {
          label: "Members on CodinGame",
          value: String(cgMembers.length),
          hint: `of ${users.length} on the board`
        },
        {
          label: "Total XP",
          value: cgXpTotal.toLocaleString(),
          hint: `${cgMembers.length ? Math.round(cgXpTotal / cgMembers.length).toLocaleString() : 0} XP per member on average`
        },
        {
          label: "XP this week",
          value: `+${cgWeeklyTotal.toLocaleString()}`,
          hint: "Across linked members",
          accent: true
        },
        {
          label: "Top earner this week",
          value: cgTopWeekly && cgTopWeekly.account.weeklySolved > 0 ? cgTopWeekly.user.displayName : "N/A",
          hint: `+${(cgTopWeekly?.account.weeklySolved ?? 0).toLocaleString()} XP`,
          isName: true
        }
      ]
    : isCf
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
    <div className="relative flex min-h-screen flex-col bg-ink-950 text-mist-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink-900 focus:px-4 focus:py-2 focus:font-mono focus:text-sm focus:font-medium focus:text-teal-300 focus:shadow-xl focus:ring-2 focus:ring-teal-400"
      >
        Skip to main content
      </a>
      <div className="aurora-bg" aria-hidden="true" />
      {/* ---------- Top bar ---------- */}
      <header className="glass sticky top-0 z-30 border-b-2 border-ink-700 bg-ink-950/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-4 lg:gap-6">
            <a href="#/" className={`flex shrink-0 items-center ${focusRing}`} aria-label="Leeterboard home">
              <span className="flex items-baseline font-logo font-bold leading-none tracking-tight">
                <span className="text-aurora font-pixel text-xl sm:text-2xl">Leet</span>
                <span className="font-pixel text-xs sm:text-sm text-strong ml-0.5">erboard</span>
              </span>
            </a>
            <NavLinks
              page={page}
              isAdmin={!!currentUser?.isAdmin}
              labelFrom={currentUser?.isAdmin ? "never" : "xl"}
              className="hidden md:flex"
            />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Force sync — admin only */}
            {currentUser?.isAdmin && (
              <button
                onClick={handleSyncAll}
                disabled={isSyncingAll || loading}
                className={btnSecondary}
                id="sync-all-btn"
              >
                <RefreshCw className={`size-3.5 ${isSyncingAll ? "animate-spin" : ""}`} />
                <span className="hidden lg:inline">{isSyncingAll ? "Syncing…" : "Sync all"}</span>
              </button>
            )}

            {/* Notifications — signed-in members only. Keyed by member so
                switching accounts never shows the previous person's list. */}
            {currentUser && <NotificationBell key={currentUser.id} />}

            {/* Auth control */}
            {currentUser && (
              <div className="relative">
                <AccountButton user={currentUser} open={isAccountOpen} onClick={() => setIsAccountOpen((v) => !v)} />
                <AccountModal open={isAccountOpen} onClose={() => setIsAccountOpen(false)} />
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="glass sticky top-16 z-20 border-b-2 border-ink-700 bg-ink-950/90 md:hidden">
        <NavLinks
          page={page}
          isAdmin={!!currentUser?.isAdmin}
          labelFrom={currentUser?.isAdmin ? "never" : "sm"}
          fill
          className="mx-auto flex max-w-6xl px-4 py-2"
        />
      </div>

      {page === "leaderboard" && !loading && <SubmissionTicker users={users} />}

      <main
        ref={mainRef}
        id="main-content"
        tabIndex={-1}
        className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-8 sm:pt-10 focus:outline-none md:px-8 md:pt-12 scroll-mt-20 md:scroll-mt-24"
      >
        {/* Offline status notice (UX-04) */}
        {offline && (
          <div
            role="status"
            aria-live="polite"
            className="mb-6 flex items-center justify-between gap-3 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-300 ring-1 ring-amber-400/20"
          >
            <div className="flex items-center gap-2.5">
              <WifiOff className="size-4 shrink-0" aria-hidden="true" />
              <span>You are currently offline. Displaying cached data.</span>
            </div>
            <button
              type="button"
              onClick={loadData}
              className="rounded-lg bg-amber-400/20 px-3 py-1.5 text-xs font-medium text-amber-200 ring-1 ring-amber-400/30 hover:bg-amber-400/30"
            >
              Retry
            </button>
          </div>
        )}

        {/* Rate limit warning banner (UX-04) */}
        {rateLimitMessage && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-6 flex items-center gap-2.5 rounded-xl bg-rose-500/10 p-4 text-sm text-rose-300 ring-1 ring-rose-400/20"
          >
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span>{rateLimitMessage}</span>
          </div>
        )}

        {/* Upstream sync notice (UX-09) */}
        {page === "leaderboard" && !loading && boardStale && (
          <div
            role="region"
            aria-label="Upstream sync notice"
            className="mb-6 flex flex-col justify-between gap-3 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-200 ring-1 ring-amber-400/20 sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
              <div>
                <p className="font-semibold text-amber-100">LeetCode sync notice</p>
                <p className="mt-0.5 text-xs text-amber-300/90">
                  Standings were last updated {formatAge(lastSyncAll, now)}. Upstream LeetCode services may be
                  experiencing rate limits or delays; showing cached standings.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={autoSyncIfStale}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-400/20 px-3 py-1.5 text-xs font-medium text-amber-200 ring-1 ring-amber-400/30 hover:bg-amber-400/30"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Check now
            </button>
          </div>
        )}
        {/* ---------- Intro (the profile and account pages have their own header) ---------- */}
        {page !== "profile" && page !== "account" && (
          <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-2 font-mono text-xs text-mist-500" aria-hidden="true">
                <span className="font-bold text-emerald-400">&#8250;</span>
                <span>
                  {page === "stats"
                    ? `./leeterboard stats --platform ${statsPlatform}`
                    : page === "compare"
                      ? "./leeterboard vs --duel"
                      : page === "codeforces"
                        ? "./leeterboard cf --standings"
                        : page === "codingame"
                          ? "./leeterboard cg --arena"
                          : `./leeterboard --round W${isoWeek(now)}`}
                </span>
                <span className="animate-blink inline-block h-3.5 w-1.5 bg-teal-400" />
              </div>
              <h1 className="animate-rise font-pixel text-2xl font-bold tracking-tight text-strong md:text-4xl">
                {page === "admin"
                  ? "Sync health"
                  : page === "compare"
                    ? "Head to head"
                    : page === "stats"
                      ? "Roster stats"
                      : page === "codeforces"
                        ? "Codeforces"
                        : page === "codingame"
                          ? "CodinGame"
                          : "Weekly LeetCode sprint"}
              </h1>
              <p className="mt-2 max-w-xl text-sm md:text-base text-mist-400 font-sans">
                {page === "admin"
                  ? "Who failed to sync, when everyone was last updated, and which LeetCode accounts have gone missing."
                  : page === "compare"
                    ? "Pick two members and see who is ahead, stat by stat and over time."
                    : page === "stats"
                      ? "tachou makaynch f top 3."
                      : "9raa wziid 9ra."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {page === "leaderboard" && <RoundTimer />}
              <div className="flex items-center gap-2 border-2 border-ink-700 bg-ink-950 px-3 py-1 font-mono text-xs text-mist-400 shadow-[2px_2px_0_#000]">
                <PixelLed status={boardStale ? "warning" : "online"} size={8} />
                {boardStale ? (
                  <span className="text-amber-300 font-mono">Last synced {formatAge(lastSyncAll, now)}</span>
                ) : syncTime ? (
                  <span>
                    Last synced at <span className="font-semibold tabular-nums text-mist-100">{syncTime}</span>
                  </span>
                ) : (
                  <span>Waiting for first sync</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ======== Profile page ======== */}
        {page === "profile" &&
          (loading ? (
            <ProfileSkeleton />
          ) : (
            <ProfilePage users={members} winners={winners} username={profileName} lastSyncAll={lastSyncAll} />
          ))}

        {/* ======== Account settings page ======== */}
        {page === "account" && <AccountPage onChanged={loadData} />}

        {/* ======== Compare page ======== */}
        {page === "compare" && (loading ? <CompareSkeleton /> : <ComparePage users={members} />)}

        {/* ======== Admin page ======== */}
        {page === "admin" &&
          (currentUser?.isAdmin ? (
            <AdminDashboard onChanged={loadData} />
          ) : (
            <EmptyState
              id="admin-forbidden"
              icon={<Lock className="size-5" aria-hidden="true" />}
              title="This page is for admins"
              description="Your account doesn't have admin access."
              action={{ label: "Back to the leaderboard", href: "#/" }}
            />
          ))}

        {/* ======== Codeforces page ======== */}
        {page === "codeforces" && <CodeforcesPage users={members} loading={loading} />}

        {/* ======== CodinGame page ======== */}
        {page === "codingame" && <CodinGamePage users={members} loading={loading} />}

        {/* ======== Stats page ======== */}
        {page === "stats" && (
          <>
            {/* ---------- Platform switcher ---------- */}
            <div
              role="group"
              aria-label="Stats platform"
              className="mb-6 inline-flex border-2 border-ink-700 bg-ink-950 p-1 shadow-[2px_2px_0_#000]"
            >
              {(
                [
                  { key: "leetcode", label: "LeetCode", dot: "bg-amber-400", id: "stats-platform-leetcode-btn" },
                  { key: "codeforces", label: "Codeforces", dot: "bg-sky-400", id: "stats-platform-codeforces-btn" },
                  { key: "codingame", label: "CodinGame", dot: "bg-emerald-400", id: "stats-platform-codingame-btn" }
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setStatsPlatform(opt.key)}
                  aria-pressed={statsPlatform === opt.key}
                  id={opt.id}
                  className={`inline-flex h-8 cursor-pointer items-center gap-2 px-3 font-pixel text-[10px] uppercase tracking-wider transition-colors ${focusRing} ${
                    statsPlatform === opt.key
                      ? "border border-teal-400 bg-ink-800 text-teal-300 shadow-[1px_1px_0_#000]"
                      : "border border-transparent text-mist-400 hover:text-mist-100"
                  }`}
                >
                  <span
                    className={`size-2 shrink-0 ${opt.dot} ${statsPlatform === opt.key ? "shadow-[0_0_6px_currentColor]" : "opacity-50"}`}
                    aria-hidden="true"
                  />
                  {opt.label}
                </button>
              ))}
            </div>

            {/* ---------- Roster stats ---------- */}
            <section
              id="stats-banner"
              aria-label="Roster statistics"
              className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4"
            >
              {statCards.map((s, i) => {
                const { Icon, text, bar } = STAT_TILES[i % STAT_TILES.length];
                return (
                  <div
                    key={s.label}
                    className="pixel-card group relative min-w-0 animate-rise p-5 transition-transform duration-200 hover:-translate-y-0.5"
                    style={{ animationDelay: `${i * 80}ms` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-pixel text-[10px] uppercase tracking-widest text-mist-500">{s.label}</div>
                      <span
                        className={`grid size-8 shrink-0 place-items-center border border-ink-700 bg-ink-950 ${text}`}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                    </div>
                    <div
                      className={`mt-3 truncate font-pixel font-bold tracking-tight tabular-nums ${
                        s.isName ? "text-lg leading-9" : "text-2xl"
                      } ${s.accent ? "text-aurora" : "text-strong"}`}
                    >
                      {s.isName ? s.value : <AnimatedNumber value={s.value} />}
                    </div>
                    <div className="mt-1 truncate font-sans text-xs text-mist-500">{s.hint}</div>
                    <div
                      aria-hidden="true"
                      className={`absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r ${bar} to-transparent`}
                    />
                  </div>
                );
              })}
            </section>

            {/* ---------- Top solvers this week (weekly progress only) ---------- */}
            {!loading && topCards.length > 0 && (
              <section aria-label={isCg ? "Top XP earners this week" : "Top solvers this week"} className="mb-8">
                <div className="mb-3">
                  <div className="font-pixel text-[10px] uppercase tracking-widest text-mist-500">
                    // standings.top3
                  </div>
                  <h2 className="mt-1 font-pixel text-base font-bold uppercase tracking-wider text-strong">
                    {isCg ? "Top XP earners this week" : "Top solvers this week"}
                  </h2>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {topCards.map(({ user, handle, easy, medium, hard, level, solved, weekly }, i) => {
                    const medal = TOP_MEDALS[i];
                    const leaderWeekly = topCards[0]?.weekly ?? 0;
                    const vsLeader = leaderWeekly > 0 ? Math.round((weekly / leaderWeekly) * 100) : 0;
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => setSelectedUser(user)}
                        className={`pixel-card flex animate-rise cursor-pointer flex-col overflow-hidden text-left transition-transform duration-200 hover:-translate-y-1 active:translate-x-[1px] active:translate-y-[1px] ${focusRing}`}
                        style={{ animationDelay: `${i * 100}ms` }}
                      >
                        <div
                          className={`flex items-center justify-between border-b-2 border-ink-700 bg-ink-950 px-4 py-2.5 font-pixel text-[10px] font-bold uppercase tracking-wider ${medal.text}`}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {i === 0 ? (
                              <PixelCrown size={14} />
                            ) : (
                              <PixelTrophy variant={i === 1 ? "silver" : "bronze"} size={14} />
                            )}
                            #{i + 1} {medal.label}
                          </span>
                          <span>
                            +{weekly.toLocaleString()} {weeklyUnit}
                          </span>
                        </div>
                        <div className="flex flex-col gap-4 p-4">
                          <div className="flex items-center gap-3">
                            <TierAvatar user={user} className="size-12 shrink-0" />
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate font-sans font-bold text-strong">{user.displayName}</span>
                                {!isCg && weekly >= HOT_STREAK_THRESHOLD && <HotStreak />}
                              </div>
                              <div className="mt-0.5 truncate font-mono text-xs text-mist-500">@{handle}</div>
                              <div className="mt-1 flex h-6 min-w-0 items-center overflow-hidden">
                                {user.school?.trim() ? (
                                  <SchoolTag school={user.school} className="truncate max-w-full" />
                                ) : (
                                  <span className="font-mono text-[11px] text-mist-600/70" title="No school set">
                                    –
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {isCg ? (
                            <div className="flex items-center gap-3">
                              <LevelBadge level={level} />
                              <span className="font-pixel text-[9px] uppercase tracking-widest text-mist-500">
                                CodinGame level
                              </span>
                            </div>
                          ) : (
                            <DifficultyBar easy={easy} medium={medium} hard={hard} />
                          )}

                          <div>
                            <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-widest text-mist-500">
                              <span>vs leader</span>
                              <span>{vsLeader}%</span>
                            </div>
                            <div className="h-2 overflow-hidden border border-ink-700 bg-ink-950 p-[1px]">
                              <div
                                className={`h-full bg-gradient-to-r ${medal.bar}`}
                                style={{ width: `${vsLeader}%` }}
                              />
                            </div>
                          </div>

                          <div className="flex items-baseline justify-between border-t-2 border-ink-700 pt-3 font-mono text-xs">
                            <span className="text-mist-400">
                              <span className="font-bold tabular-nums text-strong">{solved.toLocaleString()}</span>{" "}
                              {totalUnit}
                            </span>
                            <span className="text-emerald-400 font-bold">+{weekly.toLocaleString()} this week</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ---------- Group growth ---------- */}
            {!loading && statsPlatform === "leetcode" && <GroupGrowthChart trend={trendData} />}
            {!loading && isCf && (
              <GroupGrowthChart
                trend={platformTrends.codeforces}
                description="Codeforces problems the linked members have solved since they linked their account"
                breakdownLabel="Solved by problem rating: under 1200, 1200 to 1699, 1700 and up"
              />
            )}
            {!loading && isCg && (
              <GroupGrowthChart
                trend={platformTrends.codingame}
                description="CodinGame XP the linked members have earned since they linked their account"
              />
            )}

            {/* ---------- Group activity heatmap (LeetCode submissions only) ---------- */}
            {!loading && statsPlatform === "leetcode" && <ActivityHeatmap users={users} />}
          </>
        )}

        {/* ======== Leaderboard page ======== */}
        {page === "leaderboard" && !loading && (
          <WinnerBanner winners={winners} users={users} nowMs={now} onSelect={setSelectedUser} />
        )}
        {page === "leaderboard" && (
          <section
            id="leaderboard-panel"
            role="table"
            aria-label="LeetCode weekly leaderboard"
            className="pixel-card overflow-hidden"
          >
            {/* Toolbar */}
            <div className="flex flex-col gap-3 border-b-2 border-ink-700 bg-ink-950/90 p-3 sm:flex-row sm:items-center md:p-4">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" />
                <input
                  type="text"
                  placeholder={t.searchPlaceholder}
                  aria-label="Search members"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`${inputCls} pl-9 pr-12`}
                  id="leaderboard-search"
                />
                <kbd
                  title={t.pressSlashToSearch}
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center justify-center h-5 px-1.5 font-pixel text-[9px] font-bold text-mist-400 bg-ink-800 border border-ink-700"
                >
                  /
                </kbd>
              </div>

              {cohorts.length > 0 && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <label htmlFor="cohort-filter" className="sr-only">
                    {t.filterCohort}
                  </label>
                  <select
                    id="cohort-filter"
                    aria-label={t.filterCohort}
                    value={selectedCohort}
                    onChange={(e) => setSelectedCohort(e.target.value)}
                    className="h-10 border-2 border-ink-700 bg-ink-950 px-3 font-mono text-xs font-medium text-mist-100 shadow-[2px_2px_0_#000] focus:border-teal-400 focus:outline-none"
                  >
                    <option value="">
                      {t.allCohorts} ({users.length})
                    </option>
                    {cohorts.map((c) => {
                      const count = users.filter(
                        (u) => (u.school ?? "").trim().toLowerCase() === c.toLowerCase()
                      ).length;
                      return (
                        <option key={c} value={c}>
                          {c} ({count})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <div
                role="group"
                aria-label="Sort leaderboard"
                className="inline-flex shrink-0 border-2 border-ink-700 bg-ink-950 p-1 shadow-[2px_2px_0_#000]"
              >
                {(
                  [
                    { key: "weekly", label: t.thisWeek, id: "sort-weekly-btn" },
                    { key: "allTime", label: t.allTime, id: "sort-alltime-btn" },
                    { key: "rating", label: t.contestRating, id: "sort-rating-btn" }
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSortBy(opt.key)}
                    aria-pressed={sortBy === opt.key}
                    id={opt.id}
                    className={`h-8 flex-1 cursor-pointer px-3.5 font-pixel text-[10px] uppercase transition-colors sm:flex-none ${focusRing} ${
                      sortBy === opt.key
                        ? "border border-teal-400 bg-ink-800 text-teal-300 shadow-[1px_1px_0_#000]"
                        : "border border-transparent text-mist-400 hover:text-mist-100"
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
            <div
              role="rowgroup"
              className="hidden border-b-2 border-ink-700 bg-ink-950 font-pixel text-[10px] uppercase tracking-wider text-mist-500 md:block"
            >
              <div role="row" className="grid grid-cols-12 gap-x-4 px-5 py-2.5">
                <div role="columnheader" aria-sort="none" className="col-span-1">
                  Rank
                </div>
                <div role="columnheader" aria-sort="none" className="col-span-4">
                  Member
                </div>
                <div role="columnheader" aria-sort={sortBy === "weekly" ? "descending" : "none"} className="col-span-3">
                  {sortBy === "weekly" ? "Tests passed (25)" : "Problems  E · M · H"}
                </div>
                <div role="columnheader" aria-sort={sortBy === "rating" ? "descending" : "none"} className="col-span-2">
                  Contest Tier
                </div>
                <div
                  role="columnheader"
                  aria-sort={sortBy === "allTime" ? "descending" : "none"}
                  className="col-span-2 pr-14 text-right"
                >
                  &Sigma; Solved
                </div>
              </div>
            </div>

            {loading ? (
              <div className="divide-y-2 divide-ink-800" aria-busy="true">
                <span className="sr-only">Loading leaderboard</span>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <div className="h-4 w-6 animate-pulse bg-ink-800" />
                    <div className="size-10 animate-pulse border border-ink-700 bg-ink-800" />
                    <div className="h-4 w-40 animate-pulse bg-ink-800" />
                    <div className="ml-auto h-4 w-12 animate-pulse bg-ink-800" />
                  </div>
                ))}
              </div>
            ) : (
              <div role="rowgroup" className="divide-y-2 divide-ink-800">
                <AnimatePresence mode="popLayout">
                  {sortedUsers.length === 0 ? (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <EmptyState
                        bare
                        icon={<Search className="size-5" aria-hidden="true" />}
                        title={
                          searchQuery || selectedCohort ? "No members match your filter" : "No members on the board yet"
                        }
                        description={
                          searchQuery || selectedCohort
                            ? "Try a different search term or cohort filter."
                            : "Link your LeetCode account in Account settings to join this board."
                        }
                        action={
                          searchQuery || selectedCohort
                            ? {
                                label: "Clear filters",
                                onClick: () => {
                                  setSearchQuery("");
                                  setSelectedCohort("");
                                }
                              }
                            : { label: "Link LeetCode", href: "#/account" }
                        }
                      />
                    </motion.div>
                  ) : (
                    sortedUsers.map((user) => {
                      const isPinned = pinnedUsers.includes(user.id);
                      const actualRank = displayRank(user);
                      const weeklyFilled = Math.min(25, user.weeklyProgress);

                      return (
                        <motion.div
                          key={user.id}
                          layoutId={user.id}
                          role="row"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{
                            layout: { type: "spring", stiffness: 420, damping: 38 },
                            opacity: { duration: 0.18 }
                          }}
                          className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-3.5 transition-colors md:grid-cols-12 md:gap-x-4 md:px-5 ${
                            isPinned
                              ? "bg-teal-950/20 shadow-[inset_3px_0_0_0_var(--color-teal-400)]"
                              : "bg-transparent hover:bg-ink-800/60 hover:shadow-[inset_3px_0_0_0_var(--color-aurora-a)]"
                          }`}
                          id={`member-row-${user.id}`}
                        >
                          {/* Rank */}
                          <div role="cell" className="flex flex-col items-start gap-1 md:col-span-1">
                            {actualRank != null ? (
                              <PixelRankBadge rank={actualRank} size="sm" />
                            ) : (
                              <span className="font-pixel text-[10px] text-mist-500">–</span>
                            )}
                          </div>

                          {/* Member — opens the full profile */}
                          <div role="cell" className="relative z-10 min-w-0 md:col-span-4">
                            <button
                              type="button"
                              onClick={() => setSelectedUser(user)}
                              title="View full profile"
                              className={`group/member flex w-full min-w-0 cursor-pointer items-center gap-3 pl-1 text-left transition-transform active:scale-[0.98] ${focusRing}`}
                            >
                              <TierAvatar
                                user={user}
                                className="size-11 shrink-0 transition duration-200 group-hover/member:scale-105"
                              />
                              <div className="min-w-0 flex-1 overflow-hidden">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate font-sans font-bold text-mist-100 transition-colors group-hover/member:text-teal-300">
                                    {user.displayName}
                                  </span>
                                  {user.weeklyProgress >= HOT_STREAK_THRESHOLD && <HotStreak />}
                                  <RankMovement movement={movements[user.id]} />
                                </div>
                                <div className="mt-0.5 truncate font-mono text-xs text-mist-500">
                                  @{user.loginUsername}
                                </div>
                                <div className="mt-1 flex h-6 min-w-0 items-center gap-2 overflow-hidden">
                                  {user.school?.trim() ? (
                                    <SchoolTag school={user.school} className="truncate max-w-full" />
                                  ) : (
                                    <span className="font-mono text-[11px] text-mist-600/70" title="No school set">
                                      –
                                    </span>
                                  )}
                                  {!boardStale && user.lastUpdated && isStale(user.lastUpdated, now) && (
                                    <div
                                      className="inline-flex shrink-0 items-center gap-1 border border-amber-400/30 bg-amber-950/60 px-1.5 py-0.5 font-mono text-[10px] text-amber-300"
                                      title={`Last successful LeetCode fetch: ${new Date(user.lastUpdated).toLocaleString()}. The board synced more recently, so LeetCode's API may be failing for this account.`}
                                    >
                                      <Clock className="size-2.5" aria-hidden="true" />
                                      {formatAge(user.lastUpdated, now)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </button>
                          </div>

                          {/* Progress — weekly bar when sorted by week, difficulty split otherwise. */}
                          <div role="cell" className="order-last col-span-3 md:order-none md:col-span-3 md:pr-4">
                            {sortBy === "weekly" ? (
                              <div className="flex w-full items-center gap-3">
                                <div
                                  className="flex h-3 w-full gap-[2px] border border-ink-700 bg-ink-950 p-[1px]"
                                  role="img"
                                  aria-label={`${user.weeklyProgress} solved this week`}
                                >
                                  {Array.from({ length: 25 }).map((_, i) => (
                                    <span
                                      key={i}
                                      className={`h-full flex-1 transition-colors duration-300 ${
                                        i < weeklyFilled ? "bg-emerald-400 shadow-[0_0_4px_#34d399]" : "bg-ink-900"
                                      }`}
                                    />
                                  ))}
                                </div>
                                <span className="w-10 shrink-0 text-right font-mono text-xs font-bold tabular-nums text-emerald-400">
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

                          {/* Contest rating */}
                          <div
                            role="cell"
                            className="order-last col-span-3 flex items-baseline gap-2 md:order-none md:col-span-2 md:block"
                          >
                            <span className="font-pixel text-[9px] uppercase text-mist-500 md:hidden">Rating:</span>
                            {user.contestRating != null ? (
                              <>
                                <span
                                  className="font-mono text-sm font-bold tabular-nums"
                                  style={{ color: ratingTier(user.contestRating).color }}
                                >
                                  {user.contestRating.toLocaleString()}
                                </span>
                                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-mist-500 md:block">
                                  <span style={{ color: ratingTier(user.contestRating).color }}>
                                    {ratingTier(user.contestRating).name}
                                  </span>{" "}
                                  · {user.contestsAttended}x
                                </span>
                              </>
                            ) : (
                              <span className="font-pixel text-[9px] uppercase tracking-wider text-mist-500">
                                Unrated
                              </span>
                            )}
                          </div>

                          {/* Total & controls */}
                          <div role="cell" className="flex items-center justify-end gap-1.5 md:col-span-2">
                            <div className="pr-2 text-right leading-none">
                              <div className="font-pixel text-base font-bold tabular-nums text-mist-100">
                                {user.allTimeSolved}
                              </div>
                              <div className="mt-0.5 font-pixel text-[8px] font-bold tracking-widest text-emerald-400">
                                AC
                              </div>
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
                              className={`grid size-7 cursor-pointer place-items-center border transition-colors ${focusRing} ${
                                isPinned
                                  ? "border-teal-400 bg-teal-950/60 text-teal-300"
                                  : "border-transparent text-mist-500 hover:border-ink-700 hover:bg-ink-800 hover:text-mist-100"
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
                                className={`grid size-7 cursor-pointer place-items-center border border-transparent text-mist-500 transition-colors hover:border-rose-500/50 hover:bg-rose-950/40 hover:text-rose-300 ${focusRing}`}
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
              <div className="mb-5 flex items-center gap-4 pr-8 border-b-2 border-ink-700 pb-4">
                <TierAvatar user={selectedUser} className="size-16" showGem gemSize="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-pixel text-sm uppercase tracking-wide text-strong">
                      {selectedUser.displayName}
                    </h3>
                    {selectedUser.weeklyProgress >= HOT_STREAK_THRESHOLD && <HotStreak className="size-4" />}
                  </div>
                  <div className="truncate font-mono text-xs text-mist-500">@{selectedUser.loginUsername}</div>
                  <div className="mt-1 font-mono text-xs text-mist-400">
                    {sortBy === "rating" ? "Contest rank" : "Rank"}{" "}
                    <span
                      className={`font-pixel text-[11px] font-bold tabular-nums ${rankColor(displayRank(selectedUser) ?? 0)}`}
                    >
                      {displayRank(selectedUser) != null ? `#${displayRank(selectedUser)}` : "Unranked"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress figures */}
              <div className="mb-4 grid grid-cols-3 gap-2">
                <div className="border-2 border-ink-700 bg-ink-950 p-3 shadow-[2px_2px_0_#000]">
                  <div className="font-pixel text-lg tabular-nums text-strong">{selectedUser.allTimeSolved}</div>
                  <div className="mt-1 font-pixel text-[9px] uppercase tracking-wider text-mist-500">All time</div>
                </div>
                <div className="border-2 border-teal-500/50 bg-teal-950/20 p-3 shadow-[2px_2px_0_#000]">
                  <div className="font-pixel text-lg tabular-nums text-teal-300">+{selectedUser.weeklyProgress}</div>
                  <div className="mt-1 font-pixel text-[9px] uppercase tracking-wider text-teal-400/80">This week</div>
                </div>
                <div className="border-2 border-ink-700 bg-ink-950 p-3 shadow-[2px_2px_0_#000]">
                  <div className="font-pixel text-lg tabular-nums text-strong">+{selectedUser.monthlyProgress}</div>
                  <div className="mt-1 font-pixel text-[9px] uppercase tracking-wider text-mist-500">This month</div>
                </div>
              </div>

              {/* Difficulty breakdown */}
              <div className="border-2 border-ink-700 bg-ink-950 p-3.5 shadow-[2px_2px_0_#000]">
                <DifficultyBar
                  easy={selectedUser.easySolved}
                  medium={selectedUser.mediumSolved}
                  hard={selectedUser.hardSolved}
                  size="lg"
                />
              </div>

              {/* One-line extras */}
              <div className="mt-3 flex items-center justify-between gap-3 font-mono text-xs text-mist-400 border-t border-ink-700/80 pt-3">
                <span className="inline-flex items-center gap-1.5">
                  <Flame
                    className={`size-4 ${(selectedUser.currentStreak ?? 0) > 0 ? "text-amber-400" : "text-mist-500"}`}
                    aria-hidden="true"
                  />
                  <span className="font-bold tabular-nums text-strong">{selectedUser.currentStreak ?? "–"}</span>
                  <span>day streak</span>
                </span>
                <span>
                  {selectedUser.contestRating != null ? (
                    <>
                      Rated{" "}
                      <span className="font-bold tabular-nums text-amber-300">
                        {selectedUser.contestRating.toLocaleString()}
                      </span>
                    </>
                  ) : (
                    "Unrated"
                  )}
                </span>
              </div>

              {/* Actions */}
              <div className="mt-5 flex flex-col gap-2 border-t-2 border-ink-700 pt-4">
                <a
                  href={`#/u/${encodeURIComponent(selectedUser.loginUsername)}`}
                  onClick={() => setSelectedUser(null)}
                  className={`${btnPrimary} w-full text-center justify-center font-pixel text-[11px] uppercase tracking-wider`}
                  id="view-full-profile-btn"
                >
                  <UserRound className="size-4" aria-hidden="true" />
                  View full profile
                </a>
                <div className="flex gap-2">
                  {selectedUser.leetcodeLinked && (
                    <a
                      href={`https://leetcode.com/${encodeURIComponent(selectedUser.leetcodeUsername)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${btnSecondary} min-w-0 flex-1 justify-center font-pixel text-[10px] uppercase tracking-wider`}
                    >
                      <span className="truncate">LeetCode</span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-amber-300" />
                    </a>
                  )}
                  <a
                    href={`#/compare/${encodeURIComponent(selectedUser.loginUsername)}`}
                    onClick={() => setSelectedUser(null)}
                    className={`${btnSecondary} min-w-0 flex-1 justify-center font-pixel text-[10px] uppercase tracking-wider`}
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

      {/* The bottom padding keeps the links clear of the floating buttons below */}
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 md:px-8">
        <SiteFooter newTab className="pb-24 sm:pb-20" />
      </div>

      {/* Star on GitHub + send feedback, bottom right of every page */}
      <FeedbackWidget />
    </div>
  );
}
