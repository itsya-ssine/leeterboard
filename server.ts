import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import "dotenv/config";
import { User, HistoryRecord, AdminSyncMember, AdminSyncReport } from "./src/types.js";
import { computeWeeklyWinners, mergeWinnerArchive, parseWinnerArchive, type WeeklyWinner } from "./src/winners.js";
import { DAY_SECONDS, type StreakInfo, parseSubmissionCalendar, streaksFromDays } from "./streaks.js";
import {
  initDb,
  listUsers,
  getUserById,
  getUserAuthByUsername,
  insertUser,
  updateUser,
  deleteUserById,
  updateDisplayName,
  getUserAuthById,
  setPasswordHash,
  recordFailedLogin,
  clearFailedLogins,
  createPendingRegistration,
  getPendingRegistration,
  bumpPendingAttempts,
  deletePendingRegistration,
  purgeExpiredRegistrations,
  getMeta,
  setMeta,
  recordSyncResult,
  listSyncStatus,
  type UserWithAuth
} from "./db.js";
import {
  setSessionCookie,
  clearSessionCookie,
  readSession,
  resolveSession,
  requireAuth,
  requireAdmin,
  isAdminUser,
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  isPasswordHash,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH
} from "./auth.js";
import { apiLimiter, loginLimiter, registerLimiter, verifyLimiter, accountLimiter, refreshLimiter } from "./rateLimit.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Needed so express-rate-limit sees the real client IP when running behind a
// reverse proxy (Vercel, Render, Railway, etc.) instead of the proxy's own
// address.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Thrown when a source positively confirms the username doesn't exist on LeetCode.
class LeetCodeUserNotFoundError extends Error {
  constructor(username: string) {
    super(`LeetCode user "${username}" doesn't exist.`);
    this.name = "LeetCodeUserNotFoundError";
  }
}

// Thrown when every source failed to respond (network/timeout/rate limit) —
// we genuinely don't know whether the user exists, so we must not guess.
class LeetCodeUnavailableError extends Error {
  constructor(username: string) {
    super(
      `Couldn't verify LeetCode user "${username}" right now — LeetCode's API may be temporarily unavailable. Try again in a moment.`
    );
    this.name = "LeetCodeUnavailableError";
  }
}

// Baseline hardening headers (kept dependency-free). X-Frame-Options stops
// the login form being framed for clickjacking; auth responses are never
// cached by the browser or any proxy.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (
    req.path.startsWith("/api/auth") ||
    req.path.startsWith("/api/account") ||
    req.path.startsWith("/api/admin") ||
    req.path === "/api/logout"
  ) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

// Nothing here needs a large body; a small cap rejects oversized payloads early.
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

// General ceiling on all API traffic. Individual sensitive routes below
// (login, sign-up, LeetCode-scraping refreshes) layer a stricter,
// route-specific limiter on top of this one.
app.use("/api", apiLimiter);

// dbReady gates every request behind initDb() completing at least once.
// On a persistent host this resolves once at boot. On Vercel, the module
// (and this promise) is created once per cold-started function instance and
// reused for every invocation handled by that instance, so this still only
// runs once per instance rather than once per request. Registered before
// any routes below so it actually applies to all of them.
const dbReady = initDb();
app.use((req, res, next) => {
  dbReady.then(() => next()).catch(next);
});

// Utility to calculate ranks and progress metrics
function sortAndRankUsers(users: User[]) {
  // We sort primarily by Weekly Progress (to encourage active, weekly problem solving momentum!)
  // In case of a tie, we sort by All-Time solved counts
  users.sort((a, b) => {
    if (b.weeklyProgress !== a.weeklyProgress) {
      return b.weeklyProgress - a.weeklyProgress;
    }
    return b.allTimeSolved - a.allTimeSolved;
  });

  users.forEach((u, index) => {
    u.rank = index + 1;
  });
}

// Fetches real solved-problem counts for a LeetCode username.
// Throws LeetCodeUserNotFoundError when a source positively confirms the
// username doesn't exist, or LeetCodeUnavailableError when every source
// failed to respond and we can't tell either way. Never invents numbers.
//
// Note: weekly/monthly progress is NOT computed here. LeetCode's public,
// unauthenticated recentAcSubmissionList endpoint silently caps at ~20
// records no matter what "limit" you pass, so anyone who solved more than
// ~20 problems in a week would get silently undercounted. Instead, weekly/
// monthly progress is derived from our own stored history snapshots — see
// computeProgressFromHistory() below, called by the route handlers.
async function scrapeLeetCodeProfile(username: string): Promise<{
  allTimeSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  source: string;
  avatarUrl?: string;
}> {
  const cleanUsername = username.trim();
  let confirmedNotFound = false;

  // 1. Official LeetCode GraphQL endpoint (same one leetcode.com's own frontend calls)
  try {
    const query = `
      query userProblemsSolved($username: String!) {
        matchedUser(username: $username) {
          profile {
            userAvatar
          }
          submitStatsGlobal {
            acSubmissionNum {
              difficulty
              count
            }
          }
        }
      }
    `;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Referer": "https://leetcode.com",
        "Origin": "https://leetcode.com"
      },
      body: JSON.stringify({ query, variables: { username: cleanUsername } }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const json: any = await response.json();
      const matchedUser = json?.data?.matchedUser;

      if (matchedUser === null) {
        // LeetCode explicitly returns matchedUser: null for a username
        // that doesn't exist — this is a confirmed answer, not a failure.
        confirmedNotFound = true;
      } else {
        const acSubmissions = matchedUser?.submitStatsGlobal?.acSubmissionNum;
        if (acSubmissions && acSubmissions.length > 0) {
          const all = acSubmissions.find((x: any) => x.difficulty === "All")?.count || 0;
          const easy = acSubmissions.find((x: any) => x.difficulty === "Easy")?.count || 0;
          const medium = acSubmissions.find((x: any) => x.difficulty === "Medium")?.count || 0;
          const hard = acSubmissions.find((x: any) => x.difficulty === "Hard")?.count || 0;

          let avatarUrl = matchedUser?.profile?.userAvatar;
          if (avatarUrl && avatarUrl.startsWith("/")) {
            avatarUrl = `https://leetcode.com${avatarUrl}`;
          }

          return {
            allTimeSolved: all,
            easySolved: easy,
            mediumSolved: medium,
            hardSolved: hard,
            source: "Official GraphQL",
            avatarUrl: avatarUrl || undefined
          };
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Fetch] Official LeetCode GraphQL failed/timed out: ${err.message}`);
  }

  // 2. Alfa LeetCode API (public wrapper around the same GraphQL data)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(`https://alfa-leetcode-api.onrender.com/userProfile/${encodeURIComponent(cleanUsername)}`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.status === 404) {
      confirmedNotFound = true;
    } else if (response.ok) {
      const data: any = await response.json();
      if (data?.errors) {
        confirmedNotFound = true;
      } else if (typeof data.totalSolved === "number") {
        let avatarUrl = data.avatar;
        if (avatarUrl && avatarUrl.startsWith("/")) {
          avatarUrl = `https://leetcode.com${avatarUrl}`;
        }
        return {
          allTimeSolved: data.totalSolved || 0,
          easySolved: data.easySolved || 0,
          mediumSolved: data.normalSolved || data.mediumSolved || 0,
          hardSolved: data.hardSolved || 0,
          source: "Alfa API Proxy",
          avatarUrl: avatarUrl || undefined
        };
      }
    }
  } catch (err: any) {
    console.warn(`[Fetch] Alfa API Proxy failed: ${err.message}`);
  }

  // 3. leetcode-stats-api (fallback)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`https://leetcode-stats-api.herokuapp.com/${encodeURIComponent(cleanUsername)}`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.status === 404) {
      confirmedNotFound = true;
    } else if (response.ok) {
      const data: any = await response.json();
      if (data?.status === "error") {
        confirmedNotFound = true;
      } else if (data?.status === "success") {
        return {
          allTimeSolved: data.totalSolved || 0,
          easySolved: data.easySolved || 0,
          mediumSolved: data.mediumSolved || 0,
          hardSolved: data.hardSolved || 0,
          source: "Stats API Proxy"
        };
      }
    }
  } catch (err: any) {
    console.warn(`[Fetch] Stats API Proxy failed: ${err.message}`);
  }

  // Every source either explicitly said "doesn't exist" or failed outright.
  // Report the truth instead of making up numbers.
  if (confirmedNotFound) {
    throw new LeetCodeUserNotFoundError(cleanUsername);
  }
  throw new LeetCodeUnavailableError(cleanUsername);
}

