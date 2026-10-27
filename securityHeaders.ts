import type { Request, Response, NextFunction } from "express";

// Browser-facing security headers, in one place so the Express server and
// vercel.json (which serves the static frontend on Vercel, bypassing Express)
// stay identical. `npm run security:check` fails if the two drift apart or if
// index.html's inline script changes without its CSP hash being updated.

export const IS_PRODUCTION = process.env.NODE_ENV === "production";

// SHA-256 of the one inline <script> in index.html (the no-flash theme
// bootstrap). Recompute with `npm run security:check` after editing it.
export const INLINE_SCRIPT_HASHES = ["sha256-TqgtQQv0LmMkFvsx4MZg+fz9zxg5hHFwMtQN7qB36CI="];

// Content Security Policy for the production build.
//  - script-src: only our own bundle plus the hashed theme bootstrap. No
//    'unsafe-inline', no 'unsafe-eval', so an injected <script> won't run.
//  - style-src keeps 'unsafe-inline' because React/motion write inline style
//    attributes; styles can't execute code, and scripts stay locked down.
//  - img-src allows any https host because member avatars come from
//    LeetCode, Codeforces and CodinGame CDNs (plus data:/blob: for the
//    generated default avatars and downloadable share cards).
//  - connect-src 'self': the frontend only ever talks to this app's /api.
//  - frame-ancestors 'none' is the modern equivalent of X-Frame-Options: DENY.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_SCRIPT_HASHES.map((h) => `'${h}'`).join(" ")}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join("; ");

// Features this app never uses, switched off so injected or embedded content
// can't request them. (clipboard-write is left alone: the share cards use it.)
export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "interest-cohort=()"
].join(", ");

// Sent on every response, in every environment.
export const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": PERMISSIONS_POLICY,
  "Cross-Origin-Opener-Policy": "same-origin"
};

// Sent only in production. The dev server needs inline scripts for hot reload,
// which the CSP would block, and HSTS must never be pinned on localhost.
export const PRODUCTION_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Strict-Transport-Security": "max-age=31536000"
};

// What vercel.json must send for the static frontend.
export const STATIC_SITE_HEADERS: Record<string, string> = { ...BASE_HEADERS, ...PRODUCTION_HEADERS };

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  for (const [name, value] of Object.entries(BASE_HEADERS)) res.setHeader(name, value);
  if (IS_PRODUCTION) {
    for (const [name, value] of Object.entries(PRODUCTION_HEADERS)) res.setHeader(name, value);
  }
  // Every API response is per-visitor or fast-changing: never let a browser or
  // a shared proxy keep a copy.
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  next();
}
