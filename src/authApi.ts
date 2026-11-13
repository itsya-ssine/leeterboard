// Browser-side authentication requests and their errors. Kept out of
// AuthContext.tsx so the requests can be unit-tested with a stubbed fetch.
import type { User } from "./types.js";

/**
 * Thrown for any non-2xx response, and when the server can't be reached.
 *  - `expired`: the server says a short-lived verification request is gone.
 *  - `status`: the HTTP status, or 0 when the server wasn't reached.
 */
export class AuthError extends Error {
  expired: boolean;
  status: number;
  constructor(message: string, expired = false, status = 0) {
    super(message);
    this.name = "AuthError";
    this.expired = expired;
    this.status = status;
  }
}

export async function requestJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    res = await fetch(url, init);
  } catch {
    throw new AuthError("Couldn't reach the server. Check your connection and try again.");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page) — fall through to the generic message.
  }
  if (!res.ok) {
    throw new AuthError(data?.error || "Something went wrong. Please try again.", Boolean(data?.expired), res.status);
  }
  return data as T;
}

export const postJson = <T,>(url: string, body: unknown = {}) => requestJson<T>("POST", url, body);

export type OAuthProvider = "github" | "google";

export interface PendingOAuthSignup {
  provider: OAuthProvider;
  maskedEmail: string;
  suggestedDisplayName: string | null;
}

export interface OAuthLinkStart {
  url: string;
}

/** Start a provider sign-in by navigating to the server's fixed start route. */
export function startOAuthSignIn(provider: OAuthProvider): void {
  window.location.assign(`/api/auth/oauth/${provider}/start`);
}

/** Read the short-lived pending identity after the provider callback. */
export const fetchPendingOAuthSignup = () =>
  requestJson<PendingOAuthSignup>("GET", "/api/auth/oauth/pending");

/** Complete provider sign-up after the member has chosen a public username. */
export const completeOAuthSignup = (username: string, displayName?: string) =>
  postJson<User>("/api/auth/oauth/complete", {
    username,
    ...(displayName?.trim() ? { displayName: displayName.trim() } : {})
  });

/** Start linking a provider to the currently signed-in member. */
export const startOAuthLink = (provider: OAuthProvider, currentPassword?: string) =>
  postJson<OAuthLinkStart>(`/api/account/oauth/${provider}/start`,
    currentPassword === undefined ? {} : { currentPassword });

/** Disconnect a provider from the currently signed-in member. */
export const unlinkOAuth = (provider: OAuthProvider) =>
  requestJson<{ success: true }>("DELETE", `/api/account/oauth/${provider}`);

/**
 * The member record to keep after an answer that doesn't carry the member's own
 * e-mail (every account PATCH/POST answers with the member but not the address,
 * and login doesn't either). The address and its verified flag come from
 * /api/auth/session only, so a newer answer for the SAME member keeps what the
 * last session read said instead of wiping it; a different member (or no
 * previous record) starts clean.
 */
export function mergeSessionUser(prev: User | null, next: User): User {
  if (!prev || prev.id !== next.id) return next;
  const carries = "email" in next || "emailVerified" in next;
  if (carries) return next;
  const merged: User = { ...next };
  if ("email" in prev) merged.email = prev.email;
  if ("emailVerified" in prev) merged.emailVerified = prev.emailVerified;
  if ("signInMethods" in prev && !("signInMethods" in next)) merged.signInMethods = prev.signInMethods;
  return merged;
}
