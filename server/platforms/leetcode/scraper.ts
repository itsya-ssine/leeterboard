import { safeAvatar } from "../../utils/avatar.js";
import { executeLeetCodeGraphQL } from "../../../leetcodeClient.js";
import { DAY_SECONDS, parseSubmissionCalendar, streaksFromDays, type StreakInfo } from "../../../streaks.js";
import { LeetCodeUserNotFoundError, LeetCodeUnavailableError } from "./errors.js";

export interface LeetCodeScrapeResult {
  allTimeSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  source: string;
  avatarUrl?: string;
}

export interface ContestRating {
  rating: number;
  attended: number;
}

export type ContestLookup = ContestRating | "unrated" | "failed";

export { fetchLeetCodeAbout, type AboutLookup } from "../../../server.js";

export function toContestRating(ranking: any): ContestRating | null {
  if (!ranking || typeof ranking.rating !== "number" || !Number.isFinite(ranking.rating)) return null;
  return { rating: Math.round(ranking.rating), attended: Number(ranking.attendedContestsCount) || 0 };
}

export async function scrapeLeetCodeProfile(username: string): Promise<LeetCodeScrapeResult> {
  const cleanUsername = username.trim();
  let confirmedNotFound = false;

  // 1. Official LeetCode GraphQL endpoint
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

    const res = await executeLeetCodeGraphQL<{ matchedUser?: any }>(query, { username: cleanUsername });

    if (res.ok) {
      const matchedUser = res.data?.matchedUser;

      if (matchedUser === null) {
        confirmedNotFound = true;
      } else {
        const acSubmissions = matchedUser?.submitStatsGlobal?.acSubmissionNum;
        if (acSubmissions && acSubmissions.length > 0) {
          const all = acSubmissions.find((x: any) => x.difficulty === "All")?.count || 0;
          const easy = acSubmissions.find((x: any) => x.difficulty === "Easy")?.count || 0;
          const medium = acSubmissions.find((x: any) => x.difficulty === "Medium")?.count || 0;
          const hard = acSubmissions.find((x: any) => x.difficulty === "Hard")?.count || 0;

          const avatarUrl = safeAvatar(matchedUser?.profile?.userAvatar);

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
    } else {
      console.warn(`[Fetch] Official LeetCode GraphQL failed/timed out: ${res.error}`);
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
        const avatarUrl = safeAvatar(data.avatar);
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

  if (confirmedNotFound) {
    throw new LeetCodeUserNotFoundError(cleanUsername);
  }
  throw new LeetCodeUnavailableError(cleanUsername);
}

export async function fetchContestFromGraphQL(username: string): Promise<ContestLookup> {
  try {
    const query = `
      query userContestRankingInfo($username: String!) {
        userContestRanking(username: $username) {
          attendedContestsCount
          rating
        }
      }
    `;

    const res = await executeLeetCodeGraphQL<{ userContestRanking?: any }>(query, { username: username.trim() });
    if (!res.ok) {
      console.warn(`[Contest] LeetCode GraphQL failed for ${username}: ${res.error}`);
      return "failed";
    }

    const ranking = res.data?.userContestRanking;
    if (ranking === null) return "unrated";
    const rated = toContestRating(ranking);
    if (rated) return rated;

    console.warn(`[Contest] LeetCode GraphQL returned an unrecognised shape for ${username}`);
    return "failed";
  } catch (err: any) {
    console.warn(`[Contest] LeetCode GraphQL failed for ${username}: ${err.message}`);
    return "failed";
  }
}

export async function fetchContestFromAlfa(username: string): Promise<ContestLookup> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`https://alfa-leetcode-api.onrender.com/userContestRankingInfo/${encodeURIComponent(username.trim())}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.status === 404) return "unrated";
    if (!res.ok) {
      console.warn(`[Contest] Alfa proxy HTTP ${res.status} for ${username}`);
      return "failed";
    }

    const json = await res.json();
    const ranking = json?.data?.userContestRanking ?? json?.userContestRanking ?? json;
    if (ranking === null || json?.data?.userContestRanking === null) return "unrated";
    const rated = toContestRating(ranking);
    if (rated) return rated;

    console.warn(`[Contest] Alfa proxy returned an unrecognised shape for ${username}`);
    return "failed";
  } catch (err: any) {
    console.warn(`[Contest] Alfa proxy failed for ${username}: ${err.message}`);
    return "failed";
  }
}

export async function fetchContestRating(username: string): Promise<ContestRating | null> {
  const fromGql = await fetchContestFromGraphQL(username);
  if (fromGql !== "failed") return fromGql === "unrated" ? null : fromGql;

  const fromAlfa = await fetchContestFromAlfa(username);
  if (fromAlfa !== "failed") return fromAlfa === "unrated" ? null : fromAlfa;

  return null;
}

export async function fetchCalendarYear(
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

    const res = await executeLeetCodeGraphQL<{ matchedUser?: { userCalendar?: any } }>(query, {
      username: username.trim(),
      year: year ?? null
    });

    if (!res.ok) {
      console.warn(`[Streak] LeetCode GraphQL failed for ${username}: ${res.error}`);
      return null;
    }

    const cal = res.data?.matchedUser?.userCalendar;
    if (!cal) {
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

export async function fetchStreaks(username: string, knownLongest: number | null): Promise<StreakInfo | null> {
  const first = await fetchCalendarYear(username);
  if (!first) return null;

  const thisYear = new Date().getUTCFullYear();
  const days = new Set<number>(first.days);

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


