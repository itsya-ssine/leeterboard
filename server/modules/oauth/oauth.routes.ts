import crypto from "crypto";
import { Router } from "express";
import { accountLimiter, oauthLimiter } from "../../middleware/rateLimit.js";
import { requireAuth } from "../../middleware/auth.js";
import { logSecurityEvent } from "../../utils/logger.js";
import {
  addOAuthIdentity,
  consumeOAuthState,
  consumePendingOAuthSignup,
  countSignInMethods,
  createOAuthState,
  createPendingOAuthSignup,
  deleteExpiredOAuthRows,
  emailTaken,
  getPendingOAuthSignup,
  getUserAuthById,
  getUserAuthByLoginUsername,
  getUserEmail,
  getUserIdByOAuthIdentity,
  insertUserWithIdentity,
  listOAuthProviders,
  OAuthIdentityConflictError,
  removeOAuthIdentity,
  removeOAuthIdentityKeepingOneMethod,
  setUserEmail
} from "../../../db.js";
import {
  isAdminUser,
  resolveSession,
  setSessionCookie
} from "../../../auth.js";
import {
  buildAuthorizeUrl,
  checkEmailDomain,
  generatePkce,
  isOAuthProvider,
  newStateId,
  readOAuthConfig,
  stateMatches,
  type OAuthErrorCode
} from "../../../oauth.js";
import {
  assertOAuthDevAtBoot,
  exchangeAndFetchProfile,
  OAuthError
} from "../../../oauthProviders.js";
import { maskEmail, parseAllowedDomains } from "../../utils/emails.js";
import { checkUsername } from "../../utils/usernames.js";
import { cleanDisplayName, defaultAvatar } from "../users/users.validation.js";
import { checkCurrentPassword, IS_SECURE_ENV } from "../auth/auth.service.js";
import type { User } from "../../../shared/types.js";

const router = Router();
const oauthConfig = readOAuthConfig(process.env);
const oauthDev = assertOAuthDevAtBoot();
const ALLOWED_EMAIL_DOMAINS = parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS);

const OAUTH_STATE_COOKIE = IS_SECURE_ENV ? "__Secure-oauth_state" : "oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_COOKIE_PATH = "/api/auth/oauth";
const OAUTH_SIGNUP_COOKIE = IS_SECURE_ENV ? "__Secure-oauth_signup" : "oauth_signup";
const OAUTH_SIGNUP_TTL_MS = 15 * 60 * 1000;
const OAUTH_SIGNUP_EXPIRED_MESSAGE = "This sign-up has expired. Please start again.";
const OAUTH_EMAIL_IN_USE_MESSAGE =
  "An account already uses this email. Sign in the way you did before, then connect this provider in Account settings.";

const oauthCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: IS_SECURE_ENV,
  path: OAUTH_COOKIE_PATH
};
const oauthSignupCookieOptions = { ...oauthCookieOptions, path: "/api/auth" };
const PROVIDER_ERROR_CODES: Record<string, OAuthErrorCode> = Object.assign(Object.create(null), {
  access_denied: "cancelled"
});

function setOAuthCookie(res: any, name: string, value: string, path: string, maxAge: number): void {
  res.cookie(name, value, {
    httpOnly: true,
    secure: IS_SECURE_ENV,
    sameSite: "lax",
    path,
    maxAge
  });
}

function oauthFail(res: any, code: OAuthErrorCode, target: "/#/login" | "/#/account" = "/#/login"): void {
  res.clearCookie(OAUTH_STATE_COOKIE, oauthCookieOptions);
  res.redirect(302, `${target}?oauth_error=${code}`);
}

function newMemberRecord(username: string, displayName: string): User {
  return {
    id: `user-${crypto.randomUUID()}`,
    displayName,
    loginUsername: username,
    leetcodeLinked: false,
    leetcodeUsername: "",
    avatarUrl: defaultAvatar(username),
    school: "",
    bio: "",
    githubUrl: "",
    linkedinUrl: "",
    websiteUrl: "",
    allTimeSolved: 0,
    easySolved: 0,
    mediumSolved: 0,
    hardSolved: 0,
    contestRating: null,
    contestsAttended: 0,
    currentStreak: null,
    longestStreak: null,
    weeklyProgress: 0,
    monthlyProgress: 0,
    rank: 0,
    lastUpdated: null,
    trackingStart: "",
    baselineSolved: 0,
    history: []
  };
}

const PENDING_ID_RE = /^[0-9a-f]{32}$/;

async function readPendingOAuthSignup(req: any) {
  const value =
    req.cookies?.[OAUTH_SIGNUP_COOKIE] ??
    req.cookies?.["__Secure-oauth_signup"] ??
    req.cookies?.["oauth_signup"];
  if (typeof value !== "string" || !PENDING_ID_RE.test(value)) return null;
  return getPendingOAuthSignup(value, new Date().toISOString());
}

router.get("/auth/oauth/:provider/start", oauthLimiter, async (req, res) => {
  const provider = req.params.provider;
  try {
    if (!isOAuthProvider(provider) || !oauthConfig.providers[provider]) {
      if (oauthConfig.enabled.length === 0) logSecurityEvent("oauth_unconfigured", { ip: req.ip, route: "start" });
      return oauthFail(res, "unavailable");
    }
    const config = oauthConfig.providers[provider]!;
    const redirectUri = oauthConfig.redirectUri(provider)!;

    const now = Date.now();
    await deleteExpiredOAuthRows(new Date(now).toISOString());

    const { verifier, challenge } = generatePkce();
    const stateId = newStateId();
    await createOAuthState({
      id: stateId,
      provider,
      intent: "signin",
      userId: null,
      codeVerifier: verifier,
      expiresAt: new Date(now + OAUTH_STATE_TTL_MS).toISOString()
    });

    setOAuthCookie(res, OAUTH_STATE_COOKIE, stateId, OAUTH_COOKIE_PATH, OAUTH_STATE_TTL_MS);
    logSecurityEvent("oauth_started", { ip: req.ip, provider, intent: "signin" }, "info");
    res.redirect(302, buildAuthorizeUrl(provider, { state: stateId, challenge, redirectUri, clientId: config.clientId }));
  } catch (error: any) {
    console.error(`[OAuth] start failed: ${error.message}`);
    logSecurityEvent("oauth_failed", { ip: req.ip, provider: isOAuthProvider(provider) ? provider : "unknown", reason: "server_error" });
    oauthFail(res, "failed");
  }
});

router.get("/auth/oauth/:provider/callback", oauthLimiter, async (req, res) => {
  const provider = req.params.provider;
  let failTarget: "/#/login" | "/#/account" = "/#/login";
  const refuse = (code: OAuthErrorCode, reason: string, fields: Record<string, unknown> = {}) => {
    logSecurityEvent("oauth_failed", {
      ip: req.ip,
      provider: isOAuthProvider(provider) ? provider : "unknown",
      reason,
      ...fields
    });
    oauthFail(res, code, failTarget);
  };
  try {
    if (!isOAuthProvider(provider) || !oauthConfig.providers[provider]) {
      if (oauthConfig.enabled.length === 0) logSecurityEvent("oauth_unconfigured", { ip: req.ip, route: "callback" });
      return oauthFail(res, "unavailable");
    }

    const stateId = req.query.state;
    const incomingStateCookie =
      req.cookies?.[OAUTH_STATE_COOKIE] ??
      req.cookies?.["__Secure-oauth_state"] ??
      req.cookies?.["oauth_state"];
    if (!stateMatches(incomingStateCookie, stateId)) {
      return refuse("failed", "state_mismatch");
    }

    const state = await consumeOAuthState(stateId as string, new Date().toISOString());
    if (!state) return refuse("expired", "state_unknown_or_expired");
    if (state.provider !== provider) return refuse("failed", "state_provider_mismatch");
    if (state.intent === "link") failTarget = "/#/account";

    if (state.intent === "link") {
      const session = await resolveSession(req);
      if (!session || session.user.id !== state.userId) return refuse("failed", "link_session_mismatch");
      if (session.isAdmin) return refuse("admin_refused", "admin_refused", { userId: session.user.id });
    }

    const code = req.query.code;
    if (typeof code !== "string") {
      return refuse(PROVIDER_ERROR_CODES[String(req.query.error)] ?? "failed", "no_code");
    }

    let profile;
    try {
      profile = await exchangeAndFetchProfile(provider, code, state.codeVerifier, {
        clientId: oauthConfig.providers[provider]!.clientId,
        clientSecret: oauthConfig.providers[provider]!.clientSecret,
        redirectUri: oauthConfig.redirectUri(provider)!,
        devBaseUrl: oauthDev.devBaseUrl
      });
    } catch (error) {
      const kind = error instanceof OAuthError ? error.kind : "failed";
      return refuse(kind, `exchange_${kind}`);
    }

    const userId = await getUserIdByOAuthIdentity(provider, profile.providerUserId);

    if (state.intent === "link") {
      const memberId = state.userId!;
      if (userId !== null && userId !== memberId) return refuse("already_linked", "identity_owned_by_another");
      if (userId === null) {
        if ((await listOAuthProviders(memberId)).includes(provider)) {
          return refuse("already_linked", "provider_already_connected");
        }
        const storeEmail = (await getUserEmail(memberId)) === null;
        if (storeEmail && (await emailTaken(profile.email))) return refuse("email_in_use", "email_in_use");
        try {
          await addOAuthIdentity(memberId, provider, profile.providerUserId);
        } catch (error) {
          if (error instanceof OAuthIdentityConflictError) return refuse("already_linked", error.reason);
          throw error;
        }
        if (storeEmail && !(await setUserEmail(memberId, profile.email))) {
          await removeOAuthIdentity(memberId, provider);
          return refuse("email_in_use", "email_in_use_race");
        }
        logSecurityEvent("oauth_linked", { ip: req.ip, userId: memberId, provider, storedEmail: storeEmail }, "info");
      }
      res.clearCookie(OAUTH_STATE_COOKIE, oauthCookieOptions);
      return res.redirect(302, `/#/account?connected=${provider}`);
    }

    if (userId === null) {
      if (!checkEmailDomain(profile.email, ALLOWED_EMAIL_DOMAINS)) {
        return refuse("domain_not_allowed", "domain_not_allowed");
      }
      if (await emailTaken(profile.email)) return refuse("email_in_use", "email_in_use");

      const now = Date.now();
      const pendingId = newStateId();
      await createPendingOAuthSignup({
        id: pendingId,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        displayName: profile.displayName,
        expiresAt: new Date(now + OAUTH_SIGNUP_TTL_MS).toISOString()
      });
      res.clearCookie(OAUTH_STATE_COOKIE, oauthCookieOptions);
      setOAuthCookie(res, OAUTH_SIGNUP_COOKIE, pendingId, "/api/auth", OAUTH_SIGNUP_TTL_MS);
      return res.redirect(302, "/#/signup/username");
    }

    const record = await getUserAuthById(userId);
    if (!record) return refuse("failed", "identity_without_member");
    if (isAdminUser(record.user)) return refuse("admin_refused", "admin_refused", { userId: record.user.id });

    setSessionCookie(res, record.user, record.auth.passwordHash, record.auth.sessionVersion);
    res.clearCookie(OAUTH_STATE_COOKIE, oauthCookieOptions);
    logSecurityEvent("oauth_login", { ip: req.ip, userId: record.user.id, provider }, "info");
    res.redirect(302, "/#/");
  } catch (error: any) {
    console.error(`[OAuth] callback failed: ${error.message}`);
    refuse("failed", "server_error");
  }
});

router.post("/account/oauth/:provider/start", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id, isAdmin } = req.user!;
    if (isAdmin) {
      logSecurityEvent("oauth_failed", { ip: req.ip, userId: id, reason: "admin_refused", route: "link" });
      return res.status(403).json({ error: "Admin accounts can only sign in with a password." });
    }
    const provider = req.params.provider;
    if (!isOAuthProvider(provider) || !oauthConfig.providers[provider]) {
      if (oauthConfig.enabled.length === 0) logSecurityEvent("oauth_unconfigured", { ip: req.ip, route: "link" });
      return res.status(503).json({ error: "That sign-in method isn't available right now." });
    }

    const methods = await countSignInMethods(id);
    if (methods.providers.includes(provider)) {
      return res.status(409).json({ error: "You have already connected an account from that provider." });
    }
    if (methods.password) {
      const check = await checkCurrentPassword(id, req.body?.currentPassword, "oauth_link", req.ip);
      if (!check.record) return res.status(check.status).json({ error: check.error, code: check.code });
    }

    const now = Date.now();
    await deleteExpiredOAuthRows(new Date(now).toISOString());
    const { verifier, challenge } = generatePkce();
    const stateId = newStateId();
    await createOAuthState({
      id: stateId,
      provider,
      intent: "link",
      userId: id,
      codeVerifier: verifier,
      expiresAt: new Date(now + OAUTH_STATE_TTL_MS).toISOString()
    });
    setOAuthCookie(res, OAUTH_STATE_COOKIE, stateId, OAUTH_COOKIE_PATH, OAUTH_STATE_TTL_MS);
    logSecurityEvent("oauth_started", { ip: req.ip, userId: id, provider, intent: "link" }, "info");
    res.json({
      url: buildAuthorizeUrl(provider, {
        state: stateId,
        challenge,
        redirectUri: oauthConfig.redirectUri(provider)!,
        clientId: oauthConfig.providers[provider]!.clientId
      })
    });
  } catch (error: any) {
    console.error(`[OAuth] link start failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.delete("/account/oauth/:provider", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.user!;
    const provider = req.params.provider;
    if (!isOAuthProvider(provider)) return res.status(404).json({ error: "That sign-in method doesn't exist." });

    const methods = await countSignInMethods(id);
    if (!methods.providers.includes(provider)) {
      return res.status(404).json({ error: "That account isn't connected." });
    }
    const LAST_METHOD = { error: "That is your only way to sign in. Connect another account first." };
    if (methods.count <= 1) return res.status(409).json(LAST_METHOD);

    if (!(await removeOAuthIdentityKeepingOneMethod(id, provider))) {
      return res.status(409).json(LAST_METHOD);
    }
    logSecurityEvent("oauth_unlinked", { ip: req.ip, userId: id, provider }, "info");
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[OAuth] unlink failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.get("/auth/oauth/pending", oauthLimiter, async (req, res) => {
  try {
    const pending = await readPendingOAuthSignup(req);
    if (!pending) {
      res.clearCookie(OAUTH_SIGNUP_COOKIE, oauthSignupCookieOptions);
      return res.status(400).json({ error: OAUTH_SIGNUP_EXPIRED_MESSAGE, expired: true });
    }
    res.json({
      provider: pending.provider,
      maskedEmail: maskEmail(pending.email),
      suggestedDisplayName: pending.displayName
    });
  } catch (error: any) {
    console.error(`[OAuth] pending lookup failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/auth/oauth/complete", oauthLimiter, async (req, res) => {
  try {
    const expired = () => {
      res.clearCookie(OAUTH_SIGNUP_COOKIE, oauthSignupCookieOptions);
      return res.status(400).json({ error: OAUTH_SIGNUP_EXPIRED_MESSAGE, expired: true });
    };

    const pending = await readPendingOAuthSignup(req);
    if (!pending) return expired();

    const body = (req.body ?? {}) as Record<string, unknown>;
    const check = checkUsername(body.username);
    if (!check.ok) return res.status(400).json({ error: check.error });
    const username = check.username;
    if (await getUserAuthByLoginUsername(username)) {
      return res.status(409).json({ error: "That username is taken." });
    }

    if (await emailTaken(pending.email)) {
      await consumePendingOAuthSignup(pending.id, new Date().toISOString());
      res.clearCookie(OAUTH_SIGNUP_COOKIE, oauthSignupCookieOptions);
      return res.status(409).json({ error: OAUTH_EMAIL_IN_USE_MESSAGE });
    }

    const taken = await consumePendingOAuthSignup(pending.id, new Date().toISOString());
    if (!taken) return expired();

    const user = newMemberRecord(username, cleanDisplayName(body.displayName, username));
    try {
      await insertUserWithIdentity(user, {
        loginUsername: username,
        email: taken.email,
        provider: taken.provider,
        providerUserId: taken.providerUserId
      });
    } catch (error: any) {
      if (!String(error?.message).includes("UNIQUE")) throw error;
      if (await getUserAuthByLoginUsername(username)) {
        await createPendingOAuthSignup(taken);
        return res.status(409).json({ error: "That username was just taken. Please choose another one." });
      }
      res.clearCookie(OAUTH_SIGNUP_COOKIE, oauthSignupCookieOptions);
      if (await getUserIdByOAuthIdentity(taken.provider, taken.providerUserId)) {
        return res.status(409).json({ error: "This account already has a Leeterboard account. Sign in with it instead." });
      }
      return res.status(409).json({ error: OAUTH_EMAIL_IN_USE_MESSAGE });
    }

    logSecurityEvent(
      "account_created",
      { ip: req.ip, userId: user.id, username, maskedEmail: maskEmail(taken.email), provider: taken.provider },
      "info"
    );
    res.clearCookie(OAUTH_SIGNUP_COOKIE, oauthSignupCookieOptions);
    setSessionCookie(res, user, "");
    res.status(201).json({ ...user, isAdmin: isAdminUser(user) });
  } catch (error: any) {
    console.error(`[OAuth] complete failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
