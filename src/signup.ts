import { checkUsername } from "../usernames.js";

// Client-side check of the sign-up form, so obvious mistakes are explained
// without a round trip. The server applies the same rules (usernames.ts is the
// very same file; the password limits mirror MIN/MAX_PASSWORD_LENGTH in auth.ts)
// and is the one that decides: it also answers "That username is taken."
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** A message to show next to the form, or null when it looks fine. */
export function checkSignup(username: string, password: string): string | null {
  const name = checkUsername(username);
  if (!name.ok) return name.error;
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (password.toLowerCase() === name.username) return "Password can't be the same as your username.";
  return null;
}

// Shown once, right after sign-up, on the account page the new member lands on.
export const AFTER_SIGNUP_PROMPT = "Link your accounts to appear on the leaderboards.";
