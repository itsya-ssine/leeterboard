import type { Request, Response, NextFunction } from "express";
import { logSecurityEvent } from "./securityLog.js";

// CSRF defense for the cookie-authenticated API. SameSite=Lax already blocks
// most cross-site requests, but it is not a complete defense (sibling
// subdomains count as "same site", and browser support varies), so every
// state-changing request is also checked server-side:
//
//   1. The Origin header (or, if absent, Referer) must be this app's own
//      origin, or one listed in ALLOWED_ORIGINS.
//   2. Browsers that send Sec-Fetch-Site must report same-origin (or "none").
//   3. A request that carries a body must be application/json, so it can't be
//      produced by a plain cross-site <form> post.
//
// Non-browser clients (curl, scripts) don't send Origin and can't ride a
// victim's cookies, so a request with no Origin/Referer is allowed through.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Optional comma-separated list of extra full origins (e.g. a separate
// frontend domain): ALLOWED_ORIGINS=https://leeterboard.example.com
const EXTRA_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/\/+$/, ""))
    .filter(Boolean)
);

function originAllowed(req: Request, value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false; // includes the literal string "null"
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (EXTRA_ORIGINS.has(url.origin.toLowerCase())) return true;
  // The raw Host header is chosen by the browser from the URL being requested;
  // a page on another site cannot forge it. (Deliberately not req.hostname,
  // which would honor a spoofable X-Forwarded-Host under "trust proxy".)
  const host = req.get("host")?.toLowerCase();
  return !!host && url.host.toLowerCase() === host;
}

function reject(req: Request, res: Response, status: number, error: string, reason: string) {
  // Never log cookies, bodies or tokens — only what's needed to spot abuse.
  logSecurityEvent("csrf_blocked", { ip: req.ip, method: req.method, path: req.path, reason });
  return res.status(status).json({ error });
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get("origin");
  if (origin !== undefined) {
    if (!originAllowed(req, origin)) {
      return reject(req, res, 403, "Cross-site request blocked.", `origin ${origin.slice(0, 100)}`);
    }
  } else {
    const site = req.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") {
      return reject(req, res, 403, "Cross-site request blocked.", `sec-fetch-site ${site}`);
    }
    const referer = req.get("referer");
    if (referer && !originAllowed(req, referer)) {
      return reject(req, res, 403, "Cross-site request blocked.", "referer mismatch");
    }
  }

  const hasBody = Number(req.get("content-length") ?? 0) > 0 || !!req.get("transfer-encoding");
  if (hasBody && !req.is("application/json")) {
    return reject(req, res, 415, "Content-Type must be application/json.", "non-JSON body");
  }

  next();
}
