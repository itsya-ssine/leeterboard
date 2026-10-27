import rateLimit from "express-rate-limit";
import { DbRateLimitStore } from "./rateLimitStore.js";

// Which limiters share their counters through the database (see
// rateLimitStore.ts): every route where a bypass would matter — guessing
// passwords, spamming sign-ups, abusing verification, and triggering outbound
// scrapes. The general apiLimiter stays in memory on purpose: it is a coarse
// ceiling hit by frontend polling, where a database write per request would
// cost more than it protects. On a single long-lived server both behave the
// same; on serverless only the shared ones hold across instances.

// General ceiling applied to every /api/* request. The frontend polls
// /api/users and /api/trends every 15s, so this needs to stay generous
// for normal usage while still stopping scripted abuse.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP. Please slow down and try again shortly." }
});

// Password logins. Only failed attempts count, so normal use never hits it.
// Each account also locks itself after repeated failures (see server.ts), so a
// distributed attack on one account is stopped even when it rotates IPs.
export const loginLimiter = rateLimit({
  store: new DbRateLimitStore("login"),
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait a few minutes and try again." }
});

// Starting a sign-up hashes a password and calls out to LeetCode.
export const registerLimiter = rateLimit({
  store: new DbRateLimitStore("register"),
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-up attempts. Please try again later." }
});

// "Verify my profile" re-reads the person's LeetCode summary each time.
export const verifyLimiter = rateLimit({
  store: new DbRateLimitStore("verify"),
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Please wait a few minutes and try again." }
});

// Refresh routes call out to LeetCode's (itself rate-limited) API on the
// caller's behalf — throttle per-IP so one person can't hammer LeetCode
// through us.
export const refreshLimiter = rateLimit({
  store: new DbRateLimitStore("refresh"),
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many refresh requests. Please wait a minute and try again." }
});

// Account settings: password checks, profile edits and account deletion.
export const accountLimiter = rateLimit({
  store: new DbRateLimitStore("account"),
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many account requests. Please wait a few minutes and try again." }
});
