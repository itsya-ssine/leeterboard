// The server-to-server half of "Sign in with Google / GitHub": trade the
// authorization `code` for the member's profile, and nothing else.
//
// What this file promises:
//   * The access token lives in one local variable of one function call. It is
//     never stored, returned, logged, or put in an error. Same for the client
//     secret, the code and the PKCE verifier.
//   * Every call has an 8 second timeout (covering the body too), is never
//     retried, and never follows a redirect: the endpoints are fixed constants,
//     so a 3xx is just a failure, not a way to be sent to another host.
//   * Errors are `OAuthError` with a fixed message and one of three kinds
//     (`failed`, `unavailable`, `unverified_email`). Text from the provider is
//     never copied into an error, so it can't reach a log or a redirect.
//   * An address is accepted only if the provider says it is verified (see
//     pickGithubEmail / parseGoogleUserinfo in oauth.ts).
//
// Nothing here reads process.env or logs. The caller passes the credentials in,
// and decides what to do with an OAuthError.
//
// The second half of the file is the development override
// OAUTH_DEV_PROVIDER_URL, and the boot check that refuses it in production.

import {
  cleanSuggestedName,
  parseGoogleUserinfo,
  pickGithubEmail,
  type OAuthErrorCode,
  type OAuthProfile,
  type OAuthProvider
} from "./oauth.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type OAuthExchangeErrorKind = Extract<OAuthErrorCode, "failed" | "unavailable" | "unverified_email">;

const ERROR_MESSAGES: Record<OAuthExchangeErrorKind, string> = {
  failed: "The sign-in provider's answer could not be used.",
  unavailable: "The sign-in provider did not answer in time.",
  unverified_email: "The sign-in provider has no verified email for this account."
};

export class OAuthError extends Error {
  readonly kind: OAuthExchangeErrorKind;
  constructor(kind: OAuthExchangeErrorKind) {
    super(ERROR_MESSAGES[kind]); // fixed text on purpose: never provider text, never a secret
    this.name = "OAuthError";
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export type OAuthEndpoints = { token: string; user: string; emails: string | null };

/**
 * Where each provider is called. With `devBaseUrl` (development override, see
 * decideOAuthDev) every endpoint is read from that base instead, under
 * `/github/...` and `/google/...`.
 */
export function oauthEndpoints(provider: OAuthProvider, devBaseUrl: string | null = null): OAuthEndpoints {
  if (devBaseUrl) {
    const base = devBaseUrl.replace(/\/+$/, "");
    return provider === "github"
      ? {
          token: `${base}/github/login/oauth/access_token`,
          user: `${base}/github/user`,
          emails: `${base}/github/user/emails`
        }
      : { token: `${base}/google/token`, user: `${base}/google/userinfo`, emails: null };
  }
  return provider === "github"
    ? {
        token: "https://github.com/login/oauth/access_token",
        user: "https://api.github.com/user",
        emails: "https://api.github.com/user/emails"
      }
    : {
        token: "https://oauth2.googleapis.com/token",
        user: "https://openidconnect.googleapis.com/v1/userinfo",
        emails: null
      };
}

// ---------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------

export const OAUTH_REQUEST_TIMEOUT_MS = 8000;
const MAX_RESPONSE_CHARS = 256 * 1024; // a profile is a few hundred bytes; this is only a sanity cap
const USER_AGENT = "leeterboard-oauth"; // GitHub rejects API calls without a User-Agent

export type ExchangeConfig = {
  clientId: string;
  clientSecret: string;
  /** The exact redirect_uri used at the start (oauth.ts: config.redirectUri(provider)). */
  redirectUri: string;
  /** From decideOAuthDev(); null in production by construction. */
  devBaseUrl?: string | null;
};

export type ExchangeDeps = {
  /** For tests. Defaults to the global fetch (which the test fakes replace). */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

// The code arrives in a query string, so it is untrusted input: printable ASCII,
// no spaces, bounded. The verifier is ours (PKCE: 43 to 128 unreserved characters).
const CODE_RE = /^[\x21-\x7e]{1,2048}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
// A token goes into an Authorization header, so it must not hold anything that could break the header.
const TOKEN_RE = /^[\x21-\x7e]{1,4096}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One call: timeout over the whole exchange including the body, no redirects,
 * and the answer must be 2xx JSON. A timeout or a network failure is
 * `unavailable`; everything else wrong with the answer is `failed`.
 */
async function callJson(deps: ExchangeDeps, url: string, init: RequestInit): Promise<unknown> {
  const doFetch = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? OAUTH_REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: controller.signal, redirect: "manual" });
    } catch {
      throw new OAuthError("unavailable"); // timeout, DNS, TLS, connection refused...
    }
    if (res.status < 200 || res.status >= 300) {
      // Includes 3xx (not followed) and 4xx/5xx. The body is not even read.
      await res.body?.cancel().catch(() => undefined);
      throw new OAuthError("failed");
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new OAuthError(controller.signal.aborted ? "unavailable" : "failed");
    }
    if (text.length > MAX_RESPONSE_CHARS) throw new OAuthError("failed");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new OAuthError("failed");
    }
  } finally {
    clearTimeout(timer);
  }
}

function readAccessToken(json: unknown): string {
  // GitHub answers 200 with {"error": "..."} for a bad or reused code: no access_token, so `failed`.
  if (!isRecord(json) || typeof json.access_token !== "string" || !TOKEN_RE.test(json.access_token)) {
    throw new OAuthError("failed");
  }
  return json.access_token;
}