// A member's LeetCode contest standing.
interface ContestRating {
  rating: number;
  attended: number;
}

// Outcome of one attempt to look up a contest rating:
//  - ContestRating: the user is rated
//  - "unrated":     the source answered and says the user never entered a contest
//  - "failed":      no usable answer (blocked, timeout, HTTP error, odd response)
type ContestLookup = ContestRating | "unrated" | "failed";

function toContestRating(ranking: any): ContestRating | null {
  if (!ranking || typeof ranking.rating !== "number" || !Number.isFinite(ranking.rating)) return null;
  return { rating: Math.round(ranking.rating), attended: Number(ranking.attendedContestsCount) || 0 };
}

// Source 1: LeetCode's own GraphQL endpoint.
async function fetchContestFromGraphQL(username: string): Promise<ContestLookup> {
  try {
    const query = `
      query userContestRankingInfo($username: String!) {
        userContestRanking(username: $username) {
          attendedContestsCount
          rating
        }
      }
    `;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Referer": "https://leetcode.com",
        "Origin": "https://leetcode.com"
      },
      body: JSON.stringify({ query, variables: { username: username.trim() } }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Contest] LeetCode GraphQL returned HTTP ${response.status} for ${username}`);
      return "failed";
    }

    const json: any = await response.json();
    if (json?.errors || !json?.data) {
      console.warn(`[Contest] LeetCode GraphQL returned an error/empty body for ${username}`);
      return "failed";
    }

    const ranking = json.data.userContestRanking;
    if (ranking === null) return "unrated"; // a definitive answer: never entered a contest
    const rated = toContestRating(ranking);
    if (rated) return rated;

    console.warn(`[Contest] LeetCode GraphQL returned an unrecognised shape for ${username}`);
    return "failed";
  } catch (err: any) {
    console.warn(`[Contest] LeetCode GraphQL failed for ${username}: ${err.message}`);
    return "failed";
  }
}

// Source 2: the public Alfa wrapper. Only consulted when LeetCode itself
// gave no usable answer (e.g. it blocks this server's IP, which is why the
// solved-count scraper has fallbacks too). Accepts the response either
// wrapped in { data } or bare, since wrapper versions differ.
async function fetchContestFromAlfa(username: string): Promise<ContestLookup> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(
      `https://alfa-leetcode-api.onrender.com/userContestRankingInfo/${encodeURIComponent(username.trim())}`,
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Contest] Alfa API returned HTTP ${response.status} for ${username}`);
      return "failed";
    }

    const json: any = await response.json();
    if (json?.errors) {
      console.warn(`[Contest] Alfa API returned an error body for ${username}`);
      return "failed";
    }

    const ranking = (json?.data ?? json)?.userContestRanking;
    if (ranking === null) return "unrated";
    const rated = toContestRating(ranking);
    if (rated) return rated;

    console.warn(`[Contest] Alfa API returned an unrecognised shape for ${username}`);
    return "failed";
  } catch (err: any) {
    console.warn(`[Contest] Alfa API failed for ${username}: ${err.message}`);
    return "failed";
  }
}

// Best-effort contest rating for a LeetCode username.
//
// Returns null whenever there is no rating to report: the user has never
// entered a contest, OR no source could answer. Callers treat null as
// "leave whatever we have stored alone", so a flaky response can never wipe
// out a real rating. Never throws, and is independent of
// scrapeLeetCodeProfile (whose fallback sources don't expose ratings).
async function fetchContestRating(username: string): Promise<ContestRating | null> {
  let result = await fetchContestFromGraphQL(username);
  if (result === "failed") {
    result = await fetchContestFromAlfa(username);
  }
  return typeof result === "object" ? result : null;
}

// Daily-submission streaks, straight from LeetCode's own submission calendar
// (the same data behind the heatmap on a member's LeetCode profile) instead of
// our sync snapshots, which only move when a sync happens to see a higher total.
async function fetchCalendarYear(
  username: string,
  year?: number
): Promise<{ activeYears: number[]; streak: number | null; days: number[] } | null> {
  try {
    const query = `
      query userProfileCalendar($username: String!, $year: Int) {
        matchedUser(username: $username) {
          userCalendar(year: $year) {
            activeYears
            streak
            submissionCalendar
          }
        }
      }
    `;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Referer": "https://leetcode.com",
        "Origin": "https://leetcode.com"
      },
      body: JSON.stringify({ query, variables: { username: username.trim(), year: year ?? null } }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Streak] LeetCode GraphQL returned HTTP ${response.status} for ${username}`);
      return null;
    }

    const json: any = await response.json();
    const cal = json?.data?.matchedUser?.userCalendar;
    if (json?.errors || !cal) {
      console.warn(`[Streak] LeetCode GraphQL returned an error/empty body for ${username}`);
      return null;
    }

    const days = parseSubmissionCalendar(cal.submissionCalendar);
    if (!days) {
      console.warn(`[Streak] Unrecognised submissionCalendar shape for ${username}`);
      return null;
    }

    return {
      activeYears: Array.isArray(cal.activeYears) ? cal.activeYears.filter(Number.isInteger) : [],
      streak: typeof cal.streak === "number" && Number.isFinite(cal.streak) ? cal.streak : null,
      days
    };
  } catch (err: any) {
    console.warn(`[Streak] LeetCode GraphQL failed for ${username}: ${err.message}`);
    return null;
  }
}

