import type { User } from "../../shared/types.js";

/**
 * Utility to calculate ranks and progress metrics.
 * The ranking is the LeetCode board, so only members with a LeetCode account
 * take part: they come first, by Weekly Progress (to encourage active, weekly
 * problem solving momentum!) and, in case of a tie, by All-Time solved counts.
 * Members without LeetCode follow, unranked (rank 0) and never ahead of
 * anyone, not even a linked member who has solved nothing yet.
 */
export function sortAndRankUsers(users: User[]): void {
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
