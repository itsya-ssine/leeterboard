// Per-address limit on how many verification mails the server will send to ONE
// e-mail address, so the sign-up (and later the add-email and reset) routes
// can't be used to mail-bomb a stranger. The per-IP limiters in rateLimit.ts
// stop one machine; this stops a crowd of them aimed at one inbox.
//
// - 3 code requests per hour per address (the 60-second resend wait is
//   separate, in db.ts startPendingEmailCode).
// - Counted per PURPOSE ("signup", "add_email", "reset"): someone spamming
//   sign-ups for an address can't use that to also lock its owner out of a
//   password reset.
// - Counted BEFORE anything is looked up or sent and identically whether or not
//   the address has an account, so hitting the limit says nothing about it.
// - Keyed on a keyed hash of the address (emailLimitKey), never the address,
//   in the same rate_limits table and store the other sensitive limiters use,
//   so the count is shared by every serverless instance.
import type { Options } from "express-rate-limit";
import { emailLimitKey } from "./emailCodes.js";
import { DbRateLimitStore } from "./rateLimitStore.js";
import type { EmailCodePurpose } from "./db.js";

export const EMAIL_STARTS_PER_HOUR = 3;
export const EMAIL_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const EMAIL_RATE_LIMITED_MESSAGE = "Too many codes were requested for this address. Please try again later.";

// One store per purpose, so the key prefix keeps the counters apart.
const stores = new Map<EmailCodePurpose, DbRateLimitStore>();
function storeFor(purpose: EmailCodePurpose): DbRateLimitStore {
  let store = stores.get(purpose);
  if (!store) {
    store = new DbRateLimitStore(`email-${purpose}`);
    store.init({ windowMs: EMAIL_LIMIT_WINDOW_MS } as Options);
    stores.set(purpose, store);
  }
  return store;
}

export interface EmailQuota {
  allowed: boolean;
  /** Hand back to refundEmailQuota when nothing was sent after all. */
  key: string;
}

/** Counts one code request for this address; `allowed` is false from the 4th in an hour. */
export async function takeEmailQuota(purpose: EmailCodePurpose, email: string): Promise<EmailQuota> {
  const key = emailLimitKey(email);
  const { totalHits } = await storeFor(purpose).increment(key);
  return { allowed: totalHits <= EMAIL_STARTS_PER_HOUR, key };
}

/**
 * Gives one request back. For a request that ended without mailing anyone (the
 * resend wait refused it, or the provider was down), so an honest person's
 * early "Resend" click or a provider outage doesn't use up their three.
 */
export async function refundEmailQuota(purpose: EmailCodePurpose, quota: EmailQuota): Promise<void> {
  await storeFor(purpose).decrement(quota.key);
}