// Best-effort current + longest streak for a LeetCode username.
//
// Both numbers are computed from the submission calendar (UTC days) so they
// always agree with each other. LeetCode's own `streak` field is not used:
// it disagreed with the calendar (the old code logged those mismatches) and
// it fed straight into "longest", inflating it permanently.
//
// Every active year is read each sync (in parallel), so "longest" is rebuilt
// from the full history and self-corrects. Only when some year failed to
// load do we fall back to never lowering the stored value, so a flaky
// response can't shrink a real record.
//
// Returns null when LeetCode gave no usable answer. Callers treat null as
// "leave whatever we have stored alone", so a flaky response can never reset a
// real streak to 0. Never throws.
async function fetchStreaks(username: string, knownLongest: number | null): Promise<StreakInfo | null> {
  const first = await fetchCalendarYear(username);
  if (!first) return null;

  const thisYear = new Date().getUTCFullYear();
  const days = new Set<number>(first.days);

  // The default window already covers the current year and the last 12 months.
  const otherYears = first.activeYears.filter((y) => y !== thisYear);
  const results = await Promise.all(otherYears.map((y) => fetchCalendarYear(username, y)));
  let complete = true;
  for (const more of results) {
    if (more) more.days.forEach((d) => days.add(d));
    else complete = false;
  }

  const computed = streaksFromDays(days, Math.floor(Date.now() / 1000 / DAY_SECONDS));
  if (first.streak !== null && first.streak !== computed.current) {
    console.warn(`[Streak] ${username}: LeetCode says ${first.streak}, calendar says ${computed.current} (using calendar)`);
  }
  const longest = complete ? computed.longest : Math.max(knownLongest ?? 0, computed.longest);
  return { current: computed.current, longest };
}

// Problems solved in the trailing `days` calendar days (UTC, today included).
//
// History holds one snapshot per UTC day (the last sync of that day), and
// syncs can be sparse. The baseline is the total as of the END of the UTC day
// `days` days ago, linearly interpolated between the two snapshots that
// bracket it (the current total counts as a snapshot taken now). A gap in
// history is therefore spread over the days it covers instead of being dumped
// into the window. If the member joined inside the window, the result is
// "solved since they joined" (never more than the window), measured from the
// total they had when they joined.
// Returns null only when there is no history at all.
//
// For the weekly counter use computeWeeklyProgressFromHistory(), which resets
// every Monday instead of rolling over the last 7 days.
function computeProgressFromHistory(
  history: HistoryRecord[],
  currentTotal: number,
  days: number,
  now: number = Date.now(),
  joined?: { date: string; solved: number }
): number | null {
  if (!history || history.length === 0) return null;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const endOfToday = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS - 1;
  const target = endOfToday - days * DAY_MS;

  // One point per date; a snapshot represents the total at the end of its
  // UTC day (it is overwritten by later syncs that day), capped at `now`.
  const byDate = new Map<string, { t: number; count: number }>();
  for (const r of history) {
    const t = Date.parse(`${r.date}T23:59:59.999Z`);
    if (!Number.isFinite(t) || t > now) continue;
    byDate.set(r.date, { t, count: r.solvedCount });
  }
  // The member's total when they joined is the earliest known point, taken at
  // the start of their joining day. It is what a window that reaches back
  // before they joined is measured from, so progress is exact from day one
  // instead of waiting for a second snapshot.
  if (joined && /^\d{4}-\d{2}-\d{2}$/.test(joined.date)) {
    const t = Date.parse(`${joined.date}T00:00:00.000Z`);
    if (Number.isFinite(t) && t <= now) byDate.set(`joined:${joined.date}`, { t, count: joined.solved });
  }
  const points = [...byDate.values()].sort((a, b) => a.t - b.t);
  // The live total is the newest point. Keep it monotonic: a lower live total
  // (LeetCode revoking solves) must not produce negative progress.
  points.push({ t: now, count: currentTotal });

  let before: { t: number; count: number } | null = null;
  let after: { t: number; count: number } | null = null;
  for (const p of points) {
    if (p.t <= target) before = p;
    else { after = p; break; }
  }

  let baseline: number;
  if (!before) {
    baseline = points[0].count; // tracking started inside the window
  } else if (!after || after.t === before.t) {
    baseline = before.count;
  } else {
    const ratio = (target - before.t) / (after.t - before.t);
    baseline = before.count + (after.count - before.count) * ratio;
  }

  return Math.max(0, Math.round(currentTotal - baseline));
}

// A member's starting point for progress maths (see User.trackingStart).
function baselineOf(user: User): { date: string; solved: number } {
  return { date: user.trackingStart, solved: user.baselineSolved };
}

// Number of UTC days in the current Monday-to-Sunday week, up to and including
// today: 1 on Monday, 7 on Sunday.
function daysIntoWeek(now: number = Date.now()): number {
  return ((new Date(now).getUTCDay() + 6) % 7) + 1;
}

// Problems solved so far in the current calendar week (Monday 00:00 UTC to
// now). The baseline is the total at the end of last Sunday, so the counter
// starts again from 0 for every member on Monday.
function computeWeeklyProgressFromHistory(
  history: HistoryRecord[],
  currentTotal: number,
  now: number = Date.now(),
  joined?: { date: string; solved: number }
): number | null {
  return computeProgressFromHistory(history, currentTotal, daysIntoWeek(now), now, joined);
}

// REST API Endpoints

// Weekly winners. History only keeps ~60 daily snapshots, so each finished
// week's winner is worked out once from it and then archived in the meta
// table; the hall of fame reads from that archive and so outlives the history.
const WINNERS_META_KEY = "weeklyWinners";

