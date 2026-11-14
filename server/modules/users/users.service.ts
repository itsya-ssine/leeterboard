import type { PlatformAccount, PlatformId, User } from "../../../shared/types.js";
import {
  deleteUserById,
  getMeta,
  getUserById,
  listUsers,
  setMeta,
  updateDisplayName,
  updateProfileDetails,
  updateSchool,
  type ProfileDetailsUpdate
} from "../../../db.js";
import { computeWeeklyWinners, mergeWinnerArchive, parseWinnerArchive, type WeeklyWinner } from "../../../shared/winners.js";
import { leetcodeLinkedUsers } from "../../../db.js";

export const WINNERS_META_KEY = "weeklyWinners";

export interface Viewer {
  id: string | null;
  isAdmin: boolean;
}

export function withVisiblePlatforms<T extends { id: string; platforms?: Partial<Record<PlatformId, PlatformAccount>> }>(
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
    const { daily: _daily, ...rest } = account.extra as Record<string, unknown>;
    platforms[id] = { ...account, extra: rest };
  }
  return { ...user, platforms };
}

export async function resolveWinners(users: User[]): Promise<WeeklyWinner[]> {
  if (users.length === 0) return [];
  try {
    const stored = parseWinnerArchive(await getMeta(WINNERS_META_KEY));
    const merged = mergeWinnerArchive(stored, computeWeeklyWinners(leetcodeLinkedUsers(users), Date.now()));
    const ids = new Set(users.map((u) => u.id));
    const kept = merged.filter((w) => ids.has(w.userId));
    if (JSON.stringify(kept) !== JSON.stringify(stored)) {
      await setMeta(WINNERS_META_KEY, JSON.stringify(kept));
    }
    return kept;
  } catch (err: any) {
    console.warn(`[Winners] Couldn't resolve weekly winners: ${err.message}`);
    return [];
  }
}

export {
  deleteUserById,
  getUserById,
  listUsers,
  updateDisplayName,
  updateProfileDetails,
  updateSchool,
  type ProfileDetailsUpdate
};
