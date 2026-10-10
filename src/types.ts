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