async function resolveWinners(users: User[]): Promise<WeeklyWinner[]> {
  // Nothing to compare (or a read that came back empty by mistake): don't
  // touch the stored archive.
  if (users.length === 0) return [];
  try {
    const stored = parseWinnerArchive(await getMeta(WINNERS_META_KEY));
    const merged = mergeWinnerArchive(stored, computeWeeklyWinners(users, Date.now()));
    // Members who left the board take their wins with them.
    const ids = new Set(users.map((u) => u.id));
    const kept = merged.filter((w) => ids.has(w.userId));
    if (JSON.stringify(kept) !== JSON.stringify(stored)) {
      await setMeta(WINNERS_META_KEY, JSON.stringify(kept));
    }
    return kept;
  } catch (err: any) {
    // The board is still useful without the banner.
    console.warn(`[Winners] Couldn't resolve weekly winners: ${err.message}`);
    return [];
  }
}

// GET all users (with automatic ranking update)
app.get("/api/users", async (req, res) => {
  try {
    const users = await listUsers();
    sortAndRankUsers(users);
    const lastSyncAll = (await getMeta("lastSyncAll")) || "";
    const winners = await resolveWinners(users);
    res.json({ users, lastSyncAll, winners });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/* ---------- Auth: LeetCode username + password ---------- */
//
// Accounts are keyed by LeetCode username and protected by a password chosen
// on this site (never the LeetCode password — we never ask for that).
//
// Because anyone could type any LeetCode username, creating an account (or
// setting a new password) first requires proof that the LeetCode profile is
// yours: the server hands out a random code, you paste it into your LeetCode
// profile "Summary", and the server reads the public profile back to check
// it. Nobody else can edit your profile, so nobody else can pass the check.
// The same proof is how accounts that existed before passwords can be claimed,
// and how a forgotten password is reset.

const LEETCODE_USERNAME_RE = /^[A-Za-z0-9_.-]{1,50}$/;
const MAX_DISPLAY_NAME_LENGTH = 40;

const REGISTRATION_COOKIE = "registration";
const REGISTRATION_TTL_MS = 30 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 10;

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const registrationCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth"
};

// Strict allow-list: it keeps the username safe to embed in the third-party
// URLs we call, and rejects anything that isn't a plausible LeetCode handle.
function parseLeetCodeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return LEETCODE_USERNAME_RE.test(v) ? v : null;
}

function validatePassword(password: unknown, username: string): string | null {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (password.toLowerCase() === username.toLowerCase()) return "Password can't be the same as your username.";
  return null;
}

function cleanDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH);
  return v || fallback;
}

// Used when LeetCode doesn't give us an avatar. Built from one validated
// letter only, so nothing user-controlled ends up inside the SVG.
function defaultAvatar(name: string): string {
  const letter = (name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
    `<rect width="120" height="120" fill="#171c25"/>` +
    `<text x="60" y="60" dy=".35em" text-anchor="middle" font-family="sans-serif" ` +
    `font-size="56" font-weight="600" fill="#2dd4bf">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

type AboutLookup =
  | { status: "ok"; username: string; aboutMe: string }
  | { status: "not_found" }
  | { status: "unavailable" };

// Reads a LeetCode profile's public "Summary" (aboutMe) and its canonical
// username. "not_found" is only reported when a source positively says the
// user doesn't exist; anything else that goes wrong is "unavailable".
async function fetchLeetCodeAbout(username: string): Promise<AboutLookup> {
  let notFound = false;

  // 1. Official LeetCode GraphQL endpoint
  try {
    const query = `
      query userAbout($username: String!) {
        matchedUser(username: $username) {
          username
          profile {
            aboutMe
          }
        }
      }
    `;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Referer": "https://leetcode.com",
        "Origin": "https://leetcode.com"
      },
      body: JSON.stringify({ query, variables: { username } }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const json: any = await response.json();
      const matched = json?.data?.matchedUser;
      if (matched) {
        return {
          status: "ok",
          username: String(matched.username || username),
          aboutMe: String(matched.profile?.aboutMe ?? "")
        };
      }
      if (json?.data && matched === null) notFound = true;
    }
  } catch (err: any) {
    console.warn(`[Auth] LeetCode GraphQL profile lookup failed: ${err.message}`);
  }

  // 2. Alfa API proxy — only consulted when LeetCode itself gave no answer
  // (e.g. it blocks this server's IP). Best effort: if the wrapper doesn't
  // return a summary we report "unavailable" instead of guessing.
  if (!notFound) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(`https://alfa-leetcode-api.onrender.com/${encodeURIComponent(username)}`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        notFound = true;
      } else if (response.ok) {
        const data: any = await response.json();
        if (data?.errors) {
          notFound = true;
        } else if (typeof data?.username === "string" && (typeof data.about === "string" || data.about === null)) {
          return { status: "ok", username: data.username, aboutMe: data.about ?? "" };
        }
      }
    } catch (err: any) {
      console.warn(`[Auth] Alfa API profile lookup failed: ${err.message}`);
    }
  }

  return notFound ? { status: "not_found" } : { status: "unavailable" };
}

const LEETCODE_UNAVAILABLE_MESSAGE =
  "Couldn't reach LeetCode right now. Please try again in a moment.";

