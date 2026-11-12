// Pure helpers for "Sign in with Google / GitHub" (Authorization Code flow with
// PKCE). No network and no database in this file, so every rule here can be
// unit-tested; the routes (server.ts), the provider calls (oauthProviders.ts)
// and the database functions (db.ts) are built on top of it in later steps.
//
// The only Node dependency is `crypto`, for random values and SHA-256. Nothing
// here ever sees an access token or a client secret except `readOAuthConfig`,
// which hands the secrets back to the server and never prints them.
//
// Reminder of the rules this file supports (see the plan, "Account takeover
// rules"): a member is identified by (provider, provider user id), never by
// email; an email is only accepted when the provider says it is verified; and
// redirect targets are fixed, never taken from the request.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { checkEmail, normalizeEmail } from "./emails.js";

// ---------------------------------------------------------------------------
// Providers and error codes
// ---------------------------------------------------------------------------

export const OAUTH_PROVIDERS = ["github", "google"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The only values the callback may put in `/#/login?oauth_error=<code>`. The
 * browser maps each one to a friendly message; anything else is ignored, so a
 * crafted link can never make the page show text of an attacker's choosing.
 */
export const OAUTH_ERROR_CODES = [
  "cancelled",
  "failed",
  "unverified_email",
  "email_in_use",
  "domain_not_allowed",
  "expired",
  "unavailable",
  "admin_refused",
  "already_linked"
] as const;
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export function isOAuthErrorCode(value: unknown): value is OAuthErrorCode {
  return typeof value === "string" && (OAUTH_ERROR_CODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// PKCE and the `state` value
// ---------------------------------------------------------------------------

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url"); // URL-safe alphabet, no "=" padding
}

/**
 * A PKCE pair (RFC 7636, method S256). The verifier stays on the server (in the
 * oauth_states row); only the challenge goes to the provider. 32 random bytes
 * give a 43-character verifier, the shortest length the RFC allows and far more
 * entropy than needed.
 */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

const STATE_ID_RE = /^[0-9a-f]{32}$/;

/** A fresh state id: 128 random bits as 32 lowercase hex characters. */
export function newStateId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * True when the `oauth_state` cookie and the `state` query parameter are the
 * same well-formed state id. Compared in constant time. Anything that is not
 * exactly a 32-character lowercase hex string (missing, an array from a repeated
 * query parameter, the wrong length, other characters) is simply false: it never
 * throws, so a malformed request is an ordinary refusal.
 */
export function stateMatches(cookieValue: unknown, queryValue: unknown): boolean {
  if (typeof cookieValue !== "string" || typeof queryValue !== "string") return false;
  if (!STATE_ID_RE.test(cookieValue) || !STATE_ID_RE.test(queryValue)) return false;
  // Both are 32 ASCII characters, so the buffers have equal length, which
  // timingSafeEqual requires.
  return timingSafeEqual(Buffer.from(cookieValue, "utf8"), Buffer.from(queryValue, "utf8"));
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type OAuthProviderConfig = { clientId: string; clientSecret: string };

export type OAuthConfig = {
  /** The validated site origin (no trailing slash), or null when missing or refused. */
  publicUrl: string | null;
  /** Credentials of the providers that are fully configured AND usable (needs a valid publicUrl). */
  providers: Partial<Record<OAuthProvider, OAuthProviderConfig>>;
  /** The same providers as a list, in a stable order, for the UI and the routes. */
  enabled: OAuthProvider[];
  /**
   * Human-readable configuration problems, safe to log (they name variables,
   * never values). Empty when everything is fine, including "nothing configured".
   */
  problems: string[];
  /** The fixed callback URL registered with the provider, or null when publicUrl is unusable. */
  redirectUri(provider: OAuthProvider): string | null;
};

type Env = Record<string, string | undefined>;

const ENV_NAMES: Record<OAuthProvider, { id: string; secret: string }> = {
  github: { id: "GITHUB_CLIENT_ID", secret: "GITHUB_CLIENT_SECRET" },
  google: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" }
};

function clean(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validates PUBLIC_URL. It must be a bare origin: `https://host[:port]`, with no
 * path, no trailing slash, no query, no fragment and no credentials. In
 * production it must be https; outside production http is also accepted so
 * `http://localhost:3000` works. Comparing against `URL.origin` enforces all of
 * that at once (it also insists on a lowercase host and no default port).
 */
function checkPublicUrl(raw: string, production: boolean): { ok: true; url: string } | { ok: false; problem: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, problem: "PUBLIC_URL is not a valid URL." };
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && !production)) {
    return {
      ok: false,
      problem: production ? "PUBLIC_URL must start with https:// in production." : "PUBLIC_URL must start with http:// or https://."
    };
  }
  if (parsed.origin !== raw) {
    return {
      ok: false,
      problem: "PUBLIC_URL must be just the site origin, for example https://example.com (no path, no trailing slash, lowercase)."
    };
  }
  return { ok: true, url: raw };
}

/**
 * Reads the OAuth settings from the environment.
 *
 * - A provider is enabled only when BOTH its client id and secret are set, and
 *   PUBLIC_URL is valid (without it no redirect_uri can be built).
 * - A bad PUBLIC_URL does not throw: it switches every provider off and is
 *   reported in `problems`. Password login keeps working, which matters more
 *   than failing the whole boot. The server logs the problems once.
 * - `redirect_uri` is always built from PUBLIC_URL, never from the Host header.
 */
export function readOAuthConfig(env: Env): OAuthConfig {
  const production = env.NODE_ENV === "production";
  const problems: string[] = [];

  const rawUrl = clean(env.PUBLIC_URL);
  let publicUrl: string | null = null;
  if (rawUrl !== "") {
    const checked = checkPublicUrl(rawUrl, production);
    if (checked.ok) publicUrl = checked.url;
    else problems.push(checked.problem);
  }

  const providers: Partial<Record<OAuthProvider, OAuthProviderConfig>> = {};
  const enabled: OAuthProvider[] = [];
  for (const provider of OAUTH_PROVIDERS) {
    const names = ENV_NAMES[provider];
    const clientId = clean(env[names.id]);
    const clientSecret = clean(env[names.secret]);
    if (clientId === "" && clientSecret === "") continue; // not configured: simply off
    if (clientId === "" || clientSecret === "") {
      problems.push(`${names.id} and ${names.secret} must be set together; ${provider} sign-in is off.`);
      continue;
    }
    if (publicUrl === null) {
      if (rawUrl === "") problems.push(`PUBLIC_URL is required for ${provider} sign-in; it is off.`);
      continue; // an invalid PUBLIC_URL was already reported above
    }
    providers[provider] = { clientId, clientSecret };
    enabled.push(provider);
  }

  return {
    publicUrl,
    providers,
    enabled,
    problems,
    redirectUri(provider) {
      return publicUrl === null ? null : `${publicUrl}/api/auth/oauth/${provider}/callback`;
    }
  };
}

// ---------------------------------------------------------------------------
// The authorize URL
// ---------------------------------------------------------------------------

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export type AuthorizeParams = {
  state: string;
  challenge: string;
  redirectUri: string;
  clientId: string;
};

/**
 * The URL the browser is sent to so the member can approve the sign-in. Every
 * value is added through URLSearchParams, so nothing is concatenated by hand
 * and nothing needs manual escaping.
 */
export function buildAuthorizeUrl(provider: OAuthProvider, params: AuthorizeParams): string {
  const query = new URLSearchParams();
  query.set("client_id", params.clientId);
  query.set("redirect_uri", params.redirectUri);
  query.set("state", params.state);
  query.set("code_challenge", params.challenge);
  query.set("code_challenge_method", "S256");
  if (provider === "github") {
    query.set("scope", "read:user user:email");
    return `${GITHUB_AUTHORIZE_URL}?${query.toString()}`;
  }
  query.set("response_type", "code");
  query.set("scope", "openid email profile");
  query.set("prompt", "select_account");
  return `${GOOGLE_AUTHORIZE_URL}?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// Reading what the providers send back
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keeps an address only if it is a well-formed, plain-ASCII address (the same
 * strict rules as the rest of the site), in stored form: trimmed and lowercase.
 * The address ends up in the database and, masked, in logs, so an odd value is
 * refused rather than repaired.
 */
function usableEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const checked = checkEmail(normalizeEmail(value));
  return checked.ok ? checked.email : null;
}

/**
 * From GitHub's `/user/emails` answer, the address that is BOTH primary and
 * verified, or null. A verified non-primary address is not used: the member may
 * have stopped using it, and "primary" is the one GitHub itself treats as theirs.
 */
export function pickGithubEmail(list: unknown): string | null {
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    if (entry.primary !== true || entry.verified !== true) continue;
    const email = usableEmail(entry.email);
    if (email !== null) return email;
  }
  return null;
}

const PROVIDER_USER_ID_MAX_LENGTH = 255; // Google documents "sub" as at most 255 ASCII characters
const PROVIDER_USER_ID_RE = /^[A-Za-z0-9_.-]+$/;
const DISPLAY_NAME_MAX_LENGTH = 40; // same limit as a member's display name in server.ts

/**
 * A provider's name for the person, cleaned the way server.ts cleans a display
 * name (control characters dropped, whitespace collapsed, at most 40 characters),
 * or null when there is nothing usable. It is only a suggestion: the member can
 * change it on the username screen.
 */
export function cleanSuggestedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DISPLAY_NAME_MAX_LENGTH)
    .trim();
  return cleaned === "" ? null : cleaned;
}

export type OAuthProfile = {
  providerUserId: string;
  email: string;
  displayName: string | null;
};

/**
 * Reads Google's userinfo answer. Requires a `sub` (Google's stable user id) and
 * `email_verified` equal to the boolean `true`; a string "true", a missing field
 * or a false value is refused, because an unverified address proves nothing.
 * Returns null on any problem; the caller turns that into `unverified_email`
 * or `failed`.
 */
export function parseGoogleUserinfo(json: unknown): OAuthProfile | null {
  if (!isRecord(json)) return null;
  const sub = json.sub;
  if (
    typeof sub !== "string" ||
    sub.length === 0 ||
    sub.length > PROVIDER_USER_ID_MAX_LENGTH ||
    !PROVIDER_USER_ID_RE.test(sub)
  ) {
    return null;
  }
  if (json.email_verified !== true) return null;
  const email = usableEmail(json.email);
  if (email === null) return null;
  return { providerUserId: sub, email, displayName: cleanSuggestedName(json.name) };
}

// ---------------------------------------------------------------------------
// Email domain restriction (ALLOWED_EMAIL_DOMAINS)
// ---------------------------------------------------------------------------

/**
 * True when the address's domain is allowed. `allowedDomains` is the list from
 * `parseAllowedDomains` (lowercase, no "@"): empty means any domain, otherwise
 * the domain must equal one entry exactly ("school.edu" does not allow
 * "mail.school.edu"). An address without a domain is never allowed when a list
 * is set.
 */
export function checkEmailDomain(email: string, allowedDomains: readonly string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return false;
  return allowedDomains.includes(email.slice(at + 1).toLowerCase());
}
