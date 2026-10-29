// Structured security-event logging.
//
// One JSON object per line on stdout/stderr, so Vercel (or any log drain /
// aggregator) can filter and alert on `"type":"security"` and on a specific
// `event`. Fields that could carry secrets are redacted by name before
// anything is printed, so a careless call site can't leak a password, a
// verification code, a cookie or a token into the logs.
//
// Events (see docs/security-operations.md for what to alert on):
//   login_failed, account_locked, login_blocked_locked, reauth_failed,
//   password_changed, account_deleted,
//   ownership_started, ownership_verified, ownership_failed,
//   ownership_lookup_unavailable,
//   ownership_blocked, password_reset_via_ownership,
//   platform_link_verified, platform_link_failed, admin_user_removed,
//   admin_refresh, admin_message_sent, feedback_received,
//   admin_feedback_deleted, csrf_blocked, rate_limited, session_rejected

export type SecurityEvent =
  | "login_failed"
  | "account_locked"
  | "login_blocked_locked"
  | "password_changed"
  | "reauth_failed"
  | "account_deleted"
  | "ownership_started"
  | "ownership_verified"
  | "ownership_failed"
  | "ownership_lookup_unavailable"
  | "ownership_blocked"
  | "password_reset_via_ownership"
  | "platform_link_verified"
  | "platform_link_failed"
  | "admin_user_removed"
  | "admin_refresh"
  | "admin_message_sent"
  | "feedback_received"
  | "admin_feedback_deleted"
  | "csrf_blocked"
  | "rate_limited";

const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|authorization|code|hash|session|jwt|key/i;
const MAX_VALUE_LENGTH = 200;

function clean(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  // Strip control characters (log injection) and cap the length.
  return String(value)
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, " ")
    .slice(0, MAX_VALUE_LENGTH);
}

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    out[name] = SENSITIVE_KEY.test(name) ? "[redacted]" : clean(value);
  }
  return out;
}

// `fields` should describe who/what/where (ip, userId, username, route,
// reason) — never request bodies.
export function logSecurityEvent(
  event: SecurityEvent,
  fields: Record<string, unknown> = {},
  level: "info" | "warn" = "warn"
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    type: "security",
    event,
    ...redact(fields)
  });
  (level === "warn" ? console.warn : console.info)(line);
}
