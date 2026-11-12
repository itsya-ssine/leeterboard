// Must stay the first import: it fixes NODE_ENV before the modules below read it (audit F3).
import "./runtimeEnv.js";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import "dotenv/config";
import { User, HistoryRecord, AdminSyncMember, AdminSyncReport, PlatformAccount, PlatformId } from "./src/types.js";
import { baselineNewMember, notifyNewAwards } from "./notifications.js";
import notificationRoutes from "./notificationRoutes.js";
import feedbackRoutes from "./feedbackRoutes.js";
import { assertMailConfigAtBoot, getMailer, MailError } from "./mailer.js";
import { assertOAuthDevAtBoot, exchangeAndFetchProfile, OAuthError } from "./oauthProviders.js";
import {
  buildAuthorizeUrl,
  checkEmailDomain,
  generatePkce,
  isOAuthProvider,
  newStateId,
  readOAuthConfig,
  stateMatches,
  type OAuthErrorCode
} from "./oauth.js";
import { checkEmail, maskEmail, parseAllowedDomains } from "./emails.js";
import { EMAIL_RATE_LIMITED_MESSAGE, refundEmailQuota, takeEmailQuota } from "./emailLimit.js";
import {
  addEmailCodeMail,
  alreadyRegisteredMail,
  codeMatches,
  emailInUseMail,
  passwordChangedMail,
  passwordResetCodeMail,
  resetPasswordRejectedMail,
  EMAIL_CODE_TTL_MINUTES,
  generateCode,
  hashCode,
  parseCodeInput,
  signupCodeMail
} from "./emailCodes.js";
import { computeWeeklyWinners, mergeWinnerArchive, parseWinnerArchive, type WeeklyWinner } from "./src/winners.js";
import { DAY_SECONDS, type StreakInfo, parseSubmissionCalendar, streaksFromDays } from "./streaks.js";
import {
  initDb,
  listUsers,
  getUserById,
  getUserAuthByLoginUsername,
  getLinkedHandle,
  findLeetcodeOwner,
  leetcodeLinkedUsers,
  linkLeetcodeAccount,
  unlinkLeetcodeAccount,
  getResetFreeze,
  createSecurityNotice,
  createPendingReset,
  getPendingReset,
  bumpPendingResetAttempts,
  deletePendingReset,
  consumePendingReset,
  deletePendingResetsFor,
  purgeExpiredPendingResets,
  startPendingEmailCode,
  getPendingEmailCode,
  getPendingEmailCodeForUser,
  deletePendingEmailCodesForUser,
  getUserEmail,
  getUserByEmail,
  setUserEmail,
  bumpPendingEmailAttempts,
  consumePendingEmailCode,
  deletePendingEmailCode,
  deleteExpiredPendingEmailCodes,
  emailTaken,
  insertUser,
  updateUser,
  deleteUserById,
  updateDisplayName,
  updateSchool,
  updateProfileDetails,
  type ProfileDetailsUpdate,
  getUserAuthById,
  createOAuthState,
  consumeOAuthState,
  deleteExpiredOAuthRows,
  getUserIdByOAuthIdentity,
  createPendingOAuthSignup,
  getPendingOAuthSignup,
  consumePendingOAuthSignup,
  insertUserWithIdentity,
  setPasswordHash,
  recordFailedLogin,
  clearFailedLogins,
  consumePendingLink,
  getMeta,
  setMeta,
  recordSyncResult,
  listSyncStatus,
  loadPlatformsByUser,
  getPlatformAccounts,
  createPendingLink,
  getPendingLink,
  bumpPendingLinkAttempts,
  deletePendingLink,
  purgeExpiredPendingLinks,
  findPlatformAccountOwner,
  insertPlatformAccount,
  removePlatformAccount,
  setPlatformHidden,
  setHideLeetcodeStats,
  type UserWithAuth,
  type RecoveryPlatform,
  type ResetFreezeReason
} from "./db.js";
import {
  SESSION_REQUIRED_BODY,
  SESSION_REQUIRED_CODE,
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
import { syncAllPlatformAccounts, syncPlatformAccount, syncPlatformAccountsForUser } from "./platformSync.js";
import { PLATFORMS, isPlatformId, type PlatformInfo } from "./platforms/registry.js";
import { PlatformNotFoundError } from "./platforms/common.js";
import { buildPlatformTrend } from "./platformTrends.js";
import { csrfProtection } from "./csrf.js";
import { checkUsername } from "./usernames.js";
import { securityHeaders } from "./securityHeaders.js";
import { logSecurityEvent } from "./securityLog.js";
import { findServerCode } from "./runtimeEnvPolicy.js";
import { apiLimiter, pageLimiter, loginLimiter, registerLimiter, resetLimiter, verifyLimiter, accountLimiter, refreshLimiter, oauthLimiter } from "./rateLimit.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// How many reverse proxies sit in front of the app. The rate limiters key on
// req.ip, so this must match the real topology: too low and every visitor
// shares the proxy's address; too high and a client can spoof its IP through
// X-Forwarded-For and dodge the limits. Vercel, Render, Railway and Fly each
// put exactly one proxy in front, so production defaults to 1; local
// development has none. Override with TRUST_PROXY_HOPS if you add a CDN.
const TRUST_PROXY_HOPS = (() => {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw !== undefined && raw !== "") {
    const hops = Number(raw);
    if (Number.isInteger(hops) && hops >= 0 && hops <= 5) return hops;
    console.warn(`[Config] Ignoring invalid TRUST_PROXY_HOPS "${raw}" (use a whole number from 0 to 5).`);
  }
  return process.env.VERCEL || process.env.NODE_ENV === "production" ? 1 : 0;
})();
app.set("trust proxy", TRUST_PROXY_HOPS);
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

// Security headers (CSP, HSTS, framing, MIME sniffing, permissions) and
// no-store caching for every /api response — see securityHeaders.ts. The same
// set is mirrored in vercel.json for the statically served frontend.
app.use(securityHeaders);

// Reject cross-site / non-JSON state-changing requests before anything parses
// a body or touches the database (see csrf.ts).
app.use("/api", csrfProtection);

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
// Say loudly, once, if e-mail isn't usable (sign-up then answers 503), and stop
// if the development-only outbox provider is configured in production.
assertMailConfigAtBoot();
// Stop if the development-only OAUTH_DEV_PROVIDER_URL is set in production (sign-in with
// Google / GitHub would then send the client secret to that address).
const oauthDev = assertOAuthDevAtBoot();
// Which providers are usable (id AND secret set, PUBLIC_URL valid). A bad setting
// switches sign-in with that provider off instead of stopping the server, so
// password login keeps working. Problems name variables, never values.
const oauthConfig = readOAuthConfig(process.env);
for (const problem of oauthConfig.problems) console.warn(`[OAuth] ${problem}`);

const dbReady = initDb();
app.use((req, res, next) => {
  dbReady.then(() => next()).catch(next);
});

// Utility to calculate ranks and progress metrics
function sortAndRankUsers(users: User[]) {
  // The ranking is the LeetCode board, so only members with a LeetCode account
  // take part: they come first, by Weekly Progress (to encourage active, weekly
  // problem solving momentum!) and, in case of a tie, by All-Time solved counts.
  // Members without LeetCode follow, unranked (rank 0) and never ahead of
  // anyone, not even a linked member who has solved nothing yet.
  users.sort((a, b) => {
    if (a.leetcodeLinked !== b.leetcodeLinked) return a.leetcodeLinked ? -1 : 1;
    if (b.weeklyProgress !== a.weeklyProgress) {
      return b.weeklyProgress - a.weeklyProgress;
    }
    return b.allTimeSolved - a.allTimeSolved;
  });

  let rank = 0;
  for (const u of users) {
    u.rank = u.leetcodeLinked ? ++rank : 0;
  }
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

// Tells members about any badge or weekly win they have earned since the last
// check. A notification problem is logged and swallowed: it must never fail
// (or even slow down the error path of) a sync or a sign-up.
async function checkNewAwards(users?: User[]): Promise<void> {
  try {
    // Group badges depend on everyone on the LeetCode board, so look at all of
    // it. A member without LeetCode has no LeetCode badges to earn or compare.
    const board = users ?? (await listUsers());
    await notifyNewAwards(leetcodeLinkedUsers(board), await resolveWinners(board));
  } catch (err: any) {
    console.warn(`[Notifications] Award check failed: ${err.message}`);
  }
}

async function resolveWinners(users: User[]): Promise<WeeklyWinner[]> {
  // Nothing to compare (or a read that came back empty by mistake): don't
  // touch the stored archive.
  if (users.length === 0) return [];
  try {
    const stored = parseWinnerArchive(await getMeta(WINNERS_META_KEY));
    const merged = mergeWinnerArchive(stored, computeWeeklyWinners(leetcodeLinkedUsers(users), Date.now()));
    // Members who left the site take their wins with them. (Everyone counts
    // here, not only members with LeetCode: unlinking LeetCode isn't leaving.)
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

/* ---------- Hidden platform stats ---------- */
//
// A member can hide a linked platform (Codeforces / CodinGame) on their
// PROFILE. The leaderboard and the global stats still use the account as usual.
// The profile-only detail (the per-day progress series) is removed from what
// other members receive, so it can't be read from the network tab either; the
// member and admins get everything. The flag itself (hidden: true) stays, which
// is how the profile page knows to show nothing.

interface Viewer {
  id: string | null;
  isAdmin: boolean;
}

async function viewerOf(req: express.Request): Promise<Viewer> {
  try {
    const session = await resolveSession(req);
    return session ? { id: session.user.id, isAdmin: session.isAdmin } : { id: null, isAdmin: false };
  } catch {
    return { id: null, isAdmin: false };
  }
}

function withVisiblePlatforms<T extends { id: string; platforms?: Partial<Record<PlatformId, PlatformAccount>> }>(
  user: T,
  viewer: Viewer
): T {
  if (!user.platforms || viewer.isAdmin || user.id === viewer.id) return user;
  const platforms: Partial<Record<PlatformId, PlatformAccount>> = {};
  for (const [id, account] of Object.entries(user.platforms) as [PlatformId, PlatformAccount][]) {
    if (!account.hidden) {
      platforms[id] = account;
      continue;
    }
    // Keep what the leaderboard draws (difficulty buckets); drop the daily series.
    const { daily: _daily, ...rest } = account.extra as Record<string, unknown>;
    platforms[id] = { ...account, extra: rest };
  }
  return { ...user, platforms };
}

// GET all users (with automatic ranking update). Members only: the board is
// not public, so there is always a signed-in viewer here.
app.get("/api/users", requireAuth, async (req, res) => {
  try {
    const { id, isAdmin } = (req as any).user as { id: string; isAdmin: boolean };
    const viewer: Viewer = { id, isAdmin };
    res.vary("Cookie"); // the answer depends on who is asking
    const users = (await listUsers()).map((u) => withVisiblePlatforms(u, viewer));
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
// Accounts are keyed by a username the member picks and protected by a password
// chosen on this site (never a LeetCode password; we never ask for that).
//
// A LeetCode account is optional and is linked afterwards. Because anyone could
// type any LeetCode username, linking one requires proof that the profile is
// yours: the server hands out a random code, you paste it into your LeetCode
// profile "Summary", and the server reads the public profile back to check it.
// Nobody else can edit your profile, so nobody else can pass the check.

const LEETCODE_USERNAME_RE = /^[A-Za-z0-9_.-]{1,50}$/;
const MAX_DISPLAY_NAME_LENGTH = 40;
const MAX_SCHOOL_LENGTH = 60;
const MAX_BIO_LENGTH = 200;
const MAX_LINK_LENGTH = 200;

const MAX_VERIFY_ATTEMPTS = 10; // wrong guesses allowed on one proof code before it is thrown away

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

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

// The school is optional, so an empty result is valid (it clears the field).
function cleanSchool(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SCHOOL_LENGTH);
}

// A short free-text bio. Newlines are kept (at most one blank line in a row);
// everything else that isn't printable is dropped. Empty clears it.
function cleanBio(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_BIO_LENGTH);
}

// A profile link. Accepts "github.com/me" or a full URL, and only ever stores an
// http(s) address (never javascript:, data: and the like), so it is safe to put
// in an href. `hosts` limits it to certain sites (a host also matches its
// subdomains); null allows any site that looks like a real domain.
// An empty value is valid and clears the link.
function cleanLink(value: string, label: string, hosts: string[] | null): { value: string } | { error: string } {
  const trimmed = value.replace(/[\u0000-\u001f\u007f\s]/g, "");
  if (!trimmed) return { value: "" };
  if (trimmed.length > MAX_LINK_LENGTH) return { error: `${label} link is too long.` };

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: `${label} link isn't a valid web address.` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: `${label} link must start with https://.` };
  }
  if (url.username || url.password) {
    return { error: `${label} link can't contain a username or password.` };
  }
  const host = url.hostname.toLowerCase();
  if (hosts) {
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return { error: `${label} link must be a ${hosts[0]} address.` };
    }
    url.protocol = "https:";
  } else if (!host.includes(".") || /^[\d.]+$/.test(host)) {
    return { error: `${label} link must be a website address like example.com.` };
  }
  return { value: url.href.slice(0, MAX_LINK_LENGTH) };
}

const LINK_FIELDS = [
  { body: "github", key: "githubUrl", label: "GitHub", hosts: ["github.com"] },
  { body: "linkedin", key: "linkedinUrl", label: "LinkedIn", hosts: ["linkedin.com"] },
  { body: "website", key: "websiteUrl", label: "Website", hosts: null }
] as const;

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
// username. This is the ONLY thing that proves someone owns a LeetCode account
// (needed to link it), so it must come from LeetCode itself.
//
// SECURITY: never add a third-party fallback here (proxies, mirrors, caches).
// Whoever controls that source could attest "this summary contains your code"
// for any username and take over any account. If LeetCode doesn't answer we
// fail closed: "unavailable" (callers return 503 and the user retries).
// "not_found" is only reported when LeetCode positively says the user
// doesn't exist.
async function fetchLeetCodeAbout(username: string): Promise<AboutLookup> {
  let notFound = false;

  // Official LeetCode GraphQL endpoint (the only trusted source)
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

  return notFound ? { status: "not_found" } : { status: "unavailable" };
}

const LEETCODE_UNAVAILABLE_MESSAGE =
  "Couldn't reach LeetCode right now. Please try again in a moment.";

// POST — sign-up, step 1 of 2: choose a username, a password and an e-mail
// address, and have a 6-digit code mailed to the address. NOTHING is created
// here but a pending request: the account exists only once /register/verify
// accepts the code. The username, display name and the already-hashed password
// wait in pending_email_codes; the browser holds only the random id of that row,
// in an httpOnly cookie (the same binding the password reset uses).
//
// Anti-enumeration. Whether or not the address already has an account, this
// answers the same way: the same status, the same body shape, the same cookie
// and the same 60-second resend rule, with one mail sent either way (a code, or
// a notice that the address is already registered). It does the same work too,
// so response time says nothing. To keep the NEXT step from giving it away, an
// already-registered address also gets a pending row, with a code that was
// generated but never sent to anyone: verifying against it fails exactly like a
// wrong guess, and can't succeed. A taken USERNAME is still a plain 409, since
// usernames are public on profiles.
const SIGNUP_COOKIE = "signup";
const SIGNUP_TTL_MS = EMAIL_CODE_TTL_MINUTES * 60_000;
const SIGNUP_RESEND_COOLDOWN_MS = 60_000;
const signupCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth"
};
const SIGNUP_UNAVAILABLE_MESSAGE = "Sign-up is temporarily unavailable. Please try again later.";
const SIGNUP_RESEND_WAIT_MESSAGE = "Wait a minute before asking for another code.";
const SIGNUP_MAIL_FAILED_MESSAGE = "We couldn't send the email right now. Please try again in a few minutes.";
// Optional: only addresses at these domains may sign up. Empty = any domain.
const ALLOWED_EMAIL_DOMAINS = parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS);
if (ALLOWED_EMAIL_DOMAINS.length > 0) {
  console.info(`[Config] Sign-up is limited to email addresses at: ${ALLOWED_EMAIL_DOMAINS.join(", ")}`);
}

