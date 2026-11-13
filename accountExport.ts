// "Download my data": everything the database holds about ONE member, as a
// single JSON document they can keep, read or move elsewhere.
//
// It is built for the signed-in member only (the route takes the id from the
// session, never from the request). Each table is read with an explicit column
// list, so a column added to the schema later is NOT exported until someone
// decides it belongs here. What is deliberately left out, and why:
//   - password hash, failed-login counter and lock time (credentials / security state)
//   - one-time ownership codes and sign-in handshakes (pending_links, pending_resets,
//     oauth_states, pending_oauth_signups): short-lived secrets, not profile data
//   - rate-limit counters (keyed by IP, not by member)
//   - who sent an admin message and its broadcast id (another person's identifier)
//   - whether an admin has read your feedback (admin bookkeeping)
// The list is repeated inside the file (`notIncluded`) so the member can see it.

import { client } from "./db.js";

export const EXPORT_FORMAT = "leeterboard-export";
export const EXPORT_VERSION = 1;

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const flag = (v: unknown): boolean => Number(v) === 1;

// The `extra` column holds platform-specific JSON (e.g. Codeforces difficulty
// buckets). A malformed value is exported as an empty object, never as a crash.
function parseExtra(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const NOT_INCLUDED = [
  "Your password hash and login-attempt counters (security data).",
  "One-time verification codes and sign-in handshakes (short-lived secrets).",
  "Rate-limit counters (kept per IP address, not per member).",
  "The identity of the admin who sent you a message, and whether an admin has read your feedback.",
  "Access tokens from Google or GitHub: we never store them."
] as const;

export interface AccountExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  account: {
    id: string;
    username: string;
    displayName: string;
    email: string | null;
    emailVerifiedAt: string | null;
    school: string;
    bio: string;
    githubUrl: string;
    linkedinUrl: string;
    websiteUrl: string;
    hideLeetcodeStats: boolean;
  };
  signIn: {
    hasPassword: boolean;
    providers: { provider: string; providerUserId: string; connectedAt: string | null }[];
  };
  leetcode: null | {
    username: string;
    avatarUrl: string | null;
    trackingStart: string;
    baselineSolved: number;
    lastUpdated: string | null;
    current: {
      solved: number;
      easy: number;
      medium: number;
      hard: number;
      weeklyProgress: number;
      monthlyProgress: number;
      contestRating: number | null;
      contestsAttended: number;
      currentStreak: number | null;
      longestStreak: number | null;
    };
    history: {
      date: string;
      solved: number;
      easy: number;
      medium: number;
      hard: number;
      weeklyProgress: number;
    }[];
  };
  platforms: {
    platform: string;
    handle: string;
    linkedAt: string | null;
    lastUpdated: string | null;
    hiddenFromOthers: boolean;
    current: {
      solved: number;
      weeklySolved: number;
      monthlySolved: number;
      rating: number | null;
      maxRating: number | null;
      rankTitle: string | null;
      contests: number;
      avatarUrl: string | null;
    };
    extra: Record<string, unknown>;
    history: { date: string; solved: number; rating: number | null }[];
  }[];
  awards: { key: string; awardedAt: string }[];
  notifications: {
    id: string;
    type: string;
    title: string;
    body: string;
    createdAt: string;
    readAt: string | null;
    dismissedAt: string | null;
  }[];
  feedback: { id: string; category: string; message: string; page: string; createdAt: string }[];
  syncStatus: {
    leetcode: null | { lastAttempt: string; state: string; error: string | null; failures: number; failingSince: string | null };
    platforms: {
      platform: string;
      lastAttempt: string;
      state: string;
      error: string | null;
      failures: number;
      failingSince: string | null;
    }[];
  };
  notIncluded: readonly string[];
}

