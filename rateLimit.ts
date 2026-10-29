import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import type { Options } from "express-rate-limit";
import { DbRateLimitStore } from "./rateLimitStore.js";
import { logSecurityEvent } from "./securityLog.js";

// Same response as the default handler, plus a security log line so repeated
// blocks (credential stuffing, scraping, sign-up spam) show up in alerts.
function blocked(limiter: string) {
  return (req: Request, res: Response, _next: unknown, options: Options) => {
    logSecurityEvent("rate_limited", { ip: req.ip, limiter, method: req.method, path: req.path });
    res.status(options.statusCode).send(options.message);
  };
}

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
  handler: blocked("api"),
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP. Please slow down and try again shortly." }
});

// Page loads: the production fallback that serves index.html for any path that
// isn't a built asset or an /api route. The app routes with the URL hash, so a
// real visitor loads this once per visit; the ceiling is far above that and
// only stops scripts hammering the file-serving route. In memory on purpose
// (no database write for a static file), and separate from apiLimiter so page
// loads never use up a member's API allowance.
export const pageLimiter = rateLimit({
  handler: blocked("page"),
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP. Please slow down and try again shortly."
});

// Password logins. Only failed attempts count, so normal use never hits it.
// Each account also locks itself after repeated failures (see server.ts), so a
// distributed attack on one account is stopped even when it rotates IPs.
export const loginLimiter = rateLimit({
  store: new DbRateLimitStore("login"),
  handler: blocked("login"),
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
  handler: blocked("register"),
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-up attempts. Please try again later." }
});

// "Verify my profile" re-reads the person's LeetCode summary each time.
export const verifyLimiter = rateLimit({
  store: new DbRateLimitStore("verify"),
  handler: blocked("verify"),
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
  handler: blocked("refresh"),
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many refresh requests. Please wait a minute and try again." }
});

// Account settings: password checks, profile edits and account deletion.
export const accountLimiter = rateLimit({
  store: new DbRateLimitStore("account"),
  handler: blocked("account"),
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many account requests. Please wait a few minutes and try again." }
});

// The public feedback form. Anyone can post (no account needed), so this is the
// only thing standing between the admins' inbox and a script. Per IP, which on a
// shared school network is per building rather than per person, so it is kept
// generous enough for a handful of real people.
export const feedbackLimiter = rateLimit({
  store: new DbRateLimitStore("feedback"),
  handler: blocked("feedback"),
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "That's a lot of feedback in a short time. Please try again in a while." }
});
