import type { User } from "../../../shared/types.js";
import {
  acquireLease,
  getMeta,
  getPlatformAccounts,
  getUserById,
  leetcodeLinkedUsers,
  listUsers,
  loadPlatformsByUser,
  recordSyncResult,
  releaseLease,
  setMeta,
  updateUser
} from "../../../db.js";
import { notifyNewAwards } from "../../../notifications.js";
import { syncAllPlatformAccounts, syncPlatformAccountsForUser } from "../../../platformSync.js";
import {
  computeProgressFromHistory,
  computeWeeklyProgressFromHistory,
  baselineOf
} from "../../domain/progress.js";
import { sortAndRankUsers } from "../../domain/ranking.js";
import {
  fetchContestRating,
  fetchStreaks,
  scrapeLeetCodeProfile,
  type ContestRating
} from "../../platforms/leetcode/scraper.js";
import { LeetCodeUserNotFoundError } from "../../platforms/leetcode/errors.js";
import { resolveWinners } from "../users/users.service.js";
import type { StreakInfo } from "../../../streaks.js";

export const AUTO_SYNC_STALE_MS = 1000 * 60 * 30; // 30 minutes
export const AUTO_SYNC_BUDGET_MS = Number(process.env.SYNC_BUDGET_MS) || 8000;

export async function checkNewAwards(users?: User[]): Promise<void> {
  try {
    const board = users ?? (await listUsers());
    await notifyNewAwards(leetcodeLinkedUsers(board), await resolveWinners(board));
  } catch (err: any) {
    console.warn(`[Notifications] Award check failed: ${err.message}`);
  }
}

export interface SyncOptions {
  onlyStaleMs?: number;
  budgetMs?: number;
}

export async function syncAllUsers(
  opts: SyncOptions = {}
): Promise<{ users: User[]; lastSyncAll: string; partial: boolean }> {
  const users = await listUsers();
  const onBoard = leetcodeLinkedUsers(users);
  let queue = onBoard;

  if (opts.onlyStaleMs !== undefined) {
    const cutoff = Date.now() - opts.onlyStaleMs;
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

      const todayStr = new Date().toISOString().split("T")[0];
      const histIndex = user.history.findIndex((h) => h.date === todayStr);
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
      console.warn(`[Sync All] Skipping ${user.loginUsername}: ${err.message}`);
      await recordSyncResult(user.id, {
        ok: false,
        state: err instanceof LeetCodeUserNotFoundError ? "not_found" : "unavailable",
        error: err.message
      });
    }
  }

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

  if (queue.length > 0) await checkNewAwards(users);

  let lastSyncAll = (await getMeta("lastSyncAll")) || "";
  if (!partial) {
    lastSyncAll = new Date().toISOString();
    await setMeta("lastSyncAll", lastSyncAll);
  }
  sortAndRankUsers(users);
  return { users, lastSyncAll, partial };
}

export async function syncSingleUser(userId: string): Promise<User> {
  const user = await getUserById(userId);
  if (!user) throw new Error("User not found.");

  if (!user.leetcodeLinked) {
    try {
      await syncPlatformAccountsForUser(user.id);
    } catch (err: any) {
      console.warn(`[Refresh] Linked accounts failed for ${user.displayName}: ${err.message}`);
    }
    user.platforms = await getPlatformAccounts(user.id);
    return user;
  }

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

  const todayStr = new Date().toISOString().split("T")[0];
  const existingHistoryIndex = user.history.findIndex((h) => h.date === todayStr);

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
    if (user.history.length > 60) {
      user.history.shift();
    }
  }

  await updateUser(user);
  await recordSyncResult(user.id, { ok: true });
  await checkNewAwards();

  try {
    await syncPlatformAccountsForUser(user.id);
  } catch (err: any) {
    console.warn(`[Refresh] Linked accounts failed for ${user.loginUsername}: ${err.message}`);
  }
  user.platforms = await getPlatformAccounts(user.id);
  return user;
}
