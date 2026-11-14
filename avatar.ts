/**
 * Avatar URL validation and host allow-listing (SEC-09).
 * Prevents arbitrary third-party URLs, tracking pixels, mixed content, or malicious assets.
 */

export const AVATAR_HOSTS = new Set([
  "assets.leetcode.com",
  "leetcode.com",
  "userpic.codeforces.org",
  "userpic.codeforces.com",
  "static.codingame.com",
  "avatars.githubusercontent.com",
  "lh3.googleusercontent.com"
]);

export function safeAvatar(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed, "https://leetcode.com");
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase();
    if (!AVATAR_HOSTS.has(hostname) && !hostname.endsWith(".leetcode.com")) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
