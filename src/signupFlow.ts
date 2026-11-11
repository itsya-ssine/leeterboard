// The decisions of the code-entry step shared by the e-mail sign-up form (and,
// later, the forgot-password and add-e-mail forms), as plain functions so they
// can be tested without a browser: what to do with an error from a "verify"
// call, how many seconds of the resend wait are left, and what the step says.
import { AuthError } from "./authApi.js";
import { EMAIL_CODE_LENGTH, RESEND_WAIT_SECONDS } from "./signup.js";

/**
 * What a failed "verify" means for the form.
 *  - "retry":   the request is still open (a wrong code, a lost connection): stay
 *               on the code step, show the message, let the person type again.
 *  - "restart": the request is gone (expired, locked after too many wrong codes,
 *               already used) or can't be completed (the username was taken in
 *               the meantime): go back to the first step with the message.
 */
export interface CodeFailure {
  message: string;
  action: "retry" | "restart";
}

export function classifyCodeError(err: unknown): CodeFailure {
  if (!(err instanceof AuthError)) {
    return { message: "Something went wrong. Please try again.", action: "retry" };
  }
  // `expired` is set by the server for an expired, used or locked request; a 409
  // here is the username having been taken between the two steps (the request
  // is consumed either way).
  if (err.expired || err.status === 409) return { message: err.message, action: "restart" };
  return { message: err.message, action: "retry" };
}

/** Whole seconds of the resend wait still to go, from when the last code was requested. 0 = may resend. */
export function secondsLeft(sentAtMs: number, nowMs: number, waitSeconds: number = RESEND_WAIT_SECONDS): number {
  const left = Math.ceil(waitSeconds - (nowMs - sentAtMs) / 1000);
  return Math.min(waitSeconds, Math.max(0, left));
}

/** The line that tells the person where the code went. `maskedEmail` is the server's masked form. */
export function codeSentMessage(maskedEmail: string): string {
  return `We sent a ${EMAIL_CODE_LENGTH}-digit code to ${maskedEmail}.`;
}

/**
 * The line on the code step of "forgot password". Unlike sign-up it does not
 * claim a code was sent: the server answers the same whether or not the address
 * has an account, so the form says "if". `maskedEmail` is the address the
 * person just typed, masked in the browser (maskEmail in emails.ts), never
 * anything the server said about it.
 */
export function resetSentMessage(maskedEmail: string): string {
  return `If ${maskedEmail} has an account, we sent a ${EMAIL_CODE_LENGTH}-digit code to it.`;
}

/** What the Resend button says: the countdown while it is disabled. */
export function resendLabel(seconds: number): string {
  return seconds > 0 ? `Resend code in ${seconds}s` : "Resend code";
}
