// The browser's calls to the sign-up, e-mail and password-reset endpoints, and
// the error they throw. Kept out of AuthContext.tsx (no React, no DOM beyond
// `fetch`) so the exact requests can be unit-tested with a stubbed fetch, the
// same way src/signup.ts is: AuthContext only decides what to do with a result.
import type { User } from "./types.js";

/**
 * Thrown for any non-2xx response, and when the server can't be reached.
 *  - `expired`: the server says the request in progress is gone (expired,
 *    locked after too many wrong codes, or used), so it has to be started again.
 *  - `status`: the HTTP status, or 0 when the server wasn't reached. A 429 with
 *    `expired` false is a wait ("Wait a minute...") or a rate limit.
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

export async function requestJson<T>(method: string, url: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
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

/** What a code-by-email request answers: how long the code lives and where it went (masked). */
export interface EmailCodeChallenge {
  expiresInMinutes: number;
  maskedEmail: string;
}

/**
 * The answer to "forgot password": the same for every address, so it carries
 * no masked address and says nothing about whether the address has an account.
 */
export interface PasswordResetChallenge {
  message: string;
  expiresInMinutes: number;
}

/** What a verified e-mail change answers. */
export interface EmailVerifiedResult {
  success: true;
  maskedEmail: string;
  emailVerified: true;
}

// Sign-up: step 1 sends the code (the server keeps the username and the hashed
// password until it is entered), step 2 creates the account and signs in. The
// pending id travels in an httpOnly cookie, so the code is all the body holds.
export const requestSignupCode = (username: string, password: string, email: string, displayName?: string) =>
  postJson<EmailCodeChallenge>("/api/auth/register/start", { username, password, email, displayName });
export const submitSignupCode = (code: string) => postJson<User>("/api/auth/register/verify", { code });

// A signed-in member adds or changes their address. Needs the current password.
export const requestEmailCode = (email: string, currentPassword: string) =>
  postJson<EmailCodeChallenge>("/api/account/email/start", { email, currentPassword });
export const submitEmailCode = (code: string) => postJson<EmailVerifiedResult>("/api/account/email/verify", { code });

// Forgot password. Step 1 always answers the same; step 2 sets the new
// password and signs in.
export const requestResetCode = (email: string, newPassword: string) =>
  postJson<PasswordResetChallenge>("/api/auth/reset/email/start", { email, newPassword });
export const submitResetCode = (code: string) => postJson<User>("/api/auth/reset/email/verify", { code });

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
  return merged;
}
