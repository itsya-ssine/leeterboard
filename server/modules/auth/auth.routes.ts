import crypto from "crypto";
import { Router } from "express";
import {
  accountLimiter,
  loginLimiter,
  resetLimiter,
  verifyLimiter
} from "../../middleware/rateLimit.js";
import { requireAuth } from "../../middleware/auth.js";
import { logSecurityEvent } from "../../utils/logger.js";
import {
  bumpPendingResetAttempts,
  bumpSessionVersion,
  clearFailedLogins,
  consumePendingReset,
  createPendingReset,
  createSecurityNotice,
  deletePendingReset,
  deletePendingResetsFor,
  getLinkedHandle,
  getPendingReset,
  getResetFreeze,
  getUserAuthById,
  getUserAuthByLoginUsername,
  getUserById,
  getUserEmail,
  purgeExpiredPendingResets,
  recordFailedLogin,
  recordPasswordReset,
  setPasswordHash,
  countSignInMethods,
  type ResetFreezeReason
} from "../../../db.js";
import {
  burnPasswordCheck,
  clearSessionCookie,
  hashPassword,
  isAdminUser,
  isPasswordHash,
  MAX_PASSWORD_LENGTH,
  needsRehash,
  readSession,
  resolveSession,
  setSessionCookie,
  verifyDeviceToken,
  verifyPassword
} from "../../../auth.js";
import { LOCKOUT_MS, MAX_FAILED_LOGINS } from "../../config/constants.js";
import { readOAuthConfig } from "../../../oauth.js";
import { PLATFORMS } from "../../../platforms/registry.js";
import { PlatformNotFoundError } from "../../../platforms/common.js";
import { fetchLeetCodeAbout } from "../../platforms/leetcode/scraper.js";
import {
  DEVICE_COOKIE,
  IS_SECURE_ENV,
  readLoginCredentials,
  setKnownDeviceCookie
} from "./auth.service.js";
import { validatePassword } from "./auth.validation.js";

const router = Router();
const oauthConfig = readOAuthConfig(process.env);

export type RecoveryPlatform = "leetcode" | "codeforces" | "codingame";
export type ResetEligibility =
  | { ok: true; handle: string }
  | { ok: false; reason: "admin" | "not_linked" | ResetFreezeReason };

const RESET_COOKIE = IS_SECURE_ENV ? "__Secure-pwreset" : "pwreset";
const RESET_TTL_MS = 30 * 60 * 1000;
const resetCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: IS_SECURE_ENV,
  path: "/api/auth"
};
const RESET_PLATFORMS: readonly RecoveryPlatform[] = ["leetcode", "codeforces", "codingame"];
const RESET_PLATFORM_LABELS: Record<RecoveryPlatform, string> = {
  leetcode: "LeetCode",
  codeforces: "Codeforces",
  codingame: "CodinGame"
};
const LEETCODE_PROOF_HELP =
  "On LeetCode open your profile, click Edit Profile, paste the code into the Summary field and save. Then press Verify. You can remove the code afterward.";
const RESET_BLOCKED_MESSAGE =
  "This password can't be reset online. If you remember your current password, sign in and change it in your account settings. " +
  "Otherwise create a new account with a different username, or ask an admin to remove the old one.";
const LEETCODE_UNAVAILABLE_MESSAGE =
  "Couldn't reach LeetCode right now. Please try again in a moment.";

const MAX_VERIFY_ATTEMPTS = 10;

async function resetEligibility(
  user: { id: string; leetcodeUsername: string },
  platform: RecoveryPlatform
): Promise<ResetEligibility> {
  if (isAdminUser(user)) return { ok: false, reason: "admin" };
  const handle = await getLinkedHandle(user.id, platform);
  if (!handle) return { ok: false, reason: "not_linked" };
  const freeze = await getResetFreeze(user.id, platform);
  return freeze ? { ok: false, reason: freeze } : { ok: true, handle };
}

function clearResetCookie(res: any): void {
  res.clearCookie(RESET_COOKIE, resetCookieOptions);
  if (RESET_COOKIE !== "pwreset") {
    res.clearCookie("pwreset", { ...resetCookieOptions, secure: false });
  }
}

