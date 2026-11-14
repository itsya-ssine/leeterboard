export const DAY_SECONDS = 86_400;
export const SESSION_MAX_AGE_DAYS = 7;
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export const JSON_BODY_LIMIT = "10kb";

// Upstream fetch timeouts (in milliseconds)
export const LEETCODE_TIMEOUT_MS = 4_000;
export const CODEFORCES_TIMEOUT_MS = 8_000;
export const CODINGAME_TIMEOUT_MS = 8_000;

// Distributed lease TTL
export const SYNC_LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Password reset / proof TTL
export const PENDING_ACTION_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_VERIFY_ATTEMPTS = 10;

// Account lockout & failed logins (SEC-08)
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
