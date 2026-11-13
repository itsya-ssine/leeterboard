// Routing and shared numbers for the "How scoring works" (FAQ) page.
//
// Like /privacy and /terms it lives at a real path, not behind the URL hash, so
// anyone can read it (and link to it) without signing in.
//
// SYNC_MINUTES mirrors AUTO_SYNC_STALE_MS in server.ts and POLL_SECONDS mirrors
// POLL_INTERVAL_MS in App.tsx; tests/faq.test.ts fails if they drift apart.

export const FAQ_PATH = "/faq";

/** Bump when the page's content changes in substance (ISO date, YYYY-MM-DD). */
export const FAQ_UPDATED = "2026-11-13";

export const SYNC_MINUTES = 30;
export const POLL_SECONDS = 15;

/** True for /faq, with a trailing slash or any letter case; false for everything else. */
export function isFaqPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "").toLowerCase() === FAQ_PATH;
}
