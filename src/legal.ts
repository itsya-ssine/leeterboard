// Settings and routing for the legal pages (Privacy Policy, Terms of Service).
//
// Everything the owner must fill in lives in LEGAL below, in one place, so the
// two pages never disagree about who to contact or when they changed. Values
// that still start with "REPLACE_ME" are release blockers: `npm run legal:check`
// fails while any remain.
//
// The pages are served at real paths (/privacy and /terms), not behind the
// URL hash the rest of the app uses. A stable, crawlable URL is what Google's
// OAuth consent-screen verification asks for, and it lets anyone link to the
// policy without signing in.

export const LEGAL = {
  serviceName: "Leeterboard",
  siteUrl: "https://leaderboard-leet.vercel.app",
  sourceUrl: "https://github.com/itsya-ssine/leeterboard",

  /** Who runs the service: a person's name, or the club / organisation. */
  operatorName: "ELMAJDOUBI Yassine",
  /** A mailbox you read. Used for privacy requests, account help and legal notices. */
  contactEmail: "elmajdoubiyassine5@gmail.com",
  /** Country (and, if you like, region) whose law governs the Terms, e.g. "Morocco". */
  governingLaw: "Morocco",

  /** ISO date (YYYY-MM-DD). Bump it whenever either page changes in substance. */
  effectiveDate: "2026-11-13"
} as const;

// Retention periods quoted in the Privacy Policy. They mirror constants in the
// code (HISTORY_LIMIT and NOTIFICATIONS_KEEP_DAYS in db.ts); if you change
// those, change these.
export const RETENTION = {
  historyDays: 60,
  notificationDays: 90,
  sessionDays: 7
} as const;

export type LegalPageId = "privacy" | "terms";

export const LEGAL_PATHS: Record<LegalPageId, string> = {
  privacy: "/privacy",
  terms: "/terms"
};

/**
 * Which legal page a URL path asks for, or null for anything else.
 * Tolerates a trailing slash and letter case ("/Privacy/" is the policy).
 */
export function legalPageFromPath(pathname: string): LegalPageId | null {
  const clean = pathname.replace(/\/+$/, "").toLowerCase();
  if (clean === LEGAL_PATHS.privacy) return "privacy";
  if (clean === LEGAL_PATHS.terms) return "terms";
  return null;
}

/** Entries of LEGAL that still hold a placeholder. Empty means ready to release. */
export function unfilledLegalFields(legal: Record<string, string> = LEGAL): string[] {
  return Object.entries(legal)
    .filter(([, value]) => value.startsWith("REPLACE_ME"))
    .map(([key]) => key);
}