app.post("/api/auth/register/start", registerLimiter, async (req, res) => {
  try {
    // Without a working mail provider nobody could verify, so don't take sign-ups.
    const mailer = getMailer();
    if (!mailer) {
      logSecurityEvent("mail_unconfigured", { ip: req.ip, route: "register/start" });
      return res.status(503).json({ error: SIGNUP_UNAVAILABLE_MESSAGE });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    const check = checkUsername(body.username);
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }
    const username = check.username;

    const passwordError = validatePassword(body.password, username);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const emailCheck = checkEmail(body.email, ALLOWED_EMAIL_DOMAINS);
    if (!emailCheck.ok) {
      return res.status(400).json({ error: emailCheck.error });
    }
    const email = emailCheck.email;
    const maskedEmail = maskEmail(email);

    // Look before hashing, so a taken name costs nothing. The unique index on
    // login_username is what actually decides (see /register/verify).
    if (await getUserAuthByLoginUsername(username)) {
      return res.status(409).json({ error: "That username is taken." });
    }

    // At most 3 codes an hour to one address, however many IPs ask. Counted
    // before anything else is looked at, and the same for a registered address.
    const quota = await takeEmailQuota("signup", email);
    if (!quota.allowed) {
      logSecurityEvent("email_rate_limited", { ip: req.ip, maskedEmail, purpose: "signup" });
      return res.status(429).json({ error: EMAIL_RATE_LIMITED_MESSAGE });
    }

    // From here on both outcomes do the same work, in the same order.
    const passwordHash = await hashPassword(body.password as string);
    const now = new Date();
    await deleteExpiredPendingEmailCodes(now.toISOString());
    const registered = await emailTaken(email);

    const id = crypto.randomBytes(32).toString("hex");
    const code = generateCode(); // for an already-registered address it is never sent
    const started = await startPendingEmailCode(
      {
        id,
        purpose: "signup",
        email,
        userId: null,
        username,
        displayName: cleanDisplayName(body.displayName, username),
        passwordHash,
        codeHash: hashCode(id, code),
        createdAt: now.toISOString(),
        lastSentAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SIGNUP_TTL_MS).toISOString()
      },
      SIGNUP_RESEND_COOLDOWN_MS
    );
    if (!started) {
      await refundEmailQuota("signup", quota); // nothing was sent: an early Resend click costs nothing
      return res.status(429).json({ error: SIGNUP_RESEND_WAIT_MESSAGE });
    }

    try {
      await mailer.send({ to: email, ...(registered ? alreadyRegisteredMail() : signupCodeMail(code)) });
    } catch (err) {
      // Nothing reached the address, so don't leave a request that makes the
      // person wait out the resend delay for a mail that never left.
      await deletePendingEmailCode(id);
      await refundEmailQuota("signup", quota); // nothing reached the address
      logSecurityEvent("mail_send_failed", {
        ip: req.ip,
        route: "register/start",
        provider: mailer.provider,
        kind: err instanceof MailError ? err.kind : "unknown",
        status: err instanceof MailError ? err.status : undefined
      });
      return res.status(503).json({ error: SIGNUP_MAIL_FAILED_MESSAGE });
    }

    logSecurityEvent(registered ? "signup_notice_sent" : "signup_code_sent", { ip: req.ip, maskedEmail }, "info");
    res.cookie(SIGNUP_COOKIE, id, { ...signupCookieOptions, maxAge: SIGNUP_TTL_MS });
    res.json({ expiresInMinutes: EMAIL_CODE_TTL_MINUTES, maskedEmail });
  } catch (error: any) {
    console.error(`[Auth] sign-up start failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — sign-up, step 2 of 2: the 6-digit code from the mail. The pending id
// comes from the httpOnly "signup" cookie set by /register/start, never from the
// body, so a code typed by someone else's browser verifies nothing. The account
// is created here and only here, with the e-mail address already verified, no
// LeetCode (a member links LeetCode and the other platforms afterwards from
// their account settings) and the password hash that was made at the start.
//
// Guessing is capped at MAX_EMAIL_CODE_ATTEMPTS tries per pending request. Every
// try is counted BEFORE the code is looked at, in one atomic statement, so a
// burst of parallel guesses can't exceed the cap: at most five of them are ever
// compared. The fifth wrong one deletes the request, and a right code after
// that finds nothing. A request for an address that was already registered holds
// a code nobody received, so it fails exactly like a wrong guess.
const MAX_EMAIL_CODE_ATTEMPTS = 5;
const SIGNUP_EXPIRED_MESSAGE = "This sign-up has expired. Please start again.";
const SIGNUP_WRONG_CODE_MESSAGE = "That code isn't right. Check it and try again.";
const SIGNUP_LOCKED_MESSAGE = "Too many wrong codes. Please start again.";

app.post("/api/auth/register/verify", verifyLimiter, async (req, res) => {
  try {
    const expired = async (pendingId?: string) => {
      if (pendingId) await deletePendingEmailCode(pendingId);
      res.clearCookie(SIGNUP_COOKIE, signupCookieOptions);
      return res.status(400).json({ error: SIGNUP_EXPIRED_MESSAGE, expired: true });
    };

    const cookieValue = req.cookies?.[SIGNUP_COOKIE];
    const pending =
      typeof cookieValue === "string" && /^[a-f0-9]{64}$/.test(cookieValue) ? await getPendingEmailCode(cookieValue) : null;
    if (!pending || pending.purpose !== "signup" || !pending.username || !pending.passwordHash) {
      return expired();
    }
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      return expired(pending.id);
    }

    const maskedEmail = maskEmail(pending.email);
    const code = parseCodeInput((req.body as Record<string, unknown> | undefined)?.code);

    // Count this try first (atomically), then judge it.
    const attempts = await bumpPendingEmailAttempts(pending.id);
    if (attempts === null) {
      return expired(); // the request vanished under us (used, replaced or pruned)
    }
    const right = code !== null && codeMatches(pending.id, code, pending.codeHash);
    if (!right || attempts > MAX_EMAIL_CODE_ATTEMPTS) {
      if (attempts >= MAX_EMAIL_CODE_ATTEMPTS) {
        await deletePendingEmailCode(pending.id);
        res.clearCookie(SIGNUP_COOKIE, signupCookieOptions);
        logSecurityEvent("signup_code_locked", { ip: req.ip, maskedEmail, attempts }, "warn");
        return res.status(429).json({ error: SIGNUP_LOCKED_MESSAGE, expired: true });
      }
      logSecurityEvent("signup_code_failed", { ip: req.ip, maskedEmail, attempts }, "warn");
      return res.status(400).json({ error: SIGNUP_WRONG_CODE_MESSAGE });
    }

    // The right code. Someone may have registered this address since the
    // request began (or it is one that was registered all along and the code
    // was guessed): don't say so, just end the request like an expired one.
    if (await emailTaken(pending.email)) {
      return expired(pending.id);
    }

    // Take the request atomically, so of two simultaneous verifications with the
    // right code exactly one gets it and creates the account.
    const taken = await consumePendingEmailCode(pending.id, new Date().toISOString());
    if (!taken || !taken.username || !taken.passwordHash) {
      return expired();
    }

    // A new member has no LeetCode data: no solved counts, no history, no
    // baseline. All of that starts when they link LeetCode.
    const username = taken.username;
    const user: User = {
      id: `user-${crypto.randomUUID()}`,
      displayName: taken.displayName || username,
      loginUsername: username,
      leetcodeLinked: false,
      leetcodeUsername: "",
      avatarUrl: defaultAvatar(username),
      school: "",
      bio: "",
      githubUrl: "",
      linkedinUrl: "",
      websiteUrl: "",
      allTimeSolved: 0,
      easySolved: 0,
      mediumSolved: 0,
      hardSolved: 0,
      contestRating: null,
      contestsAttended: 0,
      currentStreak: null,
      longestStreak: null,
      weeklyProgress: 0,
      monthlyProgress: 0,
      rank: 0,
      lastUpdated: null,
      trackingStart: "",
      baselineSolved: 0,
      history: []
    };
    try {
      await insertUser(user, taken.passwordHash, { loginUsername: username, email: taken.email });
    } catch (error: any) {
      if (!String(error?.message).includes("UNIQUE")) throw error;
      res.clearCookie(SIGNUP_COOKIE, signupCookieOptions);
      // The unique indexes decide. A taken NAME is public (it is on profiles), so
      // say so; a taken ADDRESS is not, so it ends like an expired request.
      if (await getUserAuthByLoginUsername(username)) {
        return res.status(409).json({ error: "That username was just taken. Please start again with another one." });
      }
      return res.status(400).json({ error: SIGNUP_EXPIRED_MESSAGE, expired: true });
    }

    logSecurityEvent("account_created", { ip: req.ip, userId: user.id, username, maskedEmail }, "info");
    res.clearCookie(SIGNUP_COOKIE, signupCookieOptions);
    setSessionCookie(res, user, taken.passwordHash);
    res.status(201).json({ ...user, isAdmin: isAdminUser(user) });
  } catch (error: any) {
    console.error(`[Auth] sign-up verify failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — forgot password, step 1. Someone who can't sign in can still prove they
// own an account the member linked (LeetCode, Codeforces or CodinGame) by putting
// a one-time code in that account's public profile. They choose the new password
// now; it is hashed and held server-side, so nothing secret is sent again. A
// member with nothing linked can't do this: they change their password from
// their account settings (which asks for the old one), or an admin removes the
// account and they sign up again.
//
// Never allowed through here, for any reason the response won't reveal:
//   - admin accounts (recovered with `npm run admin`),
//   - an account whose linked name stopped resolving (it may now belong to
//     someone else; an admin lifts that with `npm run admin -- approve-reset`),
//   - an unknown username, or a platform the member hasn't linked.
const RESET_COOKIE = "pwreset";
const RESET_TTL_MS = 30 * 60 * 1000;
const resetCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth"
};
const RESET_PLATFORMS: readonly RecoveryPlatform[] = ["leetcode", "codeforces", "codingame"];
const RESET_PLATFORM_LABELS: Record<RecoveryPlatform, string> = {
  leetcode: "LeetCode",
  codeforces: "Codeforces",
  codingame: "CodinGame"
};
const LEETCODE_PROOF_HELP =
  "On LeetCode open your profile, click Edit Profile, paste the code into the Summary field and save. Then press Verify. You can remove the code afterward.";

// The same answer for every reason a reset can't go ahead, so it doesn't reveal
// which usernames exist, which are admins, or which are frozen.
const RESET_BLOCKED_MESSAGE =
  "This password can't be reset online. If you remember your current password, sign in and change it in your account settings. " +
  "Otherwise create a new account with a different username, or ask an admin to remove the old one.";

type ResetEligibility = { ok: true; handle: string } | { ok: false; reason: "admin" | "not_linked" | ResetFreezeReason };

async function resetEligibility(user: { id: string; leetcodeUsername: string }, platform: RecoveryPlatform): Promise<ResetEligibility> {
  if (isAdminUser(user)) return { ok: false, reason: "admin" };
  const handle = await getLinkedHandle(user.id, platform);
  if (!handle) return { ok: false, reason: "not_linked" };
  const freeze = await getResetFreeze(user.id, platform);
  return freeze ? { ok: false, reason: freeze } : { ok: true, handle };
}

app.post("/api/auth/reset/start", resetLimiter, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!username || username.length > 100) {
      return res.status(400).json({ error: "Enter your username." });
    }
    const platform = RESET_PLATFORMS.find((p) => p === body.platform);
    if (!platform) {
      return res.status(400).json({ error: "Choose the account you linked: LeetCode, Codeforces or CodinGame." });
    }
    const passwordError = validatePassword(body.password, username);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    // Hash before looking anyone up, so a refusal takes as long as an
    // acceptance and response time doesn't say which usernames can be reset.
    const passwordHash = await hashPassword(body.password as string);

    const record = await getUserAuthByLoginUsername(username);
    const eligibility = record ? await resetEligibility(record.user, platform) : null;
    if (!record || !eligibility || !eligibility.ok) {
      logSecurityEvent("ownership_blocked", {
        ip: req.ip,
        userId: record?.user.id,
        username,
        platform,
        reason: eligibility && !eligibility.ok ? eligibility.reason : "unknown_user",
        stage: "start"
      });
      return res.status(403).json({ error: RESET_BLOCKED_MESSAGE });
    }

    await purgeExpiredPendingResets(new Date().toISOString());
    const id = crypto.randomBytes(32).toString("hex");
    const code = `leeterboard-${crypto.randomBytes(6).toString("hex")}`;
    await createPendingReset({
      id,
      userId: record.user.id,
      platform,
      handle: eligibility.handle,
      passwordHash,
      code,
      expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString()
    });

    logSecurityEvent("ownership_started", { ip: req.ip, userId: record.user.id, platform, purpose: "reset" }, "info");
    res.cookie(RESET_COOKIE, id, { ...resetCookieOptions, maxAge: RESET_TTL_MS });
    res.json({
      code,
      platform,
      instructions: platform === "leetcode" ? LEETCODE_PROOF_HELP : PLATFORMS[platform].proofHelp,
      expiresInMinutes: RESET_TTL_MS / 60_000
    });
  } catch (error: any) {
    console.error(`[Auth] reset start failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — forgot password, step 2. Reads the linked account's public profile and,
// if the code is there, sets the new password, signs the person in, signs out
// everyone else and leaves the owner a notice.
app.post("/api/auth/reset/verify", verifyLimiter, async (req, res) => {
  try {
    const cookieValue = req.cookies?.[RESET_COOKIE];
    const pending =
      typeof cookieValue === "string" && /^[a-f0-9]{64}$/.test(cookieValue) ? await getPendingReset(cookieValue) : null;
    if (!pending || Date.parse(pending.expiresAt) < Date.now()) {
      if (pending) await deletePendingReset(pending.id);
      res.clearCookie(RESET_COOKIE, resetCookieOptions);
      return res.status(400).json({ error: "This reset request has expired. Please start again.", expired: true });
    }
    if (pending.attempts >= MAX_VERIFY_ATTEMPTS) {
      await deletePendingReset(pending.id);
      res.clearCookie(RESET_COOKIE, resetCookieOptions);
      return res.status(429).json({ error: "Too many failed checks. Please start again.", expired: true });
    }

    // Things can change between the two steps: check again.
    const user = await getUserById(pending.userId);
    const eligibility = user ? await resetEligibility(user, pending.platform) : null;
    if (!user || !eligibility || !eligibility.ok || eligibility.handle.toLowerCase() !== pending.handle.toLowerCase()) {
      await deletePendingReset(pending.id);
      res.clearCookie(RESET_COOKIE, resetCookieOptions);
      logSecurityEvent("ownership_blocked", {
        ip: req.ip,
        userId: pending.userId,
        platform: pending.platform,
        reason: eligibility && !eligibility.ok ? eligibility.reason : "changed",
        stage: "verify"
      });
      return res.status(403).json({ error: RESET_BLOCKED_MESSAGE });
    }

    // Read the public profile of the account the MEMBER linked, never one the
    // requester names.
    const label = RESET_PLATFORM_LABELS[pending.platform];
    let texts: string[];
    if (pending.platform === "leetcode") {
      const lookup = await fetchLeetCodeAbout(pending.handle);
      if (lookup.status === "unavailable") {
        logSecurityEvent("ownership_lookup_unavailable", { ip: req.ip, userId: user.id, platform: "leetcode", purpose: "reset" });
        return res.status(503).json({ error: LEETCODE_UNAVAILABLE_MESSAGE });
      }
      if (lookup.status === "not_found") {
        await deletePendingReset(pending.id);
        logSecurityEvent("ownership_blocked", { ip: req.ip, userId: user.id, platform: "leetcode", reason: "name_not_found", stage: "verify" });
        return res.status(404).json({ error: `That ${label} account no longer exists, so it can't be used to reset this password.` });
      }
      texts = [lookup.aboutMe];
    } else {
      try {
        texts = (await PLATFORMS[pending.platform].fetchProfile!(pending.handle)).texts;
      } catch (err: any) {
        if (err instanceof PlatformNotFoundError) {
          await deletePendingReset(pending.id);
          logSecurityEvent("ownership_blocked", { ip: req.ip, userId: user.id, platform: pending.platform, reason: "name_not_found", stage: "verify" });
          return res.status(404).json({ error: `That ${label} account no longer exists, so it can't be used to reset this password.` });
        }
        logSecurityEvent("ownership_lookup_unavailable", { ip: req.ip, userId: user.id, platform: pending.platform, purpose: "reset" });
        return res.status(503).json({ error: err.message });
      }
    }

    const needle = pending.code.toLowerCase();
    if (!texts.some((t) => t.toLowerCase().includes(needle))) {
      await bumpPendingResetAttempts(pending.id);
      logSecurityEvent("ownership_failed", {
        ip: req.ip,
        userId: user.id,
        platform: pending.platform,
        purpose: "reset",
        attempts: pending.attempts + 1
      });
      return res.status(400).json({
        error: `We couldn't find the code on your ${label} profile yet. Save it there, wait a few seconds, then try again.`
      });
    }

    // Ownership proven. Take the challenge atomically so it can't be replayed
    // or used by two concurrent requests.
    if (!(await consumePendingReset(pending.id))) {
      logSecurityEvent("ownership_failed", { ip: req.ip, userId: user.id, platform: pending.platform, purpose: "reset", reason: "replay" });
      return res.status(400).json({ error: "This reset request was already used or has expired. Please start again.", expired: true });
    }

    const hadPassword = isPasswordHash((await getUserAuthById(user.id))?.auth.passwordHash);
    // New hash = every older session is signed out, and any lockout is cleared.
    await setPasswordHash(user.id, pending.passwordHash);
    await deletePendingResetsFor(user.id);
    await createSecurityNotice(
      user.id,
      "Your password was reset",
      `Someone proved they own your ${label} account "${pending.handle}" and used it to set a new password. ` +
        "If that was you, nothing more to do. If it wasn't, change your password in your account settings and ask an admin for help."
    );
    logSecurityEvent("ownership_verified", { ip: req.ip, userId: user.id, platform: pending.platform, purpose: "reset" }, "info");
    logSecurityEvent(
      "password_reset_via_ownership",
      { ip: req.ip, userId: user.id, platform: pending.platform, handle: pending.handle, hadPassword },
      hadPassword ? "warn" : "info"
    );

    res.clearCookie(RESET_COOKIE, resetCookieOptions);
    setSessionCookie(res, user, pending.passwordHash);
    res.json({ ...user, isAdmin: isAdminUser(user) });
  } catch (error: any) {
    console.error(`[Auth] reset verify failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — forgot password by e-mailed code, step 1. Public. Body { email,
// newPassword }. The person chooses the new password now; it is hashed and held
// server-side until the code is entered, like the platform-proof reset above.
//
// ALWAYS answers the same (200, same body, same cookie) whether or not the
// address belongs to a member, so it can't be used to find out who has an
// account or which addresses members use. A code is only mailed when the
// address is a member's VERIFIED one and that member may reset by e-mail. Not
// allowed, and silent about it: an unknown address, an address nobody verified,
// and admin accounts (recovered with `npm run admin`, like the platform-proof
// reset). A pending request is stored for those too, holding a code nobody
// received, so the verify step can't tell them apart either.
//
// Known limit: the mail is sent before answering, so an address with no account
// answers a little faster than one with an account (nothing to send). The
// per-IP (resetLimiter) and per-address limits slow anyone measuring that.
const RESET_EMAIL_COOKIE = "pwresetmail";
const RESET_EMAIL_NEUTRAL_MESSAGE = "If that address has an account, we sent a code.";
const RESET_EMAIL_EXPIRED_MESSAGE = "This reset request has expired. Please start again.";
const RESET_EMAIL_WRONG_CODE_MESSAGE = "That code isn't right. Check it and try again.";
const RESET_EMAIL_LOCKED_MESSAGE = "Too many wrong codes. Please start again.";

app.post("/api/auth/reset/email/start", resetLimiter, async (req, res) => {
  try {
    const mailer = getMailer();
    if (!mailer) {
      logSecurityEvent("mail_unconfigured", { ip: req.ip, route: "reset/email/start" });
      return res.status(503).json({ error: "Password reset by email isn't available right now. Please try again later." });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    // Any domain: an address a member verified earlier stays usable if the
    // sign-up allow-list changes afterwards.
    const emailCheck = checkEmail(body.email);
    if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });
    const passwordError = validatePassword(body.newPassword, "");
    if (passwordError) return res.status(400).json({ error: passwordError });
    const email = emailCheck.email;
    const maskedEmail = maskEmail(email);

    // Hash before looking anyone up, so a refusal costs what an acceptance does.
    const passwordHash = await hashPassword(body.newPassword as string);

    const quota = await takeEmailQuota("reset", email);
    if (!quota.allowed) {
      logSecurityEvent("email_rate_limited", { ip: req.ip, maskedEmail, purpose: "reset" });
      return res.status(429).json({ error: EMAIL_RATE_LIMITED_MESSAGE });
    }

    const now = new Date();
    await deleteExpiredPendingEmailCodes(now.toISOString());
    const found = await getUserByEmail(email);
    const blockedReason = !found ? "unknown_email" : !found.emailVerifiedAt ? "unverified_email" : isAdminUser(found.record.user) ? "admin" : null;
    const member = found && !blockedReason ? found.record.user : null;
    // The username check of the other password forms, done here because it is
    // only now that the username is known. The owner hears about it by mail.
    const passwordIsUsername = member !== null && (body.newPassword as string).toLowerCase() === member.loginUsername.toLowerCase();

    const pendingId = crypto.randomBytes(32).toString("hex");
    const code = generateCode(); // for a request that isn't allowed, it is never sent
    const started = await startPendingEmailCode(
      {
        id: pendingId,
        purpose: "reset",
        email,
        userId: member?.id ?? null,
        username: null,
        displayName: null,
        passwordHash,
        codeHash: hashCode(pendingId, code),
        createdAt: now.toISOString(),
        lastSentAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SIGNUP_TTL_MS).toISOString()
      },
      SIGNUP_RESEND_COOLDOWN_MS
    );
    if (!started) {
      await refundEmailQuota("reset", quota);
      return res.status(429).json({ error: SIGNUP_RESEND_WAIT_MESSAGE });
    }

    if (member) {
      try {
        await mailer.send({ to: email, ...(passwordIsUsername ? resetPasswordRejectedMail() : passwordResetCodeMail(code)) });
        logSecurityEvent(passwordIsUsername ? "email_notice_sent" : "email_code_sent", { ip: req.ip, userId: member.id, maskedEmail, purpose: "reset" }, "info");
      } catch (err) {
        // The answer must not change: say nothing, give the count back, log it.
        await refundEmailQuota("reset", quota);
        logSecurityEvent("mail_send_failed", {
          ip: req.ip,
          route: "reset/email/start",
          provider: mailer.provider,
          kind: err instanceof MailError ? err.kind : "unknown",
          status: err instanceof MailError ? err.status : undefined
        });
      }
    } else {
      logSecurityEvent("reset_email_blocked", { ip: req.ip, maskedEmail, reason: blockedReason });
    }

    res.cookie(RESET_EMAIL_COOKIE, pendingId, { ...resetCookieOptions, maxAge: SIGNUP_TTL_MS });
    res.json({ message: RESET_EMAIL_NEUTRAL_MESSAGE, expiresInMinutes: EMAIL_CODE_TTL_MINUTES });
  } catch (error: any) {
    console.error(`[Auth] reset email start failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — forgot password by e-mailed code, step 2. Public. Body { code }; the
// pending id comes from the httpOnly "pwresetmail" cookie. The attempt rules are
// the sign-up ones (every try counted atomically first, the 5th wrong one
// deletes the request, a right code afterwards is refused). A right code sets
// the new password, signs the person in, signs every other session out (a new
// hash invalidates them, and any lockout is cleared), leaves the owner an
// in-app notice and mails the address that the password changed.
app.post("/api/auth/reset/email/verify", verifyLimiter, async (req, res) => {
  try {
    const expired = async (pendingId?: string) => {
      if (pendingId) await deletePendingEmailCode(pendingId);
      res.clearCookie(RESET_EMAIL_COOKIE, resetCookieOptions);
      return res.status(400).json({ error: RESET_EMAIL_EXPIRED_MESSAGE, expired: true });
    };

    const cookieValue = req.cookies?.[RESET_EMAIL_COOKIE];
    const pending =
      typeof cookieValue === "string" && /^[a-f0-9]{64}$/.test(cookieValue) ? await getPendingEmailCode(cookieValue) : null;
    if (!pending || pending.purpose !== "reset" || !pending.passwordHash) return expired();
    if (Date.parse(pending.expiresAt) <= Date.now()) return expired(pending.id);

    const maskedEmail = maskEmail(pending.email);
    const code = parseCodeInput((req.body as Record<string, unknown> | undefined)?.code);

    const attempts = await bumpPendingEmailAttempts(pending.id);
    if (attempts === null) return expired();
    const right = code !== null && codeMatches(pending.id, code, pending.codeHash);
    if (!right || attempts > MAX_EMAIL_CODE_ATTEMPTS) {
      if (attempts >= MAX_EMAIL_CODE_ATTEMPTS) {
        await deletePendingEmailCode(pending.id);
        res.clearCookie(RESET_EMAIL_COOKIE, resetCookieOptions);
        logSecurityEvent("email_code_locked", { ip: req.ip, maskedEmail, attempts, purpose: "reset" }, "warn");
        return res.status(429).json({ error: RESET_EMAIL_LOCKED_MESSAGE, expired: true });
      }
      logSecurityEvent("email_code_failed", { ip: req.ip, maskedEmail, attempts, purpose: "reset" }, "warn");
      return res.status(400).json({ error: RESET_EMAIL_WRONG_CODE_MESSAGE });
    }

    // Things can change between the two steps: check again. The member must
    // still exist, still have this verified address, and still not be an admin.
    const user = pending.userId ? await getUserById(pending.userId) : null;
    const own = user ? await getUserEmail(user.id) : null;
    if (!user || !own || !own.verifiedAt || own.email.toLowerCase() !== pending.email || isAdminUser(user)) {
      return expired(pending.id);
    }

    const consumed = await consumePendingEmailCode(pending.id, new Date().toISOString());
    if (!consumed || !consumed.passwordHash) return expired();

    const hadPassword = isPasswordHash((await getUserAuthById(user.id))?.auth.passwordHash);
    // A new hash signs every older session out and clears any lockout.
    await setPasswordHash(user.id, consumed.passwordHash);
    await deletePendingResetsFor(user.id);
    await createSecurityNotice(
      user.id,
      "Your password was reset",
      `Someone entered a code sent to your email address (${maskedEmail}) and used it to set a new password. ` +
        "If that was you, nothing more to do. If it wasn't, change your password in your account settings and ask an admin for help."
    );
    logSecurityEvent("password_reset_via_email", { ip: req.ip, userId: user.id, maskedEmail, hadPassword }, hadPassword ? "warn" : "info");

    // Tell the address's owner. A mail failure doesn't undo a reset that happened.
    const mailer = getMailer();
    if (mailer) {
      try {
        await mailer.send({ to: own.email, ...passwordChangedMail() });
      } catch (err) {
        logSecurityEvent("mail_send_failed", {
          ip: req.ip,
          route: "reset/email/verify",
          provider: mailer.provider,
          kind: err instanceof MailError ? err.kind : "unknown",
          status: err instanceof MailError ? err.status : undefined
        });
      }
    }

    res.clearCookie(RESET_EMAIL_COOKIE, resetCookieOptions);
    setSessionCookie(res, user, consumed.passwordHash);
    res.json({ ...user, isAdmin: isAdminUser(user) });
  } catch (error: any) {
    console.error(`[Auth] reset email verify failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Pulls the username and password out of a login body. Returns null unless
// both are non-empty strings. This is input validation only, not an
// authorization check.
//
// The name is NOT checked against the sign-up rules (checkUsername): members
// who signed up with LeetCode were given their LeetCode name as login name, and
// LeetCode allows "-" and ".". Login only normalises (trim, lowercase) and looks
// the name up; an unknown name is just a failed login.
//
// `leetcodeUsername` is the old field name. It is still accepted so the current
// login form keeps working; `username` wins if both are sent.
function readLoginCredentials(body: unknown): { username: string; password: string } | null {
  const { username, leetcodeUsername, password } = (body ?? {}) as Record<string, unknown>;
  const name = typeof username === "string" ? username : leetcodeUsername;
  if (typeof name !== "string" || typeof password !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || password.length === 0) return null;
  return { username: trimmed.toLowerCase(), password };
}

// POST — password login.
app.post("/api/auth/login", loginLimiter, async (req, res) => {
  try {
    // Shape check only: it decides whether we can attempt a login at all.
    // Whether the login succeeds is decided below by verifyPassword() against
    // the stored hash, never by anything the client sent.
    const credentials = readLoginCredentials(req.body);
    if (credentials === null) {
      return res.status(400).json({ error: "Enter your username and password." });
    }
    const { username: loginName, password } = credentials;

    // One message for "no such user" and "wrong password", so the form can't
    // be used to probe which accounts have passwords.
    const INVALID = { error: "Invalid username or password." };

    if (password.length > MAX_PASSWORD_LENGTH) {
      return res.status(401).json(INVALID);
    }

    // Members are found by the name they sign in with, never by a LeetCode name.
    const record = await getUserAuthByLoginUsername(loginName);
    if (!record) {
      await burnPasswordCheck(password); // same cost as a real check
      logSecurityEvent("login_failed", { ip: req.ip, username: loginName, reason: "unknown_user" });
      return res.status(401).json(INVALID);
    }

    const { user, auth } = record;
    let failuresBefore = auth.failedLogins;

    if (auth.lockedUntil) {
      const until = Date.parse(auth.lockedUntil);
      if (until > Date.now()) {
        logSecurityEvent("login_blocked_locked", { ip: req.ip, userId: user.id, username: loginName });
        const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
        return res.status(429).json({
          error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
        });
      }
      await clearFailedLogins(user.id); // lock has expired
      failuresBefore = 0;
    }

    if (!isPasswordHash(auth.passwordHash)) {
      // Account from before passwords existed: no password to check yet.
      await burnPasswordCheck(password);
      return res.status(401).json({
        error: "This account has no password yet. Use \"Forgot password\" to set one by verifying a linked account, or contact a Leeterboard admin.",
        needsPassword: true
      });
    }

    if (!(await verifyPassword(password, auth.passwordHash))) {
      await recordFailedLogin(user.id, MAX_FAILED_LOGINS, new Date(Date.now() + LOCKOUT_MS).toISOString());
      logSecurityEvent("login_failed", {
        ip: req.ip,
        userId: user.id,
        username: loginName,
        failures: failuresBefore + 1
      });
      if (failuresBefore + 1 >= MAX_FAILED_LOGINS) {
        logSecurityEvent("account_locked", {
          ip: req.ip,
          userId: user.id,
          username: loginName,
          minutes: LOCKOUT_MS / 60_000
        });
      }
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

// ---------------------------------------------------------------------------
// Sign in with Google / GitHub (Authorization Code flow with PKCE).
//
//   GET /api/auth/oauth/:provider/start      sends the browser to the provider
//   GET /api/auth/oauth/:provider/callback   the provider sends it back here
//
// Both are full-page navigations, so they answer with redirects, never JSON.
// A failure always goes to /#/login?oauth_error=<code> with a code from the fixed
// list in oauth.ts (the page maps it to a message); nothing from the request or
// from the provider is ever put in a redirect. A member is identified ONLY by
// (provider, provider user id): the e-mail address is never used to find, sign in
// or link anyone.
// ---------------------------------------------------------------------------
const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_COOKIE_PATH = "/api/auth/oauth";
// The verified identity waiting for a username (a pending_oauth_signups row).
const OAUTH_SIGNUP_COOKIE = "oauth_signup";
const OAUTH_SIGNUP_TTL_MS = 15 * 60 * 1000;
const OAUTH_SIGNUP_EXPIRED_MESSAGE = "This sign-up has expired. Please start again.";
const OAUTH_EMAIL_IN_USE_MESSAGE =
  "An account already uses this email. Sign in the way you did before, then connect this provider in Account settings.";

// SameSite=Lax is what lets the cookie come back on the provider's top-level
// redirect to the callback; Strict would drop it.
const oauthCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: OAUTH_COOKIE_PATH
};

// Clears the state cookie and sends the browser back to the login page with a
// code from the allow-list. The type makes a free-form value a compile error.
// Wider path than the state cookie: the username screen talks to /api/auth/oauth/*,
// and the cookie must reach exactly those routes.
const oauthSignupCookieOptions = { ...oauthCookieOptions, path: "/api/auth" };

function oauthFail(res: express.Response, code: OAuthErrorCode): void {
  res.clearCookie(OAUTH_STATE_COOKIE, oauthCookieOptions);
  res.redirect(302, `/#/login?oauth_error=${code}`);
}

app.get("/api/auth/oauth/:provider/start", oauthLimiter, async (req, res) => {
  const provider = req.params.provider;
  try {
    if (!isOAuthProvider(provider) || !oauthConfig.providers[provider]) {
      if (oauthConfig.enabled.length === 0) logSecurityEvent("oauth_unconfigured", { ip: req.ip, route: "start" });
      return oauthFail(res, "unavailable");
    }
    const config = oauthConfig.providers[provider]!;
    const redirectUri = oauthConfig.redirectUri(provider)!; // enabled implies a valid PUBLIC_URL

    const now = Date.now();
    await deleteExpiredOAuthRows(new Date(now).toISOString());

    const { verifier, challenge } = generatePkce();
    const stateId = newStateId();
    await createOAuthState({
      id: stateId,
      provider,
      intent: "signin",
      userId: null,
      codeVerifier: verifier,
      expiresAt: new Date(now + OAUTH_STATE_TTL_MS).toISOString()
    });

    res.cookie(OAUTH_STATE_COOKIE, stateId, { ...oauthCookieOptions, maxAge: OAUTH_STATE_TTL_MS });
    logSecurityEvent("oauth_started", { ip: req.ip, provider, intent: "signin" }, "info");
    res.redirect(302, buildAuthorizeUrl(provider, { state: stateId, challenge, redirectUri, clientId: config.clientId }));
  } catch (error: any) {
    console.error(`[OAuth] start failed: ${error.message}`);
    logSecurityEvent("oauth_failed", { ip: req.ip, provider: isOAuthProvider(provider) ? provider : "unknown", reason: "server_error" });
    oauthFail(res, "failed");
  }
});

app.get("/api/auth/oauth/:provider/callback", oauthLimiter, async (req, res) => {
  const provider = req.params.provider;
  const refuse = (code: OAuthErrorCode, reason: string, fields: Record<string, unknown> = {}) => {
    logSecurityEvent("oauth_failed", {
      ip: req.ip,
      provider: isOAuthProvider(provider) ? provider : "unknown",
      reason,
      ...fields
    });
    oauthFail(res, code);
  };
  try {
    if (!isOAuthProvider(provider) || !oauthConfig.providers[provider]) {
      if (oauthConfig.enabled.length === 0) logSecurityEvent("oauth_unconfigured", { ip: req.ip, route: "callback" });
      return oauthFail(res, "unavailable");
    }

    // 1. The browser must be the one that started this attempt: the cookie holds
    //    the state id and it has to equal the `state` the provider sent back.
    //    Constant-time, and a missing, repeated or malformed value is just false.
    const stateId = req.query.state;
    if (!stateMatches(req.cookies?.[OAUTH_STATE_COOKIE], stateId)) {
      return refuse("failed", "state_mismatch");
    }

    // 2. One use: the row is deleted as it is read, so a replayed or raced
    //    callback finds nothing. Expired rows are not returned either.
    const state = await consumeOAuthState(stateId as string, new Date().toISOString());
    if (!state) return refuse("expired", "state_unknown_or_expired");
    if (state.provider !== provider) return refuse("failed", "state_provider_mismatch");

    // 3. The member said no (or the provider refused). Never echo its text.
    if (req.query.error !== undefined) {
      return req.query.error === "access_denied" ? (oauthFail(res, "cancelled"), undefined) : refuse("failed", "provider_error");
    }

    // Connecting a provider to a signed-in member arrives in a later step.
    if (state.intent !== "signin") return refuse("failed", "intent_not_supported");

    const code = req.query.code;
    if (typeof code !== "string") return refuse("failed", "missing_code");

    // 4. Server to server: the code (with the PKCE verifier) for a verified
    //    profile. The token inside is used once and thrown away.
    let profile;
    try {
      profile = await exchangeAndFetchProfile(provider, code, state.codeVerifier, {
        clientId: oauthConfig.providers[provider]!.clientId,
        clientSecret: oauthConfig.providers[provider]!.clientSecret,
        redirectUri: oauthConfig.redirectUri(provider)!,
        devBaseUrl: oauthDev.devBaseUrl
      });
    } catch (error) {
      const kind = error instanceof OAuthError ? error.kind : "failed";
      return refuse(kind, `exchange_${kind}`);
    }

    // 5. Who is this? Only the provider's own user id counts, never the e-mail.
    const userId = await getUserIdByOAuthIdentity(provider, profile.providerUserId);
    if (userId === null) {
      // A new identity. Nothing is created here: the member first chooses a public
      // username (POST /api/auth/oauth/complete). The address is checked now so
      // nobody walks through the username screen only to be refused at the end.
      if (!checkEmailDomain(profile.email, ALLOWED_EMAIL_DOMAINS)) return refuse("domain_not_allowed", "domain_not_allowed");
      // The visitor just proved they own this address, so saying it is taken
      // reveals nothing to a stranger. It is NOT a reason to sign them in.
      if (await emailTaken(profile.email)) return refuse("email_in_use", "email_in_use");

      const now = Date.now();
      const pendingId = newStateId();
      await createPendingOAuthSignup({
        id: pendingId,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        displayName: profile.displayName,
        expiresAt: new Date(now + OAUTH_SIGNUP_TTL_MS).toISOString()
      });
      res.clearCookie(OAUTH_STATE_COOKIE, oauthCookieOptions);
      res.cookie(OAUTH_SIGNUP_COOKIE, pendingId, { ...oauthSignupCookieOptions, maxAge: OAUTH_SIGNUP_TTL_MS });
      return res.redirect(302, "/#/signup/username");
    }
    const record = await getUserAuthById(userId);
    if (!record) return refuse("failed", "identity_without_member");

    setSessionCookie(res, record.user, record.auth.passwordHash);
    res.clearCookie(OAUTH_STATE_COOKIE, oauthCookieOptions);
    logSecurityEvent("oauth_login", { ip: req.ip, userId: record.user.id, provider }, "info");
    res.redirect(302, "/#/");
  } catch (error: any) {
    console.error(`[OAuth] callback failed: ${error.message}`);
    refuse("failed", "server_error");
  }
});

// A new member has no LeetCode data: no solved counts, no history, no baseline.
// All of that starts when they link LeetCode from their account settings.
function newMemberRecord(username: string, displayName: string): User {
  return {
    id: `user-${crypto.randomUUID()}`,
    displayName,
    loginUsername: username,
    leetcodeLinked: false,
    leetcodeUsername: "",
    avatarUrl: defaultAvatar(username),
    school: "",
    bio: "",
    githubUrl: "",
    linkedinUrl: "",
    websiteUrl: "",
    allTimeSolved: 0,
    easySolved: 0,
    mediumSolved: 0,
    hardSolved: 0,
    contestRating: null,
    contestsAttended: 0,
    currentStreak: null,
    longestStreak: null,
    weeklyProgress: 0,
    monthlyProgress: 0,
    rank: 0,
    lastUpdated: null,
    trackingStart: "",
    baselineSolved: 0,
    history: []
  };
}

const PENDING_ID_RE = /^[0-9a-f]{32}$/;

async function readPendingOAuthSignup(req: express.Request) {
  const value = req.cookies?.[OAUTH_SIGNUP_COOKIE];
  if (typeof value !== "string" || !PENDING_ID_RE.test(value)) return null;
  return getPendingOAuthSignup(value, new Date().toISOString());
}

// GET — the username screen asks who it is creating an account for. The address
// is masked, and nothing here can be used without the httpOnly cookie that only
// the browser that completed the provider step holds.
app.get("/api/auth/oauth/pending", oauthLimiter, async (req, res) => {
  try {
    const pending = await readPendingOAuthSignup(req);
    if (!pending) {
      res.clearCookie(OAUTH_SIGNUP_COOKIE, oauthSignupCookieOptions);
      return res.status(400).json({ error: OAUTH_SIGNUP_EXPIRED_MESSAGE, expired: true });
    }
    res.json({
      provider: pending.provider,
      maskedEmail: maskEmail(pending.email),
      suggestedDisplayName: pending.displayName
    });
  } catch (error: any) {
    console.error(`[OAuth] pending lookup failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — the new member chooses a public username (and, optionally, a display
// name). The account is created here and only here, with the provider-verified
// address stored on it, no password and no LeetCode. Everything that can be
// checked without spending the pending sign-up is checked first, so a typo or a
// taken name doesn't send the person back through the provider.
app.post("/api/auth/oauth/complete", oauthLimiter, async (req, res) => {
  try {
    const expired = () => {
      res.clearCookie(OAUTH_SIGNUP_COOKIE, oauthSignupCookieOptions);
      return res.status(400).json({ error: OAUTH_SIGNUP_EXPIRED_MESSAGE, expired: true });
    };

    const pending = await readPendingOAuthSignup(req);
    if (!pending) return expired();

    const body = (req.body ?? {}) as Record<string, unknown>;
    const check = checkUsername(body.username);
    if (!check.ok) return res.status(400).json({ error: check.error });
    const username = check.username;
    if (await getUserAuthByLoginUsername(username)) {
      return res.status(409).json({ error: "That username is taken." });
    }

    // Someone may have taken this address since the provider step.
    if (await emailTaken(pending.email)) {
      await consumePendingOAuthSignup(pending.id, new Date().toISOString());
      res.clearCookie(OAUTH_SIGNUP_COOKIE, oauthSignupCookieOptions);
      return res.status(409).json({ error: OAUTH_EMAIL_IN_USE_MESSAGE });
    }

    // One use: of two simultaneous completions exactly one gets the row.
    const taken = await consumePendingOAuthSignup(pending.id, new Date().toISOString());
    if (!taken) return expired();

    const user = newMemberRecord(username, cleanDisplayName(body.displayName, username));
    try {
      await insertUserWithIdentity(user, {
        loginUsername: username,
        email: taken.email,
        provider: taken.provider,
        providerUserId: taken.providerUserId
      });
    } catch (error: any) {
      if (!String(error?.message).includes("UNIQUE")) throw error;
      // The unique indexes decide, and the batch is all-or-nothing: no member was created.
      if (await getUserAuthByLoginUsername(username)) {
        // Lost a race for the name. Give the sign-up back so another name can be tried.
        await createPendingOAuthSignup(taken);
        return res.status(409).json({ error: "That username was just taken. Please choose another one." });
      }
      res.clearCookie(OAUTH_SIGNUP_COOKIE, oauthSignupCookieOptions);
      if (await getUserIdByOAuthIdentity(taken.provider, taken.providerUserId)) {
        return res.status(409).json({ error: "This account already has a Leeterboard account. Sign in with it instead." });
      }
      return res.status(409).json({ error: OAUTH_EMAIL_IN_USE_MESSAGE });
    }

    logSecurityEvent(
      "account_created",
      { ip: req.ip, userId: user.id, username, maskedEmail: maskEmail(taken.email), provider: taken.provider },
      "info"
    );
    res.clearCookie(OAUTH_SIGNUP_COOKIE, oauthSignupCookieOptions);
    setSessionCookie(res, user, ""); // no password: the token carries no fingerprint
    res.status(201).json({ ...user, isAdmin: isAdminUser(user) });
  } catch (error: any) {
    console.error(`[OAuth] complete failed: ${error.message}`);
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
    // A member's OWN address is the one place it is ever returned (so the
    // account page can show it). It is added here, to this response only: the
    // User mapping used by the board, profiles and admin tables has no email.
    const own = await getUserEmail(resolved.user.id);
    res.json({
      status: "authenticated",
      user: { ...resolved.user, isAdmin: resolved.isAdmin, email: own?.email ?? null, emailVerified: Boolean(own?.verifiedAt) }
    });
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
  password: unknown,
  action: "password_change" | "account_delete" | "email_change",
  ip: string | undefined
): Promise<{ record: UserWithAuth | null; status: number; error: string; code?: string }> {
  const fail = (status: number, error: string, code?: string) => ({ record: null, status, error, code });

  if (typeof password !== "string" || !password) return fail(400, "Enter your current password.");
  const record = await getUserAuthById(userId);
  if (!record) return fail(401, SESSION_REQUIRED_BODY.error, SESSION_REQUIRED_CODE);

  if (!isPasswordHash(record.auth.passwordHash)) {
    return fail(
      409,
      "This account has no password yet. Log out, then use \"Forgot password\" to set one by verifying a linked account."
    );
  }

  let failuresBefore = record.auth.failedLogins;
  if (record.auth.lockedUntil) {
    const until = Date.parse(record.auth.lockedUntil);
    if (until > Date.now()) {
      const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      return fail(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }
    await clearFailedLogins(userId); // lock has expired
    failuresBefore = 0;
  }

  if (password.length > MAX_PASSWORD_LENGTH || !(await verifyPassword(password, record.auth.passwordHash))) {
    await recordFailedLogin(userId, MAX_FAILED_LOGINS, new Date(Date.now() + LOCKOUT_MS).toISOString());
    logSecurityEvent("reauth_failed", {
      ip,
      userId,
      username: record.user.loginUsername,
      action,
      failures: failuresBefore + 1
    });
    if (failuresBefore + 1 >= MAX_FAILED_LOGINS) {
      logSecurityEvent("account_locked", {
        ip,
        userId,
        username: record.user.loginUsername,
        minutes: LOCKOUT_MS / 60_000
      });
    }
    return fail(401, "Current password is incorrect.");
  }

  if (record.auth.failedLogins > 0) await clearFailedLogins(userId);
  return { record, status: 200, error: "" };
}

// PATCH — change the display name, school, bio and/or profile links (GitHub,
// LinkedIn, website). Send only the fields that change; an empty string clears
// school, bio or a link. The avatar is not editable: it always comes from the
// member's LeetCode account.
app.patch("/api/account/profile", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    const body = req.body ?? {};
    const hasName = body.displayName !== undefined;
    const hasSchool = body.school !== undefined;

    if (hasSchool && typeof body.school !== "string") {
      return res.status(400).json({ error: "School must be text." });
    }

    let cleanedName = "";
    if (hasName) {
      cleanedName = cleanDisplayName(body.displayName, "");
      if (!cleanedName) return res.status(400).json({ error: "Display name can't be empty." });
    }

    // Validate everything before writing anything.
    const details: ProfileDetailsUpdate = {};
    if (body.bio !== undefined) {
      if (typeof body.bio !== "string") return res.status(400).json({ error: "Bio must be text." });
      details.bio = cleanBio(body.bio);
    }
    for (const f of LINK_FIELDS) {
      if (body[f.body] === undefined) continue;
      if (typeof body[f.body] !== "string") {
        return res.status(400).json({ error: `${f.label} link must be text.` });
      }
      const result = cleanLink(body[f.body], f.label, f.hosts ? [...f.hosts] : null);
      if ("error" in result) return res.status(400).json({ error: result.error });
      details[f.key] = result.value;
    }

    const hasHideLeetcode = body.hideLeetcodeStats !== undefined;
    if (hasHideLeetcode && typeof body.hideLeetcodeStats !== "boolean") {
      return res.status(400).json({ error: "hideLeetcodeStats must be true or false." });
    }

    if (!hasName && !hasSchool && !hasHideLeetcode && Object.keys(details).length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    if (hasName) await updateDisplayName(id, cleanedName);
    if (hasSchool) await updateSchool(id, cleanSchool(body.school));
    await updateProfileDetails(id, details);
    if (hasHideLeetcode) await setHideLeetcodeStats(id, body.hideLeetcodeStats);

    const updated = await getUserById(id);
    if (!updated) return res.status(401).json(SESSION_REQUIRED_BODY);
    res.json({ ...updated, isAdmin: isAdminUser(updated) });
  } catch (error: any) {
    console.error(`[Account] profile update failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/* ---------- Linked Codeforces / CodinGame accounts ---------- */
//
// LeetCode stays the member's main account; they can add or remove the others.
// Because anyone could type any handle, adding one needs the same kind of proof
// as sign-up: the server hands out a random code, the member puts it in a
// profile field of that account, and the server reads the public profile back.
// Nobody else can edit that profile, so nobody can link an account that isn't
// theirs. Nothing about the member changes until the check passes.

const LINK_TTL_MS = 30 * 60 * 1000;
const MAX_LINK_ATTEMPTS = 10;

// Sends the error itself and returns null when the platform in the URL is
// unknown or can't be linked yet.
function resolveLinkPlatform(value: unknown, res: express.Response): PlatformInfo | null {
  if (!isPlatformId(value)) {
    res.status(404).json({ error: "Unknown platform." });
    return null;
  }
  const platform = PLATFORMS[value];
  if (!platform.fetchProfile) {
    res.status(400).json({ error: `Linking ${platform.label} isn't available yet.` });
    return null;
  }
  return platform;
}

async function userJson(id: string) {
  const user = await getUserById(id);
  return user ? { ...user, isAdmin: isAdminUser(user) } : null;
}

// POST — step 1. Checks the account exists and isn't taken, then returns the
// code to put in its profile.
app.post("/api/account/platforms/:platform/start", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    const platform = resolveLinkPlatform(req.params.platform, res);
    if (!platform) return;

    const raw = req.body?.handle;
    const handle = typeof raw === "string" ? raw.trim() : "";
    if (!platform.handlePattern.test(handle)) {
      return res.status(400).json({
        error: `Enter a valid ${platform.label} handle (letters, numbers, dots, dashes and underscores).`
      });
    }

    if ((await getPlatformAccounts(id))[platform.id]) {
      return res.status(409).json({
        error: `You've already linked a ${platform.label} account. Remove it first to link a different one.`
      });
    }
    if (await findPlatformAccountOwner(platform.id, handle)) {
      return res.status(409).json({ error: `That ${platform.label} account is already linked to a member.` });
    }

    let profile;
    try {
      profile = await platform.fetchProfile!(handle);
    } catch (err: any) {
      if (err instanceof PlatformNotFoundError) return res.status(404).json({ error: err.message });
      return res.status(503).json({ error: err.message });
    }

    const code = `leeterboard-${crypto.randomBytes(6).toString("hex")}`;
    await purgeExpiredPendingLinks(new Date().toISOString());
    await createPendingLink({
      userId: id,
      platform: platform.id,
      handle: profile.handle,
      code,
      expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString()
    });

    res.json({
      code,
      platform: platform.id,
      handle: profile.handle,
      instructions: platform.proofHelp,
      expiresInMinutes: LINK_TTL_MS / 60_000
    });
  } catch (error: any) {
    console.error(`[Account] link start failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — step 2. Reads the public profile and, if the code is there, links the
// account, runs its first sync and returns the updated member.
app.post("/api/account/platforms/:platform/verify", verifyLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    const platform = resolveLinkPlatform(req.params.platform, res);
    if (!platform) return;

    const pending = await getPendingLink(id, platform.id);
    if (!pending || Date.parse(pending.expiresAt) < Date.now()) {
      if (pending) await deletePendingLink(id, platform.id);
      return res.status(400).json({ error: "This link request has expired. Please start again.", expired: true });
    }
    if (pending.attempts >= MAX_LINK_ATTEMPTS) {
      await deletePendingLink(id, platform.id);
      return res.status(429).json({ error: "Too many failed checks. Please start again.", expired: true });
    }

    let profile;
    try {
      profile = await platform.fetchProfile!(pending.handle);
    } catch (err: any) {
      if (err instanceof PlatformNotFoundError) return res.status(404).json({ error: err.message });
      return res.status(503).json({ error: err.message });
    }

    const needle = pending.code.toLowerCase();
    if (!profile.texts.some((t) => t.toLowerCase().includes(needle))) {
      await bumpPendingLinkAttempts(id, platform.id);
      logSecurityEvent("platform_link_failed", {
        ip: req.ip,
        userId: id,
        platform: platform.id,
        handle: pending.handle,
        attempts: pending.attempts + 1
      });
      return res.status(400).json({
        error: `We couldn't find the code on your ${platform.label} profile yet. Save it there, wait a few seconds, then try again.`
      });
    }

    // Ownership proven. Consume the challenge atomically so it can't be
    // replayed or used by two concurrent requests.
    if (!(await consumePendingLink(id, platform.id))) {
      logSecurityEvent("platform_link_failed", { ip: req.ip, userId: id, platform: platform.id, reason: "replay" });
      return res.status(400).json({ error: "This link request was already used or has expired. Please start again.", expired: true });
    }
    try {
      await insertPlatformAccount(id, platform.id, profile.handle);
    } catch (err: any) {
      if (String(err?.message).includes("UNIQUE")) {
        return res.status(409).json({ error: `That ${platform.label} account was just linked. Refresh and check.` });
      }
      throw err;
    }

    logSecurityEvent("platform_link_verified", { ip: req.ip, userId: id, platform: platform.id, handle: profile.handle }, "info");

    // First sync so the stats show straight away. If the platform is slow or
    // down the account is still linked and the next sync fills it in.
    await syncPlatformAccount({ userId: id, platform: platform.id, handle: profile.handle });

    const updated = await userJson(id);
    if (!updated) return res.status(401).json(SESSION_REQUIRED_BODY);
    res.status(201).json(updated);
  } catch (error: any) {
    console.error(`[Account] link verify failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// DELETE — unlinks the account and everything stored for it. LeetCode is the
// member's main account and isn't handled here.
app.delete("/api/account/platforms/:platform", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    if (!isPlatformId(req.params.platform)) return res.status(404).json({ error: "Unknown platform." });
    const platform = PLATFORMS[req.params.platform];

    if (!(await removePlatformAccount(id, platform.id))) {
      return res.status(404).json({ error: `You don't have a ${platform.label} account linked.` });
    }
    logSecurityEvent("platform_unlinked", { ip: req.ip, userId: id, platform: platform.id }, "info");
    const updated = await userJson(id);
    if (!updated) return res.status(401).json(SESSION_REQUIRED_BODY);
    res.json(updated);
  } catch (error: any) {
    console.error(`[Account] unlink failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Linking a LeetCode account. LeetCode is optional: a member signs up with just a
// username and password and can attach one afterwards. Because anyone could type
// any LeetCode username, it takes proof that the profile is theirs: a one-time
// code in the profile Summary, read back from LeetCode itself.
//
// POST start: pick the username, get the code.
app.post("/api/account/leetcode/start", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    const handle = parseLeetCodeUsername((req.body as any)?.leetcodeUsername);
    if (!handle) {
      return res.status(400).json({ error: "Enter a valid LeetCode username (letters, numbers, _ . - only)." });
    }
    const me = await getUserById(id);
    if (!me) return res.status(401).json(SESSION_REQUIRED_BODY);
    if (me.leetcodeLinked) {
      return res.status(409).json({ error: "You already have a LeetCode account linked. Remove it first to link a different one." });
    }
    if (await findLeetcodeOwner(handle)) {
      return res.status(409).json({ error: "That LeetCode account is already linked to another member." });
    }

    // The proof comes from LeetCode itself, never from a third-party mirror.
    const lookup = await fetchLeetCodeAbout(handle);
    if (lookup.status === "unavailable") {
      logSecurityEvent("ownership_lookup_unavailable", { ip: req.ip, userId: id, platform: "leetcode", purpose: "link" });
      return res.status(503).json({ error: LEETCODE_UNAVAILABLE_MESSAGE });
    }
    if (lookup.status === "not_found") {
      return res.status(404).json({ error: "We couldn't find that LeetCode account. Check the spelling." });
    }

    await purgeExpiredPendingLinks(new Date().toISOString());
    const code = `leeterboard-${crypto.randomBytes(6).toString("hex")}`;
    await createPendingLink({
      userId: id,
      platform: "leetcode",
      handle: lookup.username,
      code,
      expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString()
    });
    logSecurityEvent("ownership_started", { ip: req.ip, userId: id, platform: "leetcode", purpose: "link" }, "info");
    res.json({
      code,
      platform: "leetcode",
      handle: lookup.username,
      instructions: LEETCODE_PROOF_HELP,
      expiresInMinutes: LINK_TTL_MS / 60_000
    });
  } catch (error: any) {
    console.error(`[Account] LeetCode link start failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST verify: reads the profile; if the code is there, links the account and
// starts tracking from now.
app.post("/api/account/leetcode/verify", verifyLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    const pending = await getPendingLink(id, "leetcode");
    if (!pending || Date.parse(pending.expiresAt) < Date.now()) {
      if (pending) await deletePendingLink(id, "leetcode");
      return res.status(400).json({ error: "This link request has expired. Please start again.", expired: true });
    }
    if (pending.attempts >= MAX_LINK_ATTEMPTS) {
      await deletePendingLink(id, "leetcode");
      return res.status(429).json({ error: "Too many failed checks. Please start again.", expired: true });
    }
    const me = await getUserById(id);
    if (!me) return res.status(401).json(SESSION_REQUIRED_BODY);
    if (me.leetcodeLinked) {
      await deletePendingLink(id, "leetcode");
      return res.status(409).json({ error: "You already have a LeetCode account linked." });
    }

    const lookup = await fetchLeetCodeAbout(pending.handle);
    if (lookup.status === "unavailable") {
      logSecurityEvent("ownership_lookup_unavailable", { ip: req.ip, userId: id, platform: "leetcode", purpose: "link" });
      return res.status(503).json({ error: LEETCODE_UNAVAILABLE_MESSAGE });
    }
    if (lookup.status === "not_found") {
      await deletePendingLink(id, "leetcode");
      return res.status(404).json({ error: "That LeetCode account no longer exists." });
    }
    if (!lookup.aboutMe.toLowerCase().includes(pending.code.toLowerCase())) {
      await bumpPendingLinkAttempts(id, "leetcode");
      logSecurityEvent("ownership_failed", {
        ip: req.ip,
        userId: id,
        platform: "leetcode",
        purpose: "link",
        attempts: pending.attempts + 1
      });
      return res.status(400).json({
        error: "We couldn't find the code on your LeetCode profile yet. Save it in the Summary, wait a few seconds, then try again."
      });
    }

    // Ownership proven. Read the real stats BEFORE spending the challenge, so a
    // flaky moment at LeetCode doesn't make them start over.
    let stats: Awaited<ReturnType<typeof scrapeLeetCodeProfile>>;
    try {
      stats = await scrapeLeetCodeProfile(pending.handle);
    } catch (err: any) {
      if (err instanceof LeetCodeUserNotFoundError) {
        await deletePendingLink(id, "leetcode");
        return res.status(404).json({ error: "That LeetCode account no longer exists." });
      }
      return res.status(503).json({ error: LEETCODE_UNAVAILABLE_MESSAGE });
    }
    const [contest, streaks] = await Promise.all([fetchContestRating(pending.handle), fetchStreaks(pending.handle, null)]);

    // Take the challenge atomically, so two requests can't both link.
    if (!(await consumePendingLink(id, "leetcode"))) {
      return res.status(400).json({ error: "This link request was already used or has expired. Please start again.", expired: true });
    }
    const now = new Date();
    let linked: boolean;
    try {
      linked = await linkLeetcodeAccount(id, {
        leetcodeUsername: pending.handle,
        avatarUrl: stats.avatarUrl ?? null,
        allTimeSolved: stats.allTimeSolved,
        easySolved: stats.easySolved,
        mediumSolved: stats.mediumSolved,
        hardSolved: stats.hardSolved,
        contestRating: contest?.rating ?? null,
        contestsAttended: contest?.attended ?? 0,
        currentStreak: streaks?.current ?? null,
        longestStreak: streaks?.longest ?? null,
        today: now.toISOString().split("T")[0],
        nowIso: now.toISOString()
      });
    } catch (err: any) {
      if (String(err?.message).includes("UNIQUE")) {
        // Another member linked this username between the start and now.
        return res.status(409).json({ error: "That LeetCode account was just linked to another member." });
      }
      throw err;
    }
    if (!linked) return res.status(409).json({ error: "You already have a LeetCode account linked." });

    // What they already hold when they link isn't news; only later awards notify.
    const updated = await getUserById(id);
    if (updated) {
      try {
        await baselineNewMember(updated, leetcodeLinkedUsers(await listUsers()));
      } catch (err: any) {
        console.warn(`[Notifications] Baseline failed: ${err.message}`);
      }
    }
    logSecurityEvent("ownership_verified", { ip: req.ip, userId: id, platform: "leetcode", purpose: "link" }, "info");
    res.status(201).json(await userJson(id));
  } catch (error: any) {
    console.error(`[Account] LeetCode link verify failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// DELETE: unlink. Removes the LeetCode stats, history and sync status; the
// member, their other linked accounts and their settings stay.
app.delete("/api/account/leetcode", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    if (!(await unlinkLeetcodeAccount(id))) {
      return res.status(404).json({ error: "You don't have a LeetCode account linked." });
    }
    logSecurityEvent("platform_unlinked", { ip: req.ip, userId: id, platform: "leetcode" }, "info");
    const updated = await userJson(id);
    if (!updated) return res.status(401).json(SESSION_REQUIRED_BODY);
    res.json(updated);
  } catch (error: any) {
    console.error(`[Account] LeetCode unlink failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH — show or hide a linked account from other members. Body: { hidden: boolean }.
app.patch("/api/account/platforms/:platform", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    if (!isPlatformId(req.params.platform)) return res.status(404).json({ error: "Unknown platform." });
    const platform = PLATFORMS[req.params.platform];

    const hidden = req.body?.hidden;
    if (typeof hidden !== "boolean") return res.status(400).json({ error: "hidden must be true or false." });

    if (!(await setPlatformHidden(id, platform.id, hidden))) {
      return res.status(404).json({ error: `You don't have a ${platform.label} account linked.` });
    }
    const updated = await userJson(id);
    if (!updated) return res.status(401).json(SESSION_REQUIRED_BODY);
    res.json(updated);
  } catch (error: any) {
    console.error(`[Account] platform visibility failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — add or change the member's e-mail address, step 1 of 2: a 6-digit code
// goes to the new address. Needs the current password, like changing the
// password does: an address is what "Forgot password" mails a code to, so
// swapping it is as sensitive as the password itself and a stolen session alone
// must not be enough.
//
// Anti-enumeration, as for sign-up. An address that belongs to another member
// is answered exactly like a free one (same status, same body shape, one mail
// either way: a notice instead of a code, and a pending request holding a code
// nobody received, so the verify step can't tell them apart either). Applies the
// same ALLOWED_EMAIL_DOMAINS list as sign-up, the same 3-an-hour limit per
// address and the same 60-second resend wait.
const ACCOUNT_MAIL_UNAVAILABLE_MESSAGE = "Email isn't available right now. Please try again later.";
const EMAIL_REQUEST_EXPIRED_MESSAGE = "This request has expired. Please start again.";
const EMAIL_WRONG_CODE_MESSAGE = "That code isn't right. Check it and try again.";
const EMAIL_LOCKED_MESSAGE = "Too many wrong codes. Please start again.";

app.post("/api/account/email/start", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    const mailer = getMailer();
    if (!mailer) {
      logSecurityEvent("mail_unconfigured", { ip: req.ip, route: "account/email/start" });
      return res.status(503).json({ error: ACCOUNT_MAIL_UNAVAILABLE_MESSAGE });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const emailCheck = checkEmail(body.email, ALLOWED_EMAIL_DOMAINS);
    if (!emailCheck.ok) {
      return res.status(400).json({ error: emailCheck.error });
    }
    const email = emailCheck.email;
    const maskedEmail = maskEmail(email);

    const check = await checkCurrentPassword(id, body.currentPassword, "email_change", req.ip);
    if (!check.record) return res.status(check.status).json({ error: check.error, code: check.code });

    const quota = await takeEmailQuota("add_email", email);
    if (!quota.allowed) {
      logSecurityEvent("email_rate_limited", { ip: req.ip, userId: id, maskedEmail, purpose: "add_email" });
      return res.status(429).json({ error: EMAIL_RATE_LIMITED_MESSAGE });
    }

    // From here on both outcomes do the same work, in the same order.
    const now = new Date();
    await deleteExpiredPendingEmailCodes(now.toISOString());
    await deletePendingEmailCodesForUser(id, "add_email", email);
    const taken = await emailTaken(email, id);

    const pendingId = crypto.randomBytes(32).toString("hex");
    const code = generateCode(); // for an address another member has, it is never sent
    const started = await startPendingEmailCode(
      {
        id: pendingId,
        purpose: "add_email",
        email,
        userId: id,
        username: null,
        displayName: null,
        passwordHash: null,
        codeHash: hashCode(pendingId, code),
        createdAt: now.toISOString(),
        lastSentAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SIGNUP_TTL_MS).toISOString()
      },
      SIGNUP_RESEND_COOLDOWN_MS
    );
    if (!started) {
      await refundEmailQuota("add_email", quota);
      return res.status(429).json({ error: SIGNUP_RESEND_WAIT_MESSAGE });
    }

    try {
      await mailer.send({ to: email, ...(taken ? emailInUseMail() : addEmailCodeMail(code)) });
    } catch (err) {
      await deletePendingEmailCode(pendingId);
      await refundEmailQuota("add_email", quota);
      logSecurityEvent("mail_send_failed", {
        ip: req.ip,
        route: "account/email/start",
        provider: mailer.provider,
        kind: err instanceof MailError ? err.kind : "unknown",
        status: err instanceof MailError ? err.status : undefined
      });
      return res.status(503).json({ error: SIGNUP_MAIL_FAILED_MESSAGE });
    }

    logSecurityEvent(taken ? "email_notice_sent" : "email_code_sent", { ip: req.ip, userId: id, maskedEmail, purpose: "add_email" }, "info");
    res.json({ expiresInMinutes: EMAIL_CODE_TTL_MINUTES, maskedEmail });
  } catch (error: any) {
    console.error(`[Account] email start failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — add or change the e-mail address, step 2 of 2: the code from the mail.
// The request is the member's own open one (found through the session, so no
// cookie is needed), and the attempt rules are the sign-up ones: every try is
// counted atomically before the code is compared, the fifth wrong one deletes
// the request, and a right code afterwards is refused.
app.post("/api/account/email/verify", verifyLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user as { id: string };
    const expired = async (pendingId?: string) => {
      if (pendingId) await deletePendingEmailCode(pendingId);
      return res.status(400).json({ error: EMAIL_REQUEST_EXPIRED_MESSAGE, expired: true });
    };

    const pending = await getPendingEmailCodeForUser(id, "add_email");
    if (!pending) return expired();
    if (Date.parse(pending.expiresAt) <= Date.now()) return expired(pending.id);

    const maskedEmail = maskEmail(pending.email);
    const code = parseCodeInput((req.body as Record<string, unknown> | undefined)?.code);

    const attempts = await bumpPendingEmailAttempts(pending.id);
    if (attempts === null) return expired();
    const right = code !== null && codeMatches(pending.id, code, pending.codeHash);
    if (!right || attempts > MAX_EMAIL_CODE_ATTEMPTS) {
      if (attempts >= MAX_EMAIL_CODE_ATTEMPTS) {
        await deletePendingEmailCode(pending.id);
        logSecurityEvent("email_code_locked", { ip: req.ip, userId: id, maskedEmail, attempts, purpose: "add_email" }, "warn");
        return res.status(429).json({ error: EMAIL_LOCKED_MESSAGE, expired: true });
      }
      logSecurityEvent("email_code_failed", { ip: req.ip, userId: id, maskedEmail, attempts, purpose: "add_email" }, "warn");
      return res.status(400).json({ error: EMAIL_WRONG_CODE_MESSAGE });
    }

    // The right code. If another member has the address by now, say nothing
    // about it: end the request like an expired one.
    if (await emailTaken(pending.email, id)) return expired(pending.id);
    const consumed = await consumePendingEmailCode(pending.id, new Date().toISOString());
    if (!consumed) return expired();
    if (!(await setUserEmail(id, consumed.email))) return expired(); // the unique index decided

    logSecurityEvent("email_verified", { ip: req.ip, userId: id, maskedEmail, purpose: "add_email" }, "info");
    res.json({ success: true, maskedEmail, emailVerified: true });
  } catch (error: any) {
    console.error(`[Account] email verify failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — change password. Needs the current one; signs out every other
// session and keeps this one signed in with a fresh cookie.
app.post("/api/account/password", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id, loginUsername } = (req as any).user as { id: string; loginUsername: string };
    const { currentPassword, newPassword } = req.body ?? {};

    const check = await checkCurrentPassword(id, currentPassword, "password_change", req.ip);
    if (!check.record) return res.status(check.status).json({ error: check.error, code: check.code });

    const passwordError = validatePassword(newPassword, loginUsername);
    if (passwordError) return res.status(400).json({ error: passwordError });
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: "Your new password must be different from the current one." });
    }

    const newHash = await hashPassword(newPassword as string);
    await setPasswordHash(id, newHash);
    logSecurityEvent("password_changed", { ip: req.ip, userId: id, username: loginUsername }, "info");
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
    const check = await checkCurrentPassword(id, req.body?.password, "account_delete", req.ip);
    if (!check.record) return res.status(check.status).json({ error: check.error, code: check.code });

    await deleteUserById(id);
    logSecurityEvent("account_deleted", { ip: req.ip, userId: id, username: check.record.user.loginUsername }, "info");
    clearSessionCookie(res);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Account] delete failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// DELETE user — admin only. Admin accounts can't be removed through this
// route (so one compromised or careless admin can't wipe out the others, or
// themselves, with a single request); a member deletes their own account from
// the account page, which requires their password.
app.delete("/api/users/:id", requireAdmin, async (req, res) => {
  const id = req.params.id as string;
  const session = (req as any).user as { id: string; loginUsername: string };

  try {
    const target = await getUserById(id);
    if (!target) {
      return res.status(404).json({ error: "User not found." });
    }
    if (target.id === session.id || isAdminUser(target)) {
      return res.status(403).json({
        error: "Admin accounts can't be removed here. Remove the account from the admin list first."
      });
    }

    const deleted = await deleteUserById(id);
    if (!deleted) {
      return res.status(404).json({ error: "User not found." });
    }
    logSecurityEvent(
      "admin_user_removed",
      { ip: req.ip, adminId: session.id, admin: session.loginUsername, targetId: target.id, target: target.loginUsername },
      "info"
    );
    res.json({ success: true, message: "Member removed successfully." });
  } catch (error: any) {
    console.error(`[Admin] member removal failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST refresh individual user — admin only. Each call triggers several
// outbound scrapes, so it must not be an anonymous amplification point. The
// only caller is the admin dashboard; visitors rely on /api/sync-if-stale.
app.post("/api/users/:id/refresh", refreshLimiter, requireAdmin, async (req, res) => {
  const id = req.params.id as string;
  const admin = (req as any).user as { id: string; loginUsername: string };
  logSecurityEvent("admin_refresh", { ip: req.ip, adminId: admin.id, admin: admin.loginUsername, scope: "member", targetId: id }, "info");

  try {
    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    // No LeetCode account, nothing to fetch from LeetCode (and no username to
    // fetch it with): refresh only the other accounts this member has linked.
    if (!user.leetcodeLinked) {
      try {
        await syncPlatformAccountsForUser(user.id);
      } catch (err: any) {
        console.warn(`[Refresh] Linked accounts failed for ${user.displayName}: ${err.message}`);
      }
      user.platforms = await getPlatformAccounts(user.id);
      res.vary("Cookie");
      return res.json(withVisiblePlatforms(user, await viewerOf(req)));
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
    await checkNewAwards();

    // Linked Codeforces / CodinGame accounts. Failures are recorded per account
    // and never turn a successful LeetCode refresh into an error.
    try {
      await syncPlatformAccountsForUser(user.id);
    } catch (err: any) {
      console.warn(`[Refresh] Linked accounts failed for ${user.loginUsername}: ${err.message}`);
    }
    user.platforms = await getPlatformAccounts(user.id);

    res.vary("Cookie");
    res.json(withVisiblePlatforms(user, await viewerOf(req)));
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

  // Only members with a LeetCode account have anything to fetch from LeetCode
  // (and a username to fetch it with). Everyone else's linked accounts are
  // handled by the platform pass further down.
  const onBoard = leetcodeLinkedUsers(users);
  let queue = onBoard;
  if (opts.onlyStaleMs !== undefined) {
    const cutoff = Date.now() - opts.onlyStaleMs;
    // Never synced (lastUpdated null) counts as stale and goes first.
    const syncedAt = (u: User) => (u.lastUpdated ? Date.parse(u.lastUpdated) : 0) || 0;
    queue = onBoard
      .filter((u) => !(syncedAt(u) > cutoff))
      .sort((a, b) => syncedAt(a) - syncedAt(b));
  }
  console.log(`[Sync All] Refreshing ${queue.length} of ${onBoard.length} LeetCode members (${users.length} members in all).`);

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
      console.warn(`[Sync All] Skipping ${user.loginUsername}: ${err.message}`);
      await recordSyncResult(user.id, {
        ok: false,
        state: err instanceof LeetCodeUserNotFoundError ? "not_found" : "unavailable",
        error: err.message
      });
    }
  }

  // Linked Codeforces / CodinGame accounts, after LeetCode and on whatever is
  // left of the time budget. Their failures are handled inside and never
  // affect the LeetCode stats above.
  try {
    const left = opts.budgetMs === undefined ? undefined : Math.max(0, opts.budgetMs - (Date.now() - startedAt));
    const platformPass = await syncAllPlatformAccounts({ onlyStaleMs: opts.onlyStaleMs, budgetMs: left });
    if (platformPass.partial) partial = true;
    if (platformPass.synced > 0) {
      const byUser = await loadPlatformsByUser();
      for (const u of users) u.platforms = byUser.get(u.id) ?? {};
    }
  } catch (err: any) {
    console.warn(`[Sync All] Linked accounts pass failed: ${err.message}`);
  }

  // Anything earned during this pass (nothing to check if nobody was stale).
  if (queue.length > 0) await checkNewAwards(users);

  let lastSyncAll = (await getMeta("lastSyncAll")) || "";
  if (!partial) {
    lastSyncAll = new Date().toISOString();
    await setMeta("lastSyncAll", lastSyncAll);
  }
  sortAndRankUsers(users);
  return { users, lastSyncAll, partial };
}

// POST sync-if-stale — called by the frontend whenever a member opens the
// board. This is what keeps the board fresh on Vercel, where there is no
// background job. Any signed-in member may call it because it only ever does the
// same real fetches a sync does, and only when the board is actually stale;
// fresh boards return immediately. A short-lived lock in the database stops
// simultaneous visitors (possibly on different serverless instances) from all
// scraping LeetCode at once.
app.post("/api/sync-if-stale", requireAuth, refreshLimiter, async (req, res) => {
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

// GET LeetCode sync health — admin only. One row per member WITH a LeetCode
// account (members without one have nothing to sync). Combines each member's
// last successful fetch (users.last_updated) with the outcome of the latest
// attempt (sync_status), so a member whose LeetCode account was removed or
// renamed shows up as "not_found" instead of just quietly going stale.
app.get("/api/admin/sync-status", requireAdmin, async (req, res) => {
  try {
    const [users, statuses, lastSyncAll] = await Promise.all([
      listUsers(),
      listSyncStatus(),
      getMeta("lastSyncAll")
    ]);

    const members: AdminSyncMember[] = leetcodeLinkedUsers(users).map((u) => {
      const s = statuses.get(u.id);
      return {
        id: u.id,
        displayName: u.displayName,
        loginUsername: u.loginUsername,
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

/* ---------- Notifications ---------- */
// Members read their own; admins send messages (see notificationRoutes.ts).
app.use("/api", notificationRoutes);

// Feedback: anyone can send it, admins read it (see feedbackRoutes.ts).
app.use("/api", feedbackRoutes);

// POST refresh all users — admin only
app.post("/api/refresh-all", refreshLimiter, requireAdmin, async (req, res) => {
  const admin = (req as any).user as { id: string; loginUsername: string };
  logSecurityEvent("admin_refresh", { ip: req.ip, adminId: admin.id, admin: admin.loginUsername, scope: "all" }, "info");
  try {
    const result = await syncAllUsers();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET aggregated monthly trend metrics (members only, like the board itself)
app.get("/api/trends", requireAuth, async (req, res) => {
  try {
    const users = await listUsers();

    // ?platform=codeforces: the same shape, built from that platform's linked
    // accounts only. Without the parameter this is the LeetCode trend below.
    if (req.query.platform !== undefined) {
      if (!isPlatformId(req.query.platform)) return res.status(400).json({ error: "Unknown platform." });
      return res.json(await buildPlatformTrend(req.query.platform, users));
    }

    // Group growth: how many problems the roster has solved SINCE TRACKING
    // BEGAN, not the sum of everyone's lifetime totals. Each member is measured
    // against their own first snapshot, so a newly added member contributes 0
    // on the day they join and only their later solves count.
    // Members without LeetCode have no LeetCode numbers to add to these.
    const board = leetcodeLinkedUsers(users);
    const allDates = new Set<string>();
    board.forEach(u => u.history.forEach(h => allDates.add(h.date)));
    const sortedDates = [...allDates].sort();

    const perUser = board
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
    board.forEach(u => {
      easyTotal += u.easySolved;
      mediumTotal += u.mediumSolved;
      hardTotal += u.hardSolved;
    });

    // Top solver of the week
    let topSolver = "None";
    let topCount = 0;
    board.forEach(u => {
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
      totalSolved: board.reduce((acc, u) => acc + u.allTimeSolved, 0)
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
    // Only the frontend build is ever served. `npm run build` puts it in
    // dist/client and the server bundle in server-dist/, which is NOT served:
    // before, both lived in dist/ and the whole backend was downloadable.
    const distPath = path.join(process.cwd(), "dist", "client");
    if (!fs.existsSync(path.join(distPath, "index.html"))) {
      // Not fatal: the API works without it (the tests rely on that), but
      // someone deploying would otherwise only see a blank 404 page.
      console.error(`[Config] No frontend build found in ${distPath}. Run "npm run build"; until then only the API works.`);
    }
    // Fatal: serving server code is the F3 leak itself.
    const leaked = fs.existsSync(distPath) ? findServerCode(distPath) : [];
    if (leaked.length > 0) {
      console.error(
        `[Config] Refusing to start: ${distPath} is served publicly but contains server code (${leaked.join(", ")}). ` +
          "Keep the server bundle and sourcemaps outside it."
      );
      process.exit(1);
    }
    app.use(express.static(distPath, { dotfiles: "ignore" }));
    app.get("/*splat", pageLimiter, (req, res) => {
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