/** Everything held about this member, or null if the account no longer exists. */
export async function buildAccountExport(userId: string, now: Date = new Date()): Promise<AccountExport | null> {
  // One batch is one consistent read, so the pieces can't disagree with each other.
  const [userRes, historyRes, syncRes, platformRes, platformHistoryRes, platformSyncRes, oauthRes, awardsRes, notesRes, feedbackRes] =
    await client.batch(
      [
        {
          // Explicit columns: password_hash, failed_logins and locked_until are never selected.
          // has_password only says whether a hash in the format auth.ts produces exists.
          sql: `SELECT id, login_username, display_name, email, email_verified_at, school, bio,
                       github_url, linkedin_url, website_url, hide_leetcode_stats,
                       leetcode_username, avatar_url, tracking_start, baseline_solved, last_updated,
                       all_time_solved, easy_solved, medium_solved, hard_solved,
                       weekly_progress, monthly_progress, contest_rating, contests_attended,
                       current_streak, longest_streak,
                       CASE WHEN password_hash LIKE 'scrypt$%' THEN 1 ELSE 0 END AS has_password
                  FROM users WHERE id = ?`,
          args: [userId]
        },
        {
          sql: `SELECT date, solved_count, easy_solved, medium_solved, hard_solved, weekly_progress
                  FROM history WHERE user_id = ? ORDER BY date`,
          args: [userId]
        },
        {
          sql: `SELECT last_attempt, state, error, failures, failing_since FROM sync_status WHERE user_id = ?`,
          args: [userId]
        },
        {
          sql: `SELECT platform, handle, solved, weekly_solved, monthly_solved, rating, max_rating, rank_title,
                       contests, avatar_url, extra, linked_at, last_updated, hidden
                  FROM platform_accounts WHERE user_id = ? ORDER BY platform`,
          args: [userId]
        },
        {
          sql: `SELECT platform, date, solved, rating FROM platform_history WHERE user_id = ? ORDER BY platform, date`,
          args: [userId]
        },
        {
          sql: `SELECT platform, last_attempt, state, error, failures, failing_since
                  FROM platform_sync_status WHERE user_id = ? ORDER BY platform`,
          args: [userId]
        },
        {
          sql: `SELECT provider, provider_user_id, created_at FROM oauth_identities WHERE user_id = ? ORDER BY provider`,
          args: [userId]
        },
        {
          // '_baseline' is a silent internal marker, not something the member earned.
          sql: `SELECT award_key, awarded_at FROM user_awards
                 WHERE user_id = ? AND award_key <> '_baseline' ORDER BY awarded_at, award_key`,
          args: [userId]
        },
        {
          // Dismissed notifications are only hidden from the member, so they are still held, and still exported.
          sql: `SELECT id, type, title, body, created_at, read_at, dismissed_at
                  FROM notifications WHERE user_id = ? ORDER BY created_at, id`,
          args: [userId]
        },
        {
          sql: `SELECT id, category, message, page, created_at FROM feedback WHERE user_id = ? ORDER BY created_at, id`,
          args: [userId]
        }
      ],
      "read"
    );

  const u = userRes.rows[0] as unknown as Row | undefined;
  if (!u) return null;

  const rows = (r: { rows: unknown[] }) => r.rows as unknown as Row[];

  const platformHistory = new Map<string, AccountExport["platforms"][number]["history"]>();
  for (const r of rows(platformHistoryRes)) {
    const platform = String(r.platform);
    const list = platformHistory.get(platform) ?? [];
    list.push({ date: String(r.date), solved: Number(r.solved), rating: num(r.rating) });
    platformHistory.set(platform, list);
  }

  const leetcodeUsername = str(u.leetcode_username);
  const lcSync = rows(syncRes)[0];

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    account: {
      id: String(u.id),
      username: str(u.login_username) ?? "",
      displayName: String(u.display_name),
      email: str(u.email) || null,
      emailVerifiedAt: str(u.email_verified_at),
      school: String(u.school ?? ""),
      bio: String(u.bio ?? ""),
      githubUrl: String(u.github_url ?? ""),
      linkedinUrl: String(u.linkedin_url ?? ""),
      websiteUrl: String(u.website_url ?? ""),
      hideLeetcodeStats: flag(u.hide_leetcode_stats)
    },
    signIn: {
      hasPassword: flag(u.has_password),
      providers: rows(oauthRes).map((r) => ({
        provider: String(r.provider),
        providerUserId: String(r.provider_user_id),
        connectedAt: str(r.created_at)
      }))
    },
    leetcode: leetcodeUsername
      ? {
          username: leetcodeUsername,
          avatarUrl: str(u.avatar_url),
          trackingStart: String(u.tracking_start ?? ""),
          baselineSolved: Number(u.baseline_solved ?? 0),
          lastUpdated: str(u.last_updated),
          current: {
            solved: Number(u.all_time_solved),
            easy: Number(u.easy_solved),
            medium: Number(u.medium_solved),
            hard: Number(u.hard_solved),
            weeklyProgress: Number(u.weekly_progress),
            monthlyProgress: Number(u.monthly_progress),
            contestRating: num(u.contest_rating),
            contestsAttended: Number(u.contests_attended),
            currentStreak: num(u.current_streak),
            longestStreak: num(u.longest_streak)
          },
          history: rows(historyRes).map((r) => ({
            date: String(r.date),
            solved: Number(r.solved_count),
            easy: Number(r.easy_solved),
            medium: Number(r.medium_solved),
            hard: Number(r.hard_solved),
            weeklyProgress: Number(r.weekly_progress)
          }))
        }
      : null,
    platforms: rows(platformRes).map((r) => ({
      platform: String(r.platform),
      handle: String(r.handle),
      linkedAt: str(r.linked_at),
      lastUpdated: str(r.last_updated),
      hiddenFromOthers: flag(r.hidden),
      current: {
        solved: Number(r.solved),
        weeklySolved: Number(r.weekly_solved),
        monthlySolved: Number(r.monthly_solved),
        rating: num(r.rating),
        maxRating: num(r.max_rating),
        rankTitle: str(r.rank_title),
        contests: Number(r.contests),
        avatarUrl: str(r.avatar_url)
      },
      extra: parseExtra(r.extra),
      history: platformHistory.get(String(r.platform)) ?? []
    })),
    awards: rows(awardsRes).map((r) => ({ key: String(r.award_key), awardedAt: String(r.awarded_at) })),
    notifications: rows(notesRes).map((r) => ({
      id: String(r.id),
      type: String(r.type),
      title: String(r.title),
      body: String(r.body ?? ""),
      createdAt: String(r.created_at),
      readAt: str(r.read_at),
      dismissedAt: str(r.dismissed_at)
    })),
    feedback: rows(feedbackRes).map((r) => ({
      id: String(r.id),
      category: String(r.category),
      message: String(r.message),
      page: String(r.page ?? ""),
      createdAt: String(r.created_at)
    })),
    syncStatus: {
      leetcode: lcSync
        ? {
            lastAttempt: String(lcSync.last_attempt),
            state: String(lcSync.state),
            error: str(lcSync.error),
            failures: Number(lcSync.failures),
            failingSince: str(lcSync.failing_since)
          }
        : null,
      platforms: rows(platformSyncRes).map((r) => ({
        platform: String(r.platform),
        lastAttempt: String(r.last_attempt),
        state: String(r.state),
        error: str(r.error),
        failures: Number(r.failures),
        failingSince: str(r.failing_since)
      }))
    },
    notIncluded: NOT_INCLUDED
  };
}

/** A safe download name: leeterboard-<username>-YYYY-MM-DD.json */
export function exportFileName(username: string, now: Date = new Date()): string {
  const safe = username.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "member";
  return `leeterboard-${safe}-${now.toISOString().slice(0, 10)}.json`;
}
