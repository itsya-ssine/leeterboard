// The 6-digit codes e-mailed to prove someone controls an address, and the
// plain-text mails that carry them. No I/O and no database: db.ts stores what
// hashCode returns, mailer.ts sends what the builders return, and the routes
// (steps 6 to 10) decide when each one happens.
//
// Why the code is stored as a keyed hash and not as the code or a plain SHA-256:
// there are only a million possible codes, so an unkeyed hash of one could be
// reversed instantly by anyone who copied the database (a leaked backup, say).
// With an HMAC under a key derived from JWT_SECRET, the stored value is useless
// without the server's secret. The pending row's id is part of what is hashed,
// so a hash can't be copied from one row to another.
//
// The guessing limit (5 wrong tries, then the row is deleted) and the 10-minute
// expiry live in the routes and in db.ts; this file only supplies the pieces.
import crypto from "node:crypto";

export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_CODE_TTL_MINUTES = 10;

// Mixed into the key derivation so the key that protects these hashes is not
// the key that signs sessions (auth.ts uses JWT_SECRET directly for those).
// Changing this string invalidates every code that is waiting to be entered:
// harmless (they live ten minutes) but deliberate.
const KEY_LABEL = "leeterboard/email-code/v1";
// Same idea for the per-address rate-limit keys (emailLimit.ts): a third key,
// so a copy of the rate_limits table can't be used to test guesses of addresses.
const LIMIT_KEY_LABEL = "leeterboard/email-limit/v1";

const CODE_RE = /^\d{6}$/;
const HASH_RE = /^[0-9a-f]{64}$/i;

/** A fresh code: six digits, zero-padded, from the OS's secure random source. */
export function generateCode(): string {
  return String(crypto.randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, "0");
}

function derivedKey(label: string): Buffer {
  const secret = process.env.JWT_SECRET;
  // Thrown, not swallowed into "wrong code": a missing secret is a broken
  // deployment, and every verification failing quietly would hide that.
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or too short; it is needed to key the e-mail code hashes.");
  }
  return crypto.createHmac("sha256", secret).update(label).digest();
}

const codeKey = () => derivedKey(KEY_LABEL);

/**
 * The key a per-address rate limit counts under: lowercase hex HMAC-SHA256 of
 * the (normalised) address. The address itself never reaches the rate_limits
 * table, and without the server's secret the key can't be recomputed from a
 * guessed address.
 */
export function emailLimitKey(email: string): string {
  if (typeof email !== "string" || email === "") throw new TypeError("emailLimitKey needs an address.");
  return crypto.createHmac("sha256", derivedKey(LIMIT_KEY_LABEL)).update(email.trim().toLowerCase()).digest("hex");
}

/**
 * What is stored in pending_email_codes.code_hash: lowercase hex HMAC-SHA256
 * over `${pendingId}:${code}`. The code is always exactly six digits, so the
 * pair can't be read two ways.
 */
export function hashCode(pendingId: string, code: string): string {
  if (typeof pendingId !== "string" || pendingId === "") throw new TypeError("hashCode needs the pending id.");
  if (typeof code !== "string" || !CODE_RE.test(code)) throw new TypeError("hashCode needs a 6-digit code.");
  return crypto.createHmac("sha256", codeKey()).update(`${pendingId}:${code}`).digest("hex");
}

/**
 * Whether `code` is the one `storedHash` was made from, compared in constant
 * time. Anything malformed (wrong type, wrong length, not digits, a stored
 * value that isn't a SHA-256 hex digest) is simply false, never an exception.
 */
export function codeMatches(pendingId: unknown, code: unknown, storedHash: unknown): boolean {
  if (typeof pendingId !== "string" || pendingId === "") return false;
  if (typeof code !== "string" || !CODE_RE.test(code)) return false;
  if (typeof storedHash !== "string" || !HASH_RE.test(storedHash)) return false;
  const expected = Buffer.from(hashCode(pendingId, code), "hex");
  const actual = Buffer.from(storedHash, "hex");
  // Both are 32 bytes here (the checks above), which timingSafeEqual requires.
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * What a person typed into the code box, as the six digits it stands for, or
 * null when it can't be one. Spaces and hyphens are dropped so a pasted
 * "123 456" or "123-456" works; letters, other digits (such as Arabic-Indic
 * ones) and the wrong length do not.
 */
export function parseCodeInput(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const digits = input.replace(/[\s-]/g, "");
  return CODE_RE.test(digits) ? digits : null;
}

/* ---------- The mails ----------
 * Plain text only, ASCII only, no links (a link in a mail like this is what a
 * phishing mail looks like; the person goes to the site themselves). A code
 * appears exactly once, never in the subject, which shows on lock screens.
 */

export interface MailContent {
  subject: string;
  text: string;
}

function minutesText(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 1) throw new RangeError("The expiry must be a whole number of minutes.");
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function checkedCode(code: string): string {
  if (typeof code !== "string" || !CODE_RE.test(code)) throw new TypeError("A mail needs a 6-digit code.");
  return code;
}

function codeMail(subject: string, intro: string, code: string, minutes: number, ignore: string): MailContent {
  return {
    subject,
    text: [
      intro,
      "",
      checkedCode(code),
      "",
      `It expires in ${minutesText(minutes)}, and it works once. Do not share it with anyone: nobody from Leeterboard will ever ask you for it.`,
      "",
      ignore
    ].join("\n")
  };
}

/** The code that finishes creating an account. */
export function signupCodeMail(code: string, minutes = EMAIL_CODE_TTL_MINUTES): MailContent {
  return codeMail(
    "Your Leeterboard verification code",
    "Use this code to finish creating your Leeterboard account:",
    code,
    minutes,
    "If you did not try to sign up, ignore this email. No account will be created."
  );
}

/** The code that confirms an address a signed-in member wants to add. */
export function addEmailCodeMail(code: string, minutes = EMAIL_CODE_TTL_MINUTES): MailContent {
  return codeMail(
    "Confirm your email address for Leeterboard",
    "Use this code to add this email address to your Leeterboard account:",
    code,
    minutes,
    "If you did not ask to add this address, ignore this email. Nothing will be changed."
  );
}

/** The code that lets someone choose a new password. */
export function passwordResetCodeMail(code: string, minutes = EMAIL_CODE_TTL_MINUTES): MailContent {
  return codeMail(
    "Your Leeterboard password reset code",
    "Use this code to reset your Leeterboard password:",
    code,
    minutes,
    "If you did not ask to reset your password, ignore this email. Your password will not change."
  );
}

/**
 * Sent instead of a code when someone starts a sign-up with an address that
 * already has an account. It carries no code and no account detail: it goes to
 * the address's owner, and the person who typed the address learns nothing from
 * it (the page answers them exactly as it does for a new address).
 */
export function alreadyRegisteredMail(): MailContent {
  return {
    subject: "About your Leeterboard sign-up",
    text: [
      "Someone tried to sign up for Leeterboard with this email address, but it already belongs to an account.",
      "",
      "If that was you, sign in with your username and password. If you have forgotten your password, choose \"Forgot password\" on the sign-in page.",
      "",
      "If it was not you, you can ignore this email. Nothing has been changed."
    ].join("\n")
  };
}

/** Sent after a password changes, so an owner who didn't do it finds out. */
export function passwordChangedMail(): MailContent {
  return {
    subject: "Your Leeterboard password was changed",
    text: [
      "The password for your Leeterboard account was just changed.",
      "",
      "If you did this, there is nothing more to do.",
      "",
      "If you did not, choose \"Forgot password\" on the sign-in page right away to set a new one, and tell the site admins."
    ].join("\n")
  };
}
