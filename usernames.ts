// Rules for the name a new member picks to sign in with. Kept free of I/O so it
// can be unit-tested; server.ts calls it from the sign-up route.
//
// These rules are for CHOOSING a name. They are deliberately stricter than the
// names that already exist: members who signed up with a LeetCode handle were
// given that handle (lowercased) as their login name, and LeetCode allows "-"
// and ".", which are not allowed here. Signing in must therefore not reuse this
// check; it only needs to normalise (trim, lowercase) whatever was typed.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

// ASCII only, on purpose: no look-alike letters from other alphabets, no spaces,
// nothing that needs escaping in a URL or a log line. In JavaScript "$" matches
// only at the very end, so a trailing newline can't slip through.
const USERNAME_RE = /^[A-Za-z0-9_]+$/;

// Names that would let someone pass for the site or its staff. Compared in
// lowercase. Only applies to choosing a name; it never locks out an existing
// member.
const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "anonymous",
  "deleted",
  "help",
  "leetcode",
  "leeterboard",
  "mod",
  "moderator",
  "null",
  "official",
  "owner",
  "root",
  "security",
  "staff",
  "support",
  "sysadmin",
  "system",
  "undefined"
]);

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase());
}

export type UsernameCheck = { ok: true; username: string } | { ok: false; error: string };

/**
 * Checks a name someone typed into the sign-up form. On success `username` is
 * the form to store and compare: trimmed and lowercase. On failure `error` is a
 * message that is safe to show to the person.
 */
export function checkUsername(value: unknown): UsernameCheck {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: "Username is required." };
  }
  const trimmed = value.trim();
  if (trimmed.length < USERNAME_MIN_LENGTH || trimmed.length > USERNAME_MAX_LENGTH) {
    return { ok: false, error: `Username must be ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters.` };
  }
  if (!USERNAME_RE.test(trimmed)) {
    return { ok: false, error: "Username can only use letters, numbers and underscores." };
  }
  if (!/[A-Za-z0-9]/.test(trimmed)) {
    return { ok: false, error: "Username must include at least one letter or number." };
  }
  const username = trimmed.toLowerCase();
  if (isReservedUsername(username)) {
    return { ok: false, error: "That username isn't available." };
  }
  return { ok: true, username };
}

/** The lowercase username, or null when the name isn't acceptable. */
export function parseUsername(value: unknown): string | null {
  const check = checkUsername(value);
  return check.ok ? check.username : null;
}
