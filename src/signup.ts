import { checkEmail } from "../emails.js";
import { checkUsername } from "../usernames.js";

/** Validate the public username chosen after OAuth has verified the email. */
export function checkSignupUsername(username: string): string | null {
  const name = checkUsername(username);
  return name.ok ? null : name.error;
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled. You can try again.",
  failed: "We couldn't sign you in. Please try again.",
  unverified_email: "Your provider account doesn't have a verified email address.",
  email_in_use: "An account already uses this email. Sign in the way you did before, then connect this provider in Account settings.",
  domain_not_allowed: "Sign-up with this email domain isn't allowed.",
  expired: "This sign-up has expired. Please start again.",
  unavailable: "Sign-up is temporarily unavailable. Please try again later.",
  admin_refused: "Admin accounts must sign in with a password.",
  already_linked: "This provider is already connected to another account."
};

/** Only known OAuth callback codes get a message; arbitrary query text is ignored. */
export function oauthErrorMessage(code: string | null): string | null {
  if (code === null || !Object.prototype.hasOwnProperty.call(OAUTH_ERROR_MESSAGES, code)) return null;
  return OAUTH_ERROR_MESSAGES[code];
}

/**
 * The e-mail rules the server applies (emails.ts is the very same file: length,
 * exactly one "@", no spaces or line breaks, a plausible domain), as a message
 * for the Account settings form or null. The list of allowed domains is a
 * server setting the browser doesn't know: when it refuses an address the form
 * simply shows the server's message.
 */
export function checkEmailInput(email: string): string | null {
  const checked = checkEmail(email);
  return checked.ok ? null : checked.error;
}

// The verification code for the Account settings e-mail change: 6 digits.
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

/** The server's wait before another e-mail change code can be requested. */
export const RESEND_WAIT_SECONDS = 60;

// Shown once, right after sign-up, on the account page the new member lands on.
export const AFTER_SIGNUP_PROMPT = "Link your accounts to appear on the leaderboards.";