// POST — forgot password, step 1
router.post("/auth/reset/start", resetLimiter, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!username || username.length > 100) {
      return res.status(400).json({ error: "Enter your username." });
    }
    const platform = RESET_PLATFORMS.find((p) => p === body.platform);
    if (!platform) {
      return res.status(400).json({ error: "Choose the account you linked: LeetCode, Codeforces or CodinGame." });
    }
    const passwordError = await validatePassword(body.password, username);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const passwordHash = await hashPassword(body.password as string);
    const record = await getUserAuthByLoginUsername(username);
    const eligibility = record ? await resetEligibility(record.user, platform) : null;
    if (!record || !eligibility || !eligibility.ok) {
      logSecurityEvent("ownership_blocked", {
        ip: req.ip,
        userId: record?.user.id,
        username,
        platform,
        reason: eligibility && !eligibility.ok ? eligibility.reason : "unknown_user",
        stage: "start"
      });
      return res.status(403).json({ error: RESET_BLOCKED_MESSAGE });
    }

    const RESET_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    if (record.auth.passwordResetAt) {
      const resetTime = Date.parse(record.auth.passwordResetAt);
      if (!Number.isNaN(resetTime) && Date.now() - resetTime < RESET_COOLDOWN_MS) {
        logSecurityEvent("ownership_blocked", {
          ip: req.ip,
          userId: record.user.id,
          username,
          platform,
          reason: "reset_cooldown",
          stage: "start"
        });
        const hoursLeft = Math.max(1, Math.ceil((RESET_COOLDOWN_MS - (Date.now() - resetTime)) / 3_600_000));
        return res.status(429).json({
          error: `This account's password was recently reset. To prevent unauthorized takeovers, please wait ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"} before requesting another reset, or contact an administrator.`
        });
      }
    }

    await purgeExpiredPendingResets(new Date().toISOString());
    const id = crypto.randomBytes(32).toString("hex");
    const code = `leeterboard-${crypto.randomBytes(6).toString("hex")}`;
    await createPendingReset({
      id,
      userId: record.user.id,
      platform,
      handle: eligibility.handle,
      passwordHash,
      code,
      expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString()
    });

    logSecurityEvent("ownership_started", { ip: req.ip, userId: record.user.id, platform, purpose: "reset" }, "info");
    res.cookie(RESET_COOKIE, id, { ...resetCookieOptions, maxAge: RESET_TTL_MS });
    res.json({
      code,
      platform,
      instructions: platform === "leetcode" ? LEETCODE_PROOF_HELP : PLATFORMS[platform].proofHelp,
      expiresInMinutes: RESET_TTL_MS / 60_000
    });
  } catch (error: any) {
    console.error(`[Auth] reset start failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — forgot password, step 2
router.post("/auth/reset/verify", verifyLimiter, async (req, res) => {
  try {
    const cookieValue =
      req.cookies?.[RESET_COOKIE] ??
      req.cookies?.["__Secure-pwreset"] ??
      req.cookies?.["pwreset"];
    const pending =
      typeof cookieValue === "string" && /^[a-f0-9]{64}$/.test(cookieValue) ? await getPendingReset(cookieValue) : null;
    if (!pending || Date.parse(pending.expiresAt) < Date.now()) {
      if (pending) await deletePendingReset(pending.id);
      clearResetCookie(res);
      return res.status(400).json({ error: "This reset request has expired. Please start again.", expired: true });
    }
    if (pending.attempts >= MAX_VERIFY_ATTEMPTS) {
      await deletePendingReset(pending.id);
      clearResetCookie(res);
      return res.status(429).json({ error: "Too many failed checks. Please start again.", expired: true });
    }

    const user = await getUserById(pending.userId);
    const eligibility = user ? await resetEligibility(user, pending.platform) : null;
    if (!user || !eligibility || !eligibility.ok || eligibility.handle.toLowerCase() !== pending.handle.toLowerCase()) {
      await deletePendingReset(pending.id);
      clearResetCookie(res);
      logSecurityEvent("ownership_blocked", {
        ip: req.ip,
        userId: pending.userId,
        platform: pending.platform,
        reason: eligibility && !eligibility.ok ? eligibility.reason : "changed",
        stage: "verify"
      });
      return res.status(403).json({ error: RESET_BLOCKED_MESSAGE });
    }

    const label = RESET_PLATFORM_LABELS[pending.platform];
    let texts: string[];
    if (pending.platform === "leetcode") {
      const lookup = await fetchLeetCodeAbout(pending.handle);
      if (lookup.status === "unavailable") {
        logSecurityEvent("ownership_lookup_unavailable", { ip: req.ip, userId: user.id, platform: "leetcode", purpose: "reset" });
        return res.status(503).json({ error: LEETCODE_UNAVAILABLE_MESSAGE });
      }
      if (lookup.status === "not_found") {
        await deletePendingReset(pending.id);
        clearResetCookie(res);
        logSecurityEvent("ownership_blocked", { ip: req.ip, userId: user.id, platform: "leetcode", reason: "name_not_found", stage: "verify" });
        return res.status(404).json({ error: `That ${label} account no longer exists, so it can't be used to reset this password.` });
      }
      texts = [lookup.aboutMe];
    } else {
      try {
        texts = (await PLATFORMS[pending.platform].fetchProfile!(pending.handle)).texts;
      } catch (err: any) {
        if (err instanceof PlatformNotFoundError) {
          await deletePendingReset(pending.id);
          clearResetCookie(res);
          logSecurityEvent("ownership_blocked", { ip: req.ip, userId: user.id, platform: pending.platform, reason: "name_not_found", stage: "verify" });
          return res.status(404).json({ error: `That ${label} account no longer exists, so it can't be used to reset this password.` });
        }
        logSecurityEvent("ownership_lookup_unavailable", { ip: req.ip, userId: user.id, platform: pending.platform, purpose: "reset" });
        return res.status(503).json({ error: err.message });
      }
    }

    const needle = pending.code.toLowerCase();
    if (!texts.some((t) => t.toLowerCase().includes(needle))) {
      await bumpPendingResetAttempts(pending.id);
      logSecurityEvent("ownership_failed", {
        ip: req.ip,
        userId: user.id,
        platform: pending.platform,
        purpose: "reset",
        attempts: pending.attempts + 1
      });
      return res.status(400).json({
        error: `We couldn't find the code on your ${label} profile yet. Save it there, wait a few seconds, then try again.`
      });
    }

    if (!(await consumePendingReset(pending.id))) {
      logSecurityEvent("ownership_failed", { ip: req.ip, userId: user.id, platform: pending.platform, purpose: "reset", reason: "replay" });
      return res.status(400).json({ error: "This reset request was already used or has expired. Please start again.", expired: true });
    }

    const hadPassword = isPasswordHash((await getUserAuthById(user.id))?.auth.passwordHash);
    await setPasswordHash(user.id, pending.passwordHash);
    await recordPasswordReset(user.id);
    await bumpSessionVersion(user.id);
    await deletePendingResetsFor(user.id);
    await createSecurityNotice(
      user.id,
      "Your password was reset",
      `Someone proved they own your ${label} account "${pending.handle}" and used it to set a new password on ${new Date().toUTCString()}. ` +
        "If that was you, nothing more to do. If it wasn't, change your password immediately in your account settings and ask an admin for help."
    );
    logSecurityEvent("ownership_verified", { ip: req.ip, userId: user.id, platform: pending.platform, purpose: "reset" }, "info");
    logSecurityEvent(
      "password_reset_via_ownership",
      { ip: req.ip, userId: user.id, platform: pending.platform, handle: pending.handle, hadPassword },
      hadPassword ? "warn" : "info"
    );

    clearResetCookie(res);
    const updatedUserAuth = await getUserAuthById(user.id);
    setSessionCookie(res, user, pending.passwordHash, updatedUserAuth?.auth.sessionVersion);
    res.json({ ...user, isAdmin: isAdminUser(user) });
  } catch (error: any) {
    console.error(`[Auth] reset verify failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST — password login
router.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const credentials = readLoginCredentials(req.body);
    if (credentials === null) {
      return res.status(400).json({ error: "Enter your username and password." });
    }
    const { username: loginName, password } = credentials;
    const INVALID = { error: "Invalid username or password." };

    if (password.length > MAX_PASSWORD_LENGTH) {
      return res.status(401).json(INVALID);
    }

    const record = await getUserAuthByLoginUsername(loginName);
    if (!record) {
      await burnPasswordCheck(password);
      logSecurityEvent("login_failed", { ip: req.ip, username: loginName, reason: "unknown_user" });
      return res.status(401).json(INVALID);
    }

    const { user, auth } = record;
    let failuresBefore = auth.failedLogins;

    const deviceCookie =
      req.cookies?.[DEVICE_COOKIE] ??
      req.cookies?.["__Secure-known_device"] ??
      req.cookies?.["known_device"];
    const isKnownDevice = typeof deviceCookie === "string" && verifyDeviceToken(deviceCookie, user.id);

    if (auth.lockedUntil) {
      const until = Date.parse(auth.lockedUntil);
      if (until > Date.now()) {
        if (!isKnownDevice) {
          logSecurityEvent("login_blocked_locked", { ip: req.ip, userId: user.id, username: loginName });
          const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
          return res.status(429).json({
            error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
          });
        }
      } else {
        await clearFailedLogins(user.id);
        failuresBefore = 0;
      }
    }

    if (!isPasswordHash(auth.passwordHash)) {
      await burnPasswordCheck(password);
      return res.status(401).json({
        error: 'This account has no password yet. Use "Forgot password" to set one by verifying a linked account, or contact a Leeterboard admin.',
        needsPassword: true
      });
    }

    if (!(await verifyPassword(password, auth.passwordHash))) {
      await recordFailedLogin(user.id, MAX_FAILED_LOGINS, new Date(Date.now() + LOCKOUT_MS).toISOString());
      logSecurityEvent("login_failed", {
        ip: req.ip,
        userId: user.id,
        username: loginName,
        failures: failuresBefore + 1
      });
      if (failuresBefore + 1 >= MAX_FAILED_LOGINS) {
        logSecurityEvent("account_locked", {
          ip: req.ip,
          userId: user.id,
          username: loginName,
          minutes: LOCKOUT_MS / 60_000
        });
        await createSecurityNotice(
          user.id,
          "Security alert: 5 failed sign-in attempts",
          `We detected repeated failed sign-in attempts on your account. If this was not you, someone may be trying to guess your password. Your account has been temporarily locked to untrusted devices for ${LOCKOUT_MS / 60_000} minutes.`
        );
      }
      const delayMs = process.env.NODE_ENV === "test" ? 0 : Math.min(1000 * Math.pow(2, failuresBefore), 4000);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return res.status(401).json(INVALID);
    }

    if (auth.failedLogins > 0) await clearFailedLogins(user.id);
    if (needsRehash(auth.passwordHash)) {
      auth.passwordHash = await hashPassword(password);
      await setPasswordHash(user.id, auth.passwordHash);
      logSecurityEvent("password_rehashed", { userId: user.id, username: loginName }, "info");
    }
    setKnownDeviceCookie(res, user.id);
    setSessionCookie(res, user, auth.passwordHash, auth.sessionVersion);
    res.json({ ...user, isAdmin: isAdminUser(user) });
  } catch (error: any) {
    console.error(`[Auth] login failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST logout
router.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// POST logout-all
router.post("/auth/logout-all", requireAuth, accountLimiter, async (req, res, next) => {
  try {
    const user = req.user!;
    await bumpSessionVersion(user.id);
    clearSessionCookie(res);
    logSecurityEvent("session_revoked_all", { ip: req.ip, userId: user.id, username: user.loginUsername }, "info");
    res.json({ success: true, message: "Logged out from all devices." });
  } catch (error: any) {
    next(error);
  }
});

// GET session
router.get("/auth/session", async (req, res) => {
  try {
    const resolved = await resolveSession(req);
    if (!resolved) {
      if (readSession(req)) clearSessionCookie(res);
      return res.json({ status: "guest", oauthProviders: oauthConfig.enabled });
    }
    const own = await getUserEmail(resolved.user.id);
    const authRecord = await getUserAuthById(resolved.user.id);
    const methods = await countSignInMethods(resolved.user.id);
    res.json({
      status: "authenticated",
      user: {
        ...resolved.user,
        isAdmin: resolved.isAdmin,
        email: own?.email ?? null,
        emailVerified: Boolean(own?.verifiedAt),
        signInMethods: { password: methods.password, providers: methods.providers },
        passwordResetAt: authRecord?.auth.passwordResetAt ?? null
      },
      oauthProviders: oauthConfig.enabled
    });
  } catch (error: any) {
    console.error(`[Auth] session check failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
