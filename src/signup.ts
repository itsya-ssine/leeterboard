import { checkEmail } from "../emails.js";
import { checkUsername } from "../usernames.js";

// Client-side check of the sign-up form, so obvious mistakes are explained
// without a round trip. The server applies the same rules (usernames.ts is the
// very same file; the password limits mirror MIN/MAX_PASSWORD_LENGTH in auth.ts)
// and is the one that decides: it also answers "That username is taken."
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Validate the public username chosen after OAuth has verified the email. */
export function checkSignupUsername(username: string): string | null {
  const name = checkUsername(username);
  return name.ok ? null : name.error;
}

/** A message to show next to the legacy form, or null when it looks fine. */
export function checkSignup(username: string, password: string, email?: string): string | null {
  const name = checkUsername(username);
  if (!name.ok) return name.error;
  if (email !== undefined) {
    const problem = checkEmailInput(email);
    if (problem) return problem;
  }
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (password.toLowerCase() === name.username) return "Password can't be the same as your username.";
  return null;
}

/**
 * The e-mail rules the server applies (emails.ts is the very same file: length,
 * exactly one "@", no spaces or line breaks, a plausible domain), as a message
 * for the form or null. The list of allowed domains (ALLOWED_EMAIL_DOMAINS) is
 * a server setting the browser doesn't know: when it refuses an address the
 * form simply shows the server's message.
 */
export function checkEmailInput(email: string): string | null {
  const checked = checkEmail(email);
  return checked.ok ? null : checked.error;
}

/** A new password on its own (forgot-password form), without a username to compare to. */
export function checkNewPassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  return null;
}

// The verification code from the e-mail: 6 digits. People paste it with a space
// or a hyphen in the middle ("123 456"), and the server accepts that too
// (parseCodeInput in emailCodes.ts); this does the same so the form doesn't
// refuse what the server would take.
export const EMAIL_CODE_LENGTH = 6;

/** The code as the server will read it: whitespace and hyphens removed. */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, "");
}

/** A message to show next to the code field, or null when it looks right. */
export function checkCode(input: string): string | null {
  const code = normalizeCode(input);
  if (code === "") return "Enter the 6-digit code from the email.";
  if (!/^[0-9]+$/.test(code)) return "The code is made of digits only.";
  if (code.length !== EMAIL_CODE_LENGTH) return `The code has ${EMAIL_CODE_LENGTH} digits.`;
  return null;
}

// The server makes a code wait 60 seconds before it sends another one to the same
// address (SIGNUP_RESEND_COOLDOWN_MS in server.ts); the Resend button counts down
// the same time.
export const RESEND_WAIT_SECONDS = 60;

// Shown once, right after sign-up, on the account page the new member lands on.
export const AFTER_SIGNUP_PROMPT = "Link your accounts to appear on the leaderboards.";
