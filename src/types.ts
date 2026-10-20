export interface HistoryRecord {
  date: string; // ISO format YYYY-MM-DD
  solvedCount: number;
  easy: number;
  medium: number;
  hard: number;
  weeklyProgress: number; // weekly counter as of that day
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
  weeklyProgress: number; // solved so far this calendar week (Monday-Sunday, UTC)
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
  // The UTC day (YYYY-MM-DD) the member joined the board and their all-time
  // solved count at that moment. Everything solved before joining is
  // "baseline"; progress is only ever counted on top of it, starting from the
  // joining day itself.
  trackingStart: string;
  baselineSolved: number;
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

// What a notification is about. "badge" and "achievement" are created by the
// server when a member earns something; "admin" is a message an admin sent.
export type NotificationType = "badge" | "achievement" | "admin";

// Named AppNotification so it doesn't shadow the browser's built-in
// Notification API.
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

// What GET /api/notifications returns: the member's newest notifications plus
// their total unread count (which can be larger than the list).
export interface NotificationFeed {
  notifications: AppNotification[];
  unread: number;
}

// One message an admin sent, as the admin page lists it. A broadcast is a
// single entry no matter how many members received it.
export interface SentMessage {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  recipients: number;
  read: number;
  // Name of the member when it went to a single person, null for a broadcast.
  recipientName: string | null;
}