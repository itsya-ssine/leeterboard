export interface HistoryRecord {
  date: string; // ISO format YYYY-MM-DD
  solvedCount: number;
  easy: number;
  medium: number;
  hard: number;
  weeklyProgress: number; // problems solved in that week/relative to start
}

export interface User {
  id: string;
  displayName: string;
  leetcodeUsername: string;
  avatarUrl: string;
  allTimeSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  weeklyProgress: number; // count solved in last 7 days
  monthlyProgress: number; // count solved in last 30 days
  rank: number;
  // LeetCode contest rating (rounded). null = unrated: never entered a
  // contest, or we haven't managed to fetch one yet.
  contestRating: number | null;
  contestsAttended: number;
  // Daily-submission streaks as reported by LeetCode itself (days with at
  // least one submission, UTC). null = not fetched yet — distinct from 0.
  currentStreak: number | null;
  longestStreak: number | null;
  lastUpdated: string;
  history: HistoryRecord[];
  // 1 = the earliest member still on the board, 2 = the next to join, and so
  // on. Set by listUsers() from insertion order; absent on records loaded any
  // other way.
  joinOrder?: number;
  isPinned?: boolean;
  // Present only on the currently-authenticated user's own record (see
  // /api/auth/session, /api/auth/login and /api/auth/register/verify) —
  // never trust a client-supplied value for this, it's always derived
  // server-side from the admin list in auth.ts.
  isAdmin?: boolean;
}

export interface LeaderboardStats {
  totalSolved: number;
  avgSolved: number;
  activeUsers: number;
  topSolverThisWeek: string;
  topSolverThisWeekCount: number;
  weeklyVelocity: number;
}

// Outcome of the most recent attempt to fetch a member's LeetCode stats.
//   ok          - the fetch worked
//   unavailable - LeetCode didn't answer (timeout, rate limit, outage); we
//                 don't know anything about the account
//   not_found   - LeetCode positively says the username doesn't exist, which
//                 means the account was removed or renamed
export type SyncState = "ok" | "unavailable" | "not_found";

// One member as the admin dashboard sees them. "unknown" means no attempt has
// been recorded yet (e.g. the member predates sync tracking).
export interface AdminSyncMember {
  id: string;
  displayName: string;
  leetcodeUsername: string;
  avatarUrl: string;
  lastUpdated: string; // last *successful* fetch
  lastAttempt: string | null;
  state: SyncState | "unknown";
  error: string | null;
  failures: number; // consecutive failed attempts
  failingSince: string | null;
}

export interface AdminSyncReport {
  generatedAt: string;
  lastSyncAll: string;
  members: AdminSyncMember[];
}