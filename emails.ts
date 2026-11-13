// Rules for the e-mail address a member gives to verify their account and to
// recover a password. Kept free of I/O (and of Node imports) so it can be
// unit-tested and, later, reused by the browser; the server calls it from the
// sign-up, add-e-mail and password-reset routes. Modelled on usernames.ts.
//
// The aim is "an address a mail server could plausibly deliver to", not full
// RFC 5322. The strictness is on purpose: the address ends up in a mail header
// and in logs, so anything that could break out of either (spaces, CR/LF,
// control characters, quotes, angle brackets, commas) is refused outright.
// Quoted local parts, comments, IP-literal domains and non-ASCII addresses are
// not supported. Deliberately NOT done: stripping "+tags" or dots. Those are
// part of the address the person typed, and removing them would merge or
// invent addresses. Uniqueness is on the lowercase form only.

export const EMAIL_MAX_LENGTH = 254; // RFC 5321: a path of 256 octets, minus the angle brackets
export const EMAIL_LOCAL_MAX_LENGTH = 64;
const DOMAIN_LABEL_MAX_LENGTH = 63;

// Whitespace and every ASCII control character, DEL included (so CR, LF, TAB, NUL).
// eslint-disable-next-line no-control-regex
const SPACE_OR_CONTROL_RE = /[\u0000-\u0020\u007f]/;
// eslint-disable-next-line no-control-regex
const NON_ASCII_RE = /[^\u0000-\u007f]/;

// "atext" from RFC 5322: letters, digits and these symbols, in dot-separated
// words. No empty word, so no leading, trailing or doubled dot.
const LOCAL_PART_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
// One domain label: letters, digits and hyphens, not starting or ending with a hyphen.
const DOMAIN_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
// The last label: at least two characters and not all digits (so "1.2.3.4" is never a domain).
const TLD_RE = /^(?=.*[a-z])[a-z0-9-]{2,}$/;

export type EmailCheck = { ok: true; email: string } | { ok: false; error: string };

/** The form an address is stored and compared in: trimmed and lowercase. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

const INVALID = "Enter a valid email address.";

function checkDomain(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length < 2) return false; // "user@localhost" can't receive mail from the internet
  if (!labels.every((l) => l.length <= DOMAIN_LABEL_MAX_LENGTH && DOMAIN_LABEL_RE.test(l))) return false;
  return TLD_RE.test(labels[labels.length - 1]);
}

/**
 * Checks an address someone typed. On success `email` is the form to store and
 * compare. On failure `error` is a message that is safe to show to the person.
 *
 * `allowedDomains` is the list from `parseAllowedDomains`. Empty means any
 * domain; otherwise the address's domain must match one entry exactly
 * ("school.edu" does not allow "mail.school.edu").
 */
export function checkEmail(input: unknown, allowedDomains: readonly string[] = []): EmailCheck {
  if (typeof input !== "string" || input.trim() === "") {
    return { ok: false, error: "Email is required." };
  }
  // Trimming first means a stray trailing newline from a paste is harmless; a
  // line break anywhere inside the address is still refused below.
  const email = normalizeEmail(input);

  if (email.length > EMAIL_MAX_LENGTH) {
    return { ok: false, error: "That email address is too long." };
  }
  if (SPACE_OR_CONTROL_RE.test(email)) {
    return { ok: false, error: "Email can't contain spaces or line breaks." };
  }
  if (NON_ASCII_RE.test(email)) {
    return { ok: false, error: "Email addresses with accented or non-Latin characters aren't supported." };
  }

  const parts = email.split("@");
  if (parts.length !== 2) return { ok: false, error: INVALID };
  const [local, domain] = parts;

  if (local.length === 0 || local.length > EMAIL_LOCAL_MAX_LENGTH || !LOCAL_PART_RE.test(local)) {
    return { ok: false, error: INVALID };
  }
  if (!checkDomain(domain)) return { ok: false, error: INVALID };

  if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
    return { ok: false, error: "Sign-up is limited to email addresses from approved domains." };
  }
  return { ok: true, email };
}

/**
 * Reads ALLOWED_EMAIL_DOMAINS: comma-separated, trimmed, lowercase, with empty
 * entries dropped and repeats removed. An empty or missing value gives an empty
 * list, which means "any domain".
 *
 * Entries are not validated. That is deliberate: a mistyped entry then matches
 * nothing, so the site stays restricted rather than silently opening up. One
 * leniency: a leading "@" ("@school.edu") is dropped, because that is the most
 * common way to write a domain and would otherwise lock everyone out.
 */
export function parseAllowedDomains(env: string | undefined | null): string[] {
  if (typeof env !== "string") return [];
  const domains = env
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter((d) => d !== "");
  return [...new Set(domains)];
}

/**
 * A form of the address that is safe for logs and for the screen: the first
 * letter, three stars and the domain ("alice@example.com" -> "a***@example.com").
 * A one-character local part, or anything that isn't an address, is fully
 * hidden so nothing extra is given away.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 2 || at === email.length - 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
