import type { PlatformId, User } from "../../../types.js";

// The three accounts a member can link. All optional.
export type LinkId = PlatformId | "leetcode";

// What an account row shows about a linked account, whichever platform it is.
export type RowAccount = {
  handle: string;
  solved: number;
  rating: number | null;
  rankTitle: string | null;
  lastUpdated: string | null;
  hidden: boolean;
};

// LeetCode's data lives on the member itself, the others in `platforms`.
export function rowAccountFor(user: User, platform: LinkId): RowAccount | undefined {
  if (platform === "leetcode") {
    if (!user.leetcodeLinked) return undefined;
    return {
      handle: user.leetcodeUsername,
      solved: user.allTimeSolved,
      rating: user.contestRating,
      rankTitle: null,
      lastUpdated: user.lastUpdated,
      hidden: !!user.hideLeetcodeStats
    };
  }
  return user.platforms?.[platform];
}

// The LeetCode board is the members who linked LeetCode, in the order given.
// Everything about LeetCode (ranks, totals, compare) is computed from this list,
// never from every member.
export function leetcodeMembers(members: User[]): User[] {
  return members.filter((u) => u.leetcodeLinked);
}

// A member who linked nothing yet: on no board, nothing to show on a profile.
// Different from hiding everything, where accounts exist but are kept private.
export function hasNothingLinked(user: User): boolean {
  return !user.leetcodeLinked && !user.platforms?.codeforces && !user.platforms?.codingame;
}