async function githubProfile(code: string, verifier: string, config: ExchangeConfig, deps: ExchangeDeps): Promise<OAuthProfile> {
  const endpoints = oauthEndpoints("github", config.devBaseUrl ?? null);
  const tokenJson = await callJson(deps, endpoints.token, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier
    })
  });
  const accessToken = readAccessToken(tokenJson);

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT
  };
  const [user, emails] = await Promise.all([
    callJson(deps, endpoints.user, { method: "GET", headers }),
    callJson(deps, endpoints.emails as string, { method: "GET", headers })
  ]);

  // GitHub's stable id is the number `id` (logins can be renamed and reused).
  if (!isRecord(user) || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new OAuthError("failed");
  }
  const email = pickGithubEmail(emails);
  if (email === null) throw new OAuthError("unverified_email");

  return {
    providerUserId: String(user.id),
    email,
    displayName: cleanSuggestedName(user.name) ?? cleanSuggestedName(user.login)
  };
}

async function googleProfile(code: string, verifier: string, config: ExchangeConfig, deps: ExchangeDeps): Promise<OAuthProfile> {
  const endpoints = oauthEndpoints("google", config.devBaseUrl ?? null);
  const tokenJson = await callJson(deps, endpoints.token, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code_verifier: verifier
    }).toString()
  });
  const accessToken = readAccessToken(tokenJson);

  // The token came straight from Google's token endpoint over TLS, so Google's
  // own userinfo endpoint is enough: no id_token and no JWT library needed.
  const info = await callJson(deps, endpoints.user, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  const profile = parseGoogleUserinfo(info);
  if (profile !== null) return profile;
  // Tell "this account's email is not verified" apart from "the answer was garbage".
  const unverified = isRecord(info) && typeof info.sub === "string" && info.email_verified !== true;
  throw new OAuthError(unverified ? "unverified_email" : "failed");
}

/**
 * Trades `code` (with the PKCE `verifier`) for the member's profile. Resolves
 * with a provider id and a verified, lowercase email, or throws OAuthError.
 * No retries.
 */
export async function exchangeAndFetchProfile(
  provider: OAuthProvider,
  code: string,
  verifier: string,
  config: ExchangeConfig,
  deps: ExchangeDeps = {}
): Promise<OAuthProfile> {
  if (typeof code !== "string" || !CODE_RE.test(code)) throw new OAuthError("failed");
  if (typeof verifier !== "string" || !VERIFIER_RE.test(verifier)) throw new OAuthError("failed");
  return provider === "github"
    ? githubProfile(code, verifier, config, deps)
    : googleProfile(code, verifier, config, deps);
}

// ---------------------------------------------------------------------------
// Development override: OAUTH_DEV_PROVIDER_URL
// ---------------------------------------------------------------------------

export type OAuthDevDecision = {
  /** The base URL all provider calls go to, or null for the real providers. */
  devBaseUrl: string | null;
  warnings: string[];
  /** When set, the server must refuse to start with this message. */
  fatal: string | null;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isProductionEnv(env: Record<string, string | undefined>): boolean {
  // Same test as the old mail guard: NODE_ENV, or any Vercel deployment.
  return env.NODE_ENV === "production" || Boolean(env.VERCEL);
}

/**
 * Decides what OAUTH_DEV_PROVIDER_URL means.
 *  - unset or blank: the real providers (nothing to say);
 *  - set in production: FATAL, because it would send the code exchange and the
 *    client secret to that address instead of GitHub or Google;
 *  - set elsewhere: it must be an http(s) address on THIS machine (localhost,
 *    127.0.0.1 or [::1]) with no credentials, otherwise FATAL. A development
 *    typo must not be able to ship a real client secret to another host.
 */
export function decideOAuthDev(env: Record<string, string | undefined>): OAuthDevDecision {
  const raw = (env.OAUTH_DEV_PROVIDER_URL ?? "").trim();
  if (raw === "") return { devBaseUrl: null, warnings: [], fatal: null };

  const fatal = (message: string): OAuthDevDecision => ({ devBaseUrl: null, warnings: [], fatal: message });

  if (isProductionEnv(env)) {
    return fatal(
      "OAUTH_DEV_PROVIDER_URL is for development and tests only: it sends the sign-in code exchange and your client secret " +
        "to that address instead of GitHub or Google. Refusing to start in production. Unset it."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fatal("OAUTH_DEV_PROVIDER_URL is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fatal("OAUTH_DEV_PROVIDER_URL must start with http:// or https://.");
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    return fatal("OAUTH_DEV_PROVIDER_URL must not contain credentials, a query string or a fragment.");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    return fatal("OAUTH_DEV_PROVIDER_URL must point to this machine (localhost, 127.0.0.1 or [::1]).");
  }

  const devBaseUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  return {
    devBaseUrl,
    warnings: [`Using OAUTH_DEV_PROVIDER_URL: sign-in is answered by ${devBaseUrl}, not by GitHub or Google.`],
    fatal: null
  };
}

/**
 * Called once when the server starts, next to assertMailConfigAtBoot. Prints the
 * warnings and stops the process on a fatal decision (the override in production).
 */
export function assertOAuthDevAtBoot(
  env: Record<string, string | undefined> = process.env,
  onFatal: (message: string) => never = (message) => {
    console.error(`[OAuth] ${message}`);
    process.exit(1);
  }
): OAuthDevDecision {
  const decision = decideOAuthDev(env);
  for (const warning of decision.warnings) console.warn(`[OAuth] ${warning}`);
  if (decision.fatal) onFatal(decision.fatal);
  return decision;
}