// POST — step 1 of sign-up / claim / password reset. Validates the input,
// hashes the password, stores it as a pending registration and returns the
// code to put in the LeetCode profile summary. Nothing about the account
// changes until step 2 succeeds.
app.post("/api/auth/register", registerLimiter, async (req, res) => {
  try {
    const { leetcodeUsername, password, displayName } = req.body ?? {};

    const username = parseLeetCodeUsername(leetcodeUsername);
    if (!username) {
      return res.status(400).json({
        error: "Enter a valid LeetCode username (letters, numbers, dots, dashes and underscores)."
      });
    }
    const passwordError = validatePassword(password, username);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    // Fail fast with a clear message if the LeetCode account doesn't exist.
    const lookup = await fetchLeetCodeAbout(username);
    if (lookup.status === "not_found") {
      return res.status(404).json({ error: `LeetCode user "${username}" doesn't exist.` });
    }
    if (lookup.status === "unavailable") {
      return res.status(503).json({ error: LEETCODE_UNAVAILABLE_MESSAGE });
    }

    const existing = await getUserAuthByUsername(lookup.username);
    const purpose: "create" | "claim" | "reset" = !existing
      ? "create"
      : isPasswordHash(existing.auth.passwordHash)
        ? "reset"
        : "claim";
    // Keep the casing already on the board for existing members.
    const storedUsername = existing ? existing.user.leetcodeUsername : lookup.username;

    const registrationId = crypto.randomBytes(32).toString("hex");
    const code = `leeterboard-${crypto.randomBytes(6).toString("hex")}`;
    const now = Date.now();

    await purgeExpiredRegistrations(new Date(now).toISOString());
    await createPendingRegistration({
      id: registrationId,
      leetcodeUsername: storedUsername,
      displayName: cleanDisplayName(displayName, storedUsername),
      passwordHash: await hashPassword(password as string),
      code,
      expiresAt: new Date(now + REGISTRATION_TTL_MS).toISOString()
    });

    res.cookie(REGISTRATION_COOKIE, registrationId, { ...registrationCookieOptions, maxAge: REGISTRATION_TTL_MS });
    res.json({
      code,
      purpose,
      leetcodeUsername: storedUsername,
      expiresInMinutes: REGISTRATION_TTL_MS / 60_000
    });
  } catch (error: any) {
    console.error(`[Auth] register failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — step 2. Reads the person's public LeetCode summary and, if it
// contains the code from step 1, creates the account (or sets the new
// password on an existing one) and signs them in.
app.post("/api/auth/register/verify", verifyLimiter, async (req, res) => {
  try {
    const registrationId = req.cookies?.[REGISTRATION_COOKIE];
    if (typeof registrationId !== "string" || !/^[a-f0-9]{64}$/.test(registrationId)) {
      return res.status(400).json({ error: "No sign-up in progress. Please start again.", expired: true });
    }

    const pending = await getPendingRegistration(registrationId);
    if (!pending || Date.parse(pending.expiresAt) < Date.now()) {
      if (pending) await deletePendingRegistration(pending.id);
      res.clearCookie(REGISTRATION_COOKIE, registrationCookieOptions);
      return res.status(400).json({ error: "This sign-up has expired. Please start again.", expired: true });
    }
    if (pending.attempts >= MAX_VERIFY_ATTEMPTS) {
      await deletePendingRegistration(pending.id);
      res.clearCookie(REGISTRATION_COOKIE, registrationCookieOptions);
      return res.status(429).json({ error: "Too many failed checks. Please start again.", expired: true });
    }

    const lookup = await fetchLeetCodeAbout(pending.leetcodeUsername);
    if (lookup.status === "not_found") {
      return res.status(404).json({ error: `LeetCode user "${pending.leetcodeUsername}" doesn't exist.` });
    }
    if (lookup.status === "unavailable") {
      return res.status(503).json({ error: LEETCODE_UNAVAILABLE_MESSAGE });
    }

    if (!lookup.aboutMe.toLowerCase().includes(pending.code.toLowerCase())) {
      await bumpPendingAttempts(pending.id);
      return res.status(400).json({
        error:
          "We couldn't find the code in your LeetCode summary yet. Save your profile on LeetCode, wait a few seconds, then try again."
      });
    }

    // Ownership proven. Re-check the account state now rather than trusting
    // what it was when the sign-up started.
    const existing = await getUserAuthByUsername(pending.leetcodeUsername);
    let user: User;

    if (existing) {
      // Claiming a pre-password account, or resetting a forgotten password.
      // Stats and history are untouched; changing the hash also signs out
      // every older session.
      await setPasswordHash(existing.user.id, pending.passwordHash);
      user = existing.user;
    } else {
      // Fetch real initial stats — throws if the username can't currently be
      // verified. The rating/streak lookups never throw.
      const [scraped, contest, streaks] = await Promise.all([
        scrapeLeetCodeProfile(pending.leetcodeUsername),
        fetchContestRating(pending.leetcodeUsername),
        fetchStreaks(pending.leetcodeUsername, null)
      ]);
      const todayStr = new Date().toISOString().split("T")[0];

      user = {
        id: `user-${crypto.randomUUID()}`,
        displayName: pending.displayName,
        leetcodeUsername: pending.leetcodeUsername,
        avatarUrl: scraped.avatarUrl || defaultAvatar(pending.leetcodeUsername),
        allTimeSolved: scraped.allTimeSolved,
        easySolved: scraped.easySolved,
        mediumSolved: scraped.mediumSolved,
        hardSolved: scraped.hardSolved,
        contestRating: contest?.rating ?? null,
        contestsAttended: contest?.attended ?? 0,
        currentStreak: streaks?.current ?? null,
        longestStreak: streaks?.longest ?? null,
        // Nothing solved *since joining* yet, so progress starts at 0. The
        // total they have right now is their baseline: everything solved
        // before today never counts, everything solved from now on does,
        // starting with this first (partial) week.
        weeklyProgress: 0,
        monthlyProgress: 0,
        rank: 0,
        lastUpdated: new Date().toISOString(),
        trackingStart: todayStr,
        baselineSolved: scraped.allTimeSolved,
        history: [
          {
            date: todayStr,
            solvedCount: scraped.allTimeSolved,
            easy: scraped.easySolved,
            medium: scraped.mediumSolved,
            hard: scraped.hardSolved,
            weeklyProgress: 0
          }
        ]
      };
      await insertUser(user, pending.passwordHash);
    }

    await deletePendingRegistration(pending.id);
    res.clearCookie(REGISTRATION_COOKIE, registrationCookieOptions);
    setSessionCookie(res, user, pending.passwordHash);
    res.status(existing ? 200 : 201).json({ ...user, isAdmin: isAdminUser(user) });
  } catch (error: any) {
    if (error instanceof LeetCodeUserNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof LeetCodeUnavailableError) {
      return res.status(503).json({ error: error.message });
    }
    if (String(error?.message).includes("UNIQUE")) {
      // Two sign-ups for the same username raced each other.
      return res.status(409).json({ error: "That LeetCode username was just registered. Try logging in." });
    }
    console.error(`[Auth] verify failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — password login.
app.post("/api/auth/login", loginLimiter, async (req, res) => {
  try {
    const { leetcodeUsername, password } = req.body ?? {};
    if (typeof leetcodeUsername !== "string" || typeof password !== "string" || !leetcodeUsername.trim() || !password) {
      return res.status(400).json({ error: "Enter your LeetCode username and password." });
    }

    // One message for "no such user" and "wrong password", so the form can't
    // be used to probe which accounts have passwords.
    const INVALID = { error: "Invalid username or password." };

    if (password.length > MAX_PASSWORD_LENGTH) {
      return res.status(401).json(INVALID);
    }

    const record = await getUserAuthByUsername(leetcodeUsername.trim());
    if (!record) {
      await burnPasswordCheck(password); // same cost as a real check
      return res.status(401).json(INVALID);
    }

    const { user, auth } = record;

    if (auth.lockedUntil) {
      const until = Date.parse(auth.lockedUntil);
      if (until > Date.now()) {
        const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
        return res.status(429).json({
          error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password from the Sign up tab.`
        });
      }
      await clearFailedLogins(user.id); // lock has expired
    }

    if (!isPasswordHash(auth.passwordHash)) {
      // Account from before passwords existed: no password to check yet.
      await burnPasswordCheck(password);
      return res.status(401).json({
        error: "This account has no password yet. Use the Sign up tab to verify your LeetCode profile and set one.",
        needsPassword: true
      });
    }

    if (!(await verifyPassword(password, auth.passwordHash))) {
      await recordFailedLogin(user.id, MAX_FAILED_LOGINS, new Date(Date.now() + LOCKOUT_MS).toISOString());
      return res.status(401).json(INVALID);
    }

    if (auth.failedLogins > 0) await clearFailedLogins(user.id);
    setSessionCookie(res, user, auth.passwordHash);
    res.json({ ...user, isAdmin: isAdminUser(user) });
  } catch (error: any) {
    console.error(`[Auth] login failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST logout
app.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// GET current auth state: "guest" (no valid session) or "authenticated". The
// frontend uses this single endpoint to decide what to render.
app.get("/api/auth/session", async (req, res) => {
  try {
    const resolved = await resolveSession(req);
    if (!resolved) {
      // Drop a stale/invalid cookie (deleted account, changed password, ...).
      if (readSession(req)) clearSessionCookie(res);
      return res.json({ status: "guest" });
    }
    res.json({ status: "authenticated", user: { ...resolved.user, isAdmin: resolved.isAdmin } });
  } catch (error: any) {
    console.error(`[Auth] session check failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/* ---------- Account settings (signed-in members) ---------- */

// Re-checks the member's current password for sensitive actions (changing
// the password, deleting the account), so a stolen session alone isn't
// enough. Wrong guesses count toward the same lockout as the login form.
async function checkCurrentPassword(
  userId: string,
  password: unknown
): Promise<{ record: UserWithAuth | null; status: number; error: string }> {
  const fail = (status: number, error: string) => ({ record: null, status, error });

  if (typeof password !== "string" || !password) return fail(400, "Enter your current password.");
  const record = await getUserAuthById(userId);
  if (!record) return fail(401, "You must be logged in to do that.");

  if (!isPasswordHash(record.auth.passwordHash)) {
    return fail(
      409,
      "This account has no password yet. Log out, then use Sign up to verify your LeetCode profile and set one."
    );
  }

  if (record.auth.lockedUntil) {
    const until = Date.parse(record.auth.lockedUntil);
    if (until > Date.now()) {
      const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      return fail(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }
    await clearFailedLogins(userId); // lock has expired
  }

  if (password.length > MAX_PASSWORD_LENGTH || !(await verifyPassword(password, record.auth.passwordHash))) {
    await recordFailedLogin(userId, MAX_FAILED_LOGINS, new Date(Date.now() + LOCKOUT_MS).toISOString());
    return fail(401, "Current password is incorrect.");
  }

  if (record.auth.failedLogins > 0) await clearFailedLogins(userId);
  return { record, status: 200, error: "" };
}

// PATCH — change the display name. The avatar is not editable: it always
// comes from the member's LeetCode account.
app.patch("/api/account/profile", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    const cleaned = cleanDisplayName(req.body?.displayName, "");
    if (!cleaned) return res.status(400).json({ error: "Display name can't be empty." });

    await updateDisplayName(id, cleaned);
    const updated = await getUserById(id);
    if (!updated) return res.status(401).json({ error: "You must be logged in to do that." });
    res.json({ ...updated, isAdmin: isAdminUser(updated) });
  } catch (error: any) {
    console.error(`[Account] profile update failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — change password. Needs the current one; signs out every other
// session and keeps this one signed in with a fresh cookie.
app.post("/api/account/password", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id, leetcodeUsername } = (req as any).user as { id: string; leetcodeUsername: string };
    const { currentPassword, newPassword } = req.body ?? {};

    const check = await checkCurrentPassword(id, currentPassword);
    if (!check.record) return res.status(check.status).json({ error: check.error });

    const passwordError = validatePassword(newPassword, leetcodeUsername);
    if (passwordError) return res.status(400).json({ error: passwordError });
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: "Your new password must be different from the current one." });
    }

    const newHash = await hashPassword(newPassword as string);
    await setPasswordHash(id, newHash);
    setSessionCookie(res, check.record.user, newHash);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Account] password change failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — delete the member's own account for good (stats and history
// included). Needs the password. POST rather than DELETE so the body always
// survives proxies.
app.post("/api/account/delete", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    const check = await checkCurrentPassword(id, req.body?.password);
    if (!check.record) return res.status(check.status).json({ error: check.error });

    await deleteUserById(id);
    clearSessionCookie(res);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Account] delete failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// DELETE user — admin only
app.delete("/api/users/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const session = (req as any).user;

  try {
    const deleted = await deleteUserById(id);
    if (!deleted) {
      return res.status(404).json({ error: "User not found." });
    }
    // Only clear the session cookie if the admin removed their own
    // account — removing someone else shouldn't log the admin out.
    if (session.id === id) {
      clearSessionCookie(res);
    }
    res.json({ success: true, message: "Member removed successfully." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST refresh individual user
app.post("/api/users/:id/refresh", refreshLimiter, async (req, res) => {
  const { id } = req.params;

  try {
    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    let scraped;
    let contest: ContestRating | null = null;
    let streaks: StreakInfo | null = null;
    try {
      [scraped, contest, streaks] = await Promise.all([
        scrapeLeetCodeProfile(user.leetcodeUsername),
        fetchContestRating(user.leetcodeUsername),
        fetchStreaks(user.leetcodeUsername, user.longestStreak)
      ]);
    } catch (err: any) {
      // Keep the user's existing stats untouched — don't fabricate anything.
      if (err instanceof LeetCodeUserNotFoundError) {
        await recordSyncResult(user.id, { ok: false, state: "not_found", error: err.message });
        return res.status(404).json({ error: err.message, user });
      }
      await recordSyncResult(user.id, { ok: false, state: "unavailable", error: err.message });
      return res.status(503).json({ error: err.message, user });
    }

    user.allTimeSolved = scraped.allTimeSolved;
    user.easySolved = scraped.easySolved;
    user.mediumSolved = scraped.mediumSolved;
    user.hardSolved = scraped.hardSolved;
    if (contest) {
      user.contestRating = contest.rating;
      user.contestsAttended = contest.attended;
    }
    if (streaks) {
      user.currentStreak = streaks.current;
      user.longestStreak = streaks.longest;
    }
    if (scraped.avatarUrl) {
      user.avatarUrl = scraped.avatarUrl;
    }

    // Derive weekly/monthly progress from our own history snapshots (taken
    // BEFORE we push today's record below), not from LeetCode's capped
    // recent-submissions endpoint.
    const weekly = computeWeeklyProgressFromHistory(user.history, scraped.allTimeSolved, Date.now(), baselineOf(user));
    const monthly = computeProgressFromHistory(user.history, scraped.allTimeSolved, 30, Date.now(), baselineOf(user));
    user.weeklyProgress = weekly ?? user.weeklyProgress;
    user.monthlyProgress = monthly ?? user.monthlyProgress;

    user.lastUpdated = new Date().toISOString();

    // Update historical logs
    const todayStr = new Date().toISOString().split("T")[0];
    const existingHistoryIndex = user.history.findIndex(h => h.date === todayStr);

    if (existingHistoryIndex !== -1) {
      user.history[existingHistoryIndex] = {
        date: todayStr,
        solvedCount: user.allTimeSolved,
        easy: user.easySolved,
        medium: user.mediumSolved,
        hard: user.hardSolved,
        weeklyProgress: user.weeklyProgress
      };
    } else {
      user.history.push({
        date: todayStr,
        solvedCount: user.allTimeSolved,
        easy: user.easySolved,
        medium: user.mediumSolved,
        hard: user.hardSolved,
        weeklyProgress: user.weeklyProgress
      });
      // Limit history to last 60 records to save space
      if (user.history.length > 60) {
        user.history.shift();
      }
    }

    await updateUser(user);
    await recordSyncResult(user.id, { ok: true });

    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// A board synced more recently than this is considered fresh. Matches the
// 30-minute background interval used on persistent hosts.
const AUTO_SYNC_STALE_MS = 1000 * 60 * 30;

// Time budget for one visit-triggered sync. Serverless functions have a hard
// execution limit, so a pass stops early and the next visit picks up the
// members that are still stale.
const AUTO_SYNC_BUDGET_MS = Number(process.env.SYNC_BUDGET_MS) || 8000;

interface SyncOptions {
  // Only refresh members not updated within this window, stalest first.
  onlyStaleMs?: number;
  // Stop starting new members once this much time has passed.
  budgetMs?: number;
}

// Refreshes tracked users' real stats. Shared by the manual "Force Sync All"
// route, the periodic background job and the visit-triggered sync — none of
// them invent numbers; all just call the same real fetch logic.
//
// `partial` is true when the time budget ran out before every stale member was
// handled. In that case lastSyncAll is NOT advanced, so the board still reads
// as stale and the next visit continues where this pass stopped.
async function syncAllUsers(
  opts: SyncOptions = {}
): Promise<{ users: User[]; lastSyncAll: string; partial: boolean }> {
  const users = await listUsers();

  let queue = users;
  if (opts.onlyStaleMs !== undefined) {
    const cutoff = Date.now() - opts.onlyStaleMs;
    queue = users
      .filter((u) => !(Date.parse(u.lastUpdated) > cutoff))
      .sort((a, b) => (Date.parse(a.lastUpdated) || 0) - (Date.parse(b.lastUpdated) || 0));
  }
  console.log(`[Sync All] Refreshing ${queue.length} of ${users.length} users.`);

  const startedAt = Date.now();
  let partial = false;

  for (const user of queue) {
    if (opts.budgetMs !== undefined && Date.now() - startedAt > opts.budgetMs) {
      partial = true;
      break;
    }
    try {
      const [scraped, contest, streaks] = await Promise.all([
        scrapeLeetCodeProfile(user.leetcodeUsername),
        fetchContestRating(user.leetcodeUsername),
        fetchStreaks(user.leetcodeUsername, user.longestStreak)
      ]);

      user.allTimeSolved = scraped.allTimeSolved;
      user.easySolved = scraped.easySolved;
      user.mediumSolved = scraped.mediumSolved;
      user.hardSolved = scraped.hardSolved;
      if (contest) {
        user.contestRating = contest.rating;
        user.contestsAttended = contest.attended;
      }
      if (streaks) {
        user.currentStreak = streaks.current;
        user.longestStreak = streaks.longest;
      }
      if (scraped.avatarUrl) {
        user.avatarUrl = scraped.avatarUrl;
      }

      const weekly = computeWeeklyProgressFromHistory(user.history, scraped.allTimeSolved, Date.now(), baselineOf(user));
      const monthly = computeProgressFromHistory(user.history, scraped.allTimeSolved, 30, Date.now(), baselineOf(user));
      user.weeklyProgress = weekly ?? user.weeklyProgress;
      user.monthlyProgress = monthly ?? user.monthlyProgress;

      user.lastUpdated = new Date().toISOString();

      // Add to history
      const todayStr = new Date().toISOString().split("T")[0];
      const histIndex = user.history.findIndex(h => h.date === todayStr);
      if (histIndex !== -1) {
        user.history[histIndex] = {
          date: todayStr,
          solvedCount: user.allTimeSolved,
          easy: user.easySolved,
          medium: user.mediumSolved,
          hard: user.hardSolved,
          weeklyProgress: user.weeklyProgress
        };
      } else {
        user.history.push({
          date: todayStr,
          solvedCount: user.allTimeSolved,
          easy: user.easySolved,
          medium: user.mediumSolved,
          hard: user.hardSolved,
          weeklyProgress: user.weeklyProgress
        });
        if (user.history.length > 60) {
          user.history.shift();
        }
      }

      await updateUser(user);
      await recordSyncResult(user.id, { ok: true });
    } catch (err: any) {
      // Leave this user's stats untouched for this cycle rather than
      // guessing — the next sync will pick them up again. The failure is
      // recorded so the admin dashboard can show who is stuck and why.
      console.warn(`[Sync All] Skipping ${user.leetcodeUsername}: ${err.message}`);
      await recordSyncResult(user.id, {
        ok: false,
        state: err instanceof LeetCodeUserNotFoundError ? "not_found" : "unavailable",
        error: err.message
      });
    }
  }

  let lastSyncAll = (await getMeta("lastSyncAll")) || "";
  if (!partial) {
    lastSyncAll = new Date().toISOString();
    await setMeta("lastSyncAll", lastSyncAll);
  }
  sortAndRankUsers(users);
  return { users, lastSyncAll, partial };
}

// POST sync-if-stale — called by the frontend whenever someone visits. This is
// what keeps the board fresh on Vercel, where there is no background job. Open
// to everyone because it only ever does the same real fetches a sync does, and
// only when the board is actually stale; fresh boards return immediately.
// A short-lived lock in the database stops simultaneous visitors (possibly on
// different serverless instances) from all scraping LeetCode at once.
app.post("/api/sync-if-stale", refreshLimiter, async (req, res) => {
  try {
    const lastSyncAll = (await getMeta("lastSyncAll")) || "";
    const age = Date.now() - Date.parse(lastSyncAll);
    if (lastSyncAll && Number.isFinite(age) && age < AUTO_SYNC_STALE_MS) {
      return res.json({ synced: false, partial: false, busy: false, lastSyncAll });
    }

    const lockUntil = Date.parse((await getMeta("autoSyncLockUntil")) || "");
    if (Number.isFinite(lockUntil) && lockUntil > Date.now()) {
      return res.json({ synced: false, partial: false, busy: true, lastSyncAll });
    }
    await setMeta("autoSyncLockUntil", new Date(Date.now() + AUTO_SYNC_BUDGET_MS + 20_000).toISOString());

    try {
      const result = await syncAllUsers({
        onlyStaleMs: AUTO_SYNC_STALE_MS,
        budgetMs: AUTO_SYNC_BUDGET_MS
      });
      res.json({
        synced: true,
        partial: result.partial,
        busy: false,
        lastSyncAll: result.lastSyncAll
      });
    } finally {
      await setMeta("autoSyncLockUntil", new Date(0).toISOString()).catch(() => {});
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET sync health for every member — admin only. Combines each member's last
// successful fetch (users.last_updated) with the outcome of the latest attempt
// (sync_status), so a member whose LeetCode account was removed or renamed
// shows up as "not_found" instead of just quietly going stale.
app.get("/api/admin/sync-status", requireAdmin, async (req, res) => {
  try {
    const [users, statuses, lastSyncAll] = await Promise.all([
      listUsers(),
      listSyncStatus(),
      getMeta("lastSyncAll")
    ]);

    const members: AdminSyncMember[] = users.map((u) => {
      const s = statuses.get(u.id);
      return {
        id: u.id,
        displayName: u.displayName,
        leetcodeUsername: u.leetcodeUsername,
        avatarUrl: u.avatarUrl,
        lastUpdated: u.lastUpdated,
        lastAttempt: s?.lastAttempt ?? null,
        state: s?.state ?? "unknown",
        error: s?.error ?? null,
        failures: s?.failures ?? 0,
        failingSince: s?.failingSince ?? null
      };
    });

    const report: AdminSyncReport = {
      generatedAt: new Date().toISOString(),
      lastSyncAll: lastSyncAll || "",
      members
    };
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST refresh all users — admin only
app.post("/api/refresh-all", refreshLimiter, requireAdmin, async (req, res) => {
  try {
    const result = await syncAllUsers();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET aggregated monthly trend metrics
app.get("/api/trends", async (req, res) => {
  try {
    const users = await listUsers();

    // Group growth: how many problems the roster has solved SINCE TRACKING
    // BEGAN, not the sum of everyone's lifetime totals. Each member is measured
    // against their own first snapshot, so a newly added member contributes 0
    // on the day they join and only their later solves count.
    const allDates = new Set<string>();
    users.forEach(u => u.history.forEach(h => allDates.add(h.date)));
    const sortedDates = [...allDates].sort();

    const perUser = users
      .map(u => {
        const history = [...u.history].sort((a, b) => a.date.localeCompare(b.date));
        // Measured from the total they joined with when their first snapshot is
        // from the joining day; otherwise from their oldest snapshot.
        const base =
          history.length > 0 && history[0].date === u.trackingStart ? u.baselineSolved : history[0]?.solvedCount ?? 0;
        return { history, base };
      })
      .filter(p => p.history.length > 0);

    const trendData = sortedDates.map(date => {
      let growth = 0;
      let activeUsers = 0;
      for (const p of perUser) {
        const first = p.history[0];
        if (date < first.date) continue; // not on the board yet
        // Latest snapshot at or before this date (carries over missed days).
        let latest = first;
        for (const h of p.history) {
          if (h.date <= date) latest = h;
          else break;
        }
        growth += Math.max(0, latest.solvedCount - p.base);
        activeUsers += 1;
      }
      return { date, solved: growth, activeUsers };
    });

    // Calculate dynamic difficulty totals
    let easyTotal = 0;
    let mediumTotal = 0;
    let hardTotal = 0;
    users.forEach(u => {
      easyTotal += u.easySolved;
      mediumTotal += u.mediumSolved;
      hardTotal += u.hardSolved;
    });

    // Top solver of the week
    let topSolver = "None";
    let topCount = 0;
    users.forEach(u => {
      if (u.weeklyProgress > topCount) {
        topCount = u.weeklyProgress;
        topSolver = u.displayName;
      }
    });

    res.json({
      historyTrend: trendData,
      difficultyBreakdown: [
        { name: "Easy", value: easyTotal, color: "#10b981" },
        { name: "Medium", value: mediumTotal, color: "#f59e0b" },
        { name: "Hard", value: hardTotal, color: "#ef4444" }
      ],
      topSolverThisWeek: topSolver,
      topSolverThisWeekCount: topCount,
      totalSolved: users.reduce((acc, u) => acc + u.allTimeSolved, 0)
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend assets in production and Vite dev server in development
async function startServer() {
  await dbReady;

  if (process.env.NODE_ENV !== "production") {
    // Dynamic import — kept out of the module's top-level static imports so
    // vite/rollup are never loaded at all on Vercel (this whole branch, and
    // even startServer() itself, never executes there). A static top-level
    // `import ... from "vite"` would run unconditionally on every cold
    // start regardless of this if-check, which was crashing every request.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Periodic background sync — only for traditional/persistent hosts. On
  // Vercel, VERCEL is set and this whole function isn't called at all, so
  // there is no background job there: the frontend instead calls
  // POST /api/sync-if-stale on every visit (and the admin "Sync all" button
  // still forces a full refresh).
  setInterval(() => {
    syncAllUsers()
      .then(({ users }) => {
        console.log(`[Background Sync] Refreshed ${users.length} users.`);
      })
      .catch((e) => {
        console.warn(`[Background Sync] Failed: ${e.message}`);
      });
  }, 1000 * 60 * 30);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  // Traditional host (Render/Railway/Fly/local dev/etc): run the app the
  // normal way — bind a port, serve static files ourselves, run the
  // background sync interval.
  startServer();
}

// Vercel Functions call the exported handler directly per-request instead
// of using app.listen() — this is what actually makes the app reachable
// when deployed there. Harmless to export on other hosts too; nothing
// imports it there.
export default app;