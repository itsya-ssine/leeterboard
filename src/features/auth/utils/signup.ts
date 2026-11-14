import { checkUsername } from "../../../../usernames.js";
import type { OAuthProvider } from "../services/authApi.js";

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

/** Providers are shown in a stable order. Linked providers remain visible even
 * when they are no longer enabled for new sign-ins, so members can disconnect. */
export function visibleOAuthProviders(
  enabled: OAuthProvider[],
  linked: OAuthProvider[] = []
): OAuthProvider[] {
  const available = new Set([...enabled, ...linked]);
  return (["github", "google"] as const).filter((provider) => available.has(provider));
}

/** A provider can be disconnected only when another sign-in method remains. */
export function canDisconnectOAuthProvider(
  methods: { password: boolean; providers: OAuthProvider[] },
  provider: OAuthProvider
): boolean {
  return methods.providers.includes(provider) &&
    (methods.password || methods.providers.some((connected) => connected !== provider));
}

// Shown once, right after sign-up, on the account page the new member lands on.
export const AFTER_SIGNUP_PROMPT = "Link your accounts to appear on the leaderboards.";
