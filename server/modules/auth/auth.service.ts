import type { Response } from "express";
import {
  clearFailedLogins,
  getUserAuthById,
  recordFailedLogin,
  UserWithAuth
} from "../../../db.js";
import {
  isAdminUser,
  isPasswordHash,
  MAX_PASSWORD_LENGTH,
  SESSION_REQUIRED_BODY,
  SESSION_REQUIRED_CODE,
  signDeviceToken,
  verifyPassword
} from "../../../auth.js";
import { LOCKOUT_MS, MAX_FAILED_LOGINS } from "../../config/constants.js";
import { logSecurityEvent } from "../../utils/logger.js";

export const IS_SECURE_ENV = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
export const DEVICE_COOKIE = IS_SECURE_ENV ? "__Secure-known_device" : "known_device";
export const DEVICE_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const NO_PASSWORD_CODE = "no_password";
export const NO_PASSWORD_ERROR = "This account doesn't use a password.";

export function setKnownDeviceCookie(res: Response, userId: string): void {
  const token = signDeviceToken(userId);
  res.cookie(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_SECURE_ENV,
    path: "/api/auth",
    maxAge: DEVICE_COOKIE_TTL_MS
  });
}

export function readLoginCredentials(body: unknown): { username: string; password: string } | null {
  const { username, leetcodeUsername, password } = (body ?? {}) as Record<string, unknown>;
  const name = typeof username === "string" ? username : leetcodeUsername;
  if (typeof name !== "string" || typeof password !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || password.length === 0) return null;
  return { username: trimmed.toLowerCase(), password };
}

export interface ReauthResult {
  record: UserWithAuth | null;
  status: number;
  error: string;
  code?: string;
}

export async function checkCurrentPassword(
  userId: string,
  password: unknown,
  action: "password_change" | "account_delete" | "oauth_link",
  ip: string | undefined
): Promise<ReauthResult> {
  const fail = (status: number, error: string, code?: string) => ({ record: null, status, error, code });

  const record = await getUserAuthById(userId);
  if (!record) return fail(401, SESSION_REQUIRED_BODY.error, SESSION_REQUIRED_CODE);
  if (!isPasswordHash(record.auth.passwordHash)) return fail(409, NO_PASSWORD_ERROR, NO_PASSWORD_CODE);
  if (typeof password !== "string" || !password) return fail(400, "Enter your current password.");

  let failuresBefore = record.auth.failedLogins;
  if (record.auth.lockedUntil) {
    const until = Date.parse(record.auth.lockedUntil);
    if (until > Date.now()) {
      const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      return fail(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }
    await clearFailedLogins(userId);
    failuresBefore = 0;
  }

  if (password.length > MAX_PASSWORD_LENGTH || !(await verifyPassword(password, record.auth.passwordHash))) {
    await recordFailedLogin(userId, MAX_FAILED_LOGINS, new Date(Date.now() + LOCKOUT_MS).toISOString());
    logSecurityEvent("reauth_failed", {
      ip,
      userId,
      username: record.user.loginUsername,
      action,
      failures: failuresBefore + 1
    });
    if (failuresBefore + 1 >= MAX_FAILED_LOGINS) {
      logSecurityEvent("account_locked", {
        ip,
        userId,
        username: record.user.loginUsername,
        minutes: LOCKOUT_MS / 60_000
      });
    }
    return fail(401, "Current password is incorrect.");
  }

  if (record.auth.failedLogins > 0) await clearFailedLogins(userId);
  return { record, status: 200, error: "" };
}

export async function checkAccountDeletion(
  userId: string,
  body: any,
  ip: string | undefined
): Promise<ReauthResult> {
  const fail = (status: number, error: string, code?: string) => ({ record: null, status, error, code });

  const record = await getUserAuthById(userId);
  if (!record) return fail(401, SESSION_REQUIRED_BODY.error, SESSION_REQUIRED_CODE);
  if (isPasswordHash(record.auth.passwordHash)) {
    return checkCurrentPassword(userId, body?.password, "account_delete", ip);
  }

  if (isAdminUser(record.user)) return fail(403, "Admin accounts need a password to be removed.", NO_PASSWORD_CODE);
  const typed = body?.confirmUsername;
  if (typeof typed !== "string" || !typed) return fail(400, "Type your username to confirm.");
  if (typed.trim().toLowerCase() !== record.user.loginUsername.toLowerCase()) {
    return fail(400, "That isn't your username. Check the spelling and try again.");
  }
  return { record, status: 200, error: "" };
}
