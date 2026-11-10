// Sending e-mail (verification codes, "this address is already registered",
// "your password was changed"), behind one small interface so the provider can
// be swapped without touching a route.
//
//   EMAIL_PROVIDER    resend | outbox   (outbox is for development, never production)
//   EMAIL_API_KEY     the provider's API key (server-side only, never a VITE_ variable)
//   EMAIL_FROM        sender on a domain you control, e.g. Leeterboard <no-reply@example.com>
//   EMAIL_OUTBOX_DIR  folder the outbox provider writes to (development only)
//
// What this module promises:
//   * Nothing that identifies a message (the address, the subject, the text or
//     the code inside it) or the API key ever appears in an error message or a
//     log line. MailError carries a fixed sentence and, at most, an HTTP status.
//   * Nothing in a header (recipient, subject, sender) can contain a line break.
//   * One send is one request: no retry, so a slow provider can't cause the
//     same code to be mailed twice.
//   * Misconfiguration never silently "works": without a usable provider,
//     getMailer() is null and the routes must answer 503 instead of accepting
//     sign-ups nobody can verify.
//   * The outbox provider refuses to start in production, because each file it
//     writes holds a live code.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkEmail } from "./emails.js";

export const RESEND_URL = "https://api.resend.com/emails";
// Short enough to fit a serverless function's time limit, long enough for a
// provider having a slow moment.
export const MAIL_TIMEOUT_MS = 8000;
const MAX_SUBJECT_LENGTH = 200;
const MAX_TEXT_LENGTH = 10_000;

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly provider: "resend" | "outbox";
  /** Resolves once the provider accepted the message; throws MailError otherwise. */
  send(message: MailMessage): Promise<void>;
}

// invalid  - the message itself was refused before anything was sent (a bug in the caller)
// rejected - the provider answered with an error status (bad key, unverified domain, rate limit...)
// timeout  - no answer in time; the message MAY still have been delivered
// network  - the provider could not be reached
export type MailErrorKind = "invalid" | "rejected" | "timeout" | "network";

export class MailError extends Error {
  readonly kind: MailErrorKind;
  readonly status?: number;
  constructor(kind: MailErrorKind, message: string, status?: number) {
    super(message);
    this.name = "MailError";
    this.kind = kind;
    this.status = status;
  }
}

/* ---------- Configuration policy ----------
 * Pure, like runtimeEnvPolicy.ts: it decides, server.ts applies. Messages name
 * the variable that is wrong, never its value.
 */

export type MailConfig =
  | { provider: "resend"; apiKey: string; from: string }
  | { provider: "outbox"; dir: string; from: string | null };

export interface MailDecision {
  /** Null when no provider is usable: sign-up and e-mail reset must answer 503. */
  config: MailConfig | null;
  /** Printed at boot; the server keeps going. */
  warnings: string[];
  /** When set, the server must refuse to start with this message. */
  fatal: string | null;
}

function isProductionEnv(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === "production" || Boolean(env.VERCEL);
}

// "alice@example.com" or "Name <alice@example.com>". The name may not contain
// control characters, angle brackets or quotes; the address must pass checkEmail.
const SENDER_RE = /^(?:([^<>"\u0000-\u001f\u007f]{1,100}?)\s*<([^<>\s]+)>|([^<>\s]+))$/;

/** The sender as it will be sent, or null when it isn't a valid sender. */
export function parseSender(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = SENDER_RE.exec(trimmed);
  if (!match) return null;
  const address = match[2] ?? match[3];
  return checkEmail(address).ok ? trimmed : null;
}

export function decideMail(env: Record<string, string | undefined>): MailDecision {
  const production = isProductionEnv(env);
  const provider = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();

  const unconfigured = (why: string): MailDecision => ({
    config: null,
    warnings: [
      production
        ? `Email is NOT configured (${why}). Sign-up and password reset by email are unavailable, and answer 503, until it is.`
        : `Email is not configured (${why}). Sign-up needs it. For local development set EMAIL_PROVIDER=outbox and EMAIL_OUTBOX_DIR=<a folder>.`
    ],
    fatal: null
  });

  if (provider === "") return unconfigured("EMAIL_PROVIDER is not set");

  if (provider === "outbox") {
    if (production) {
      return {
        config: null,
        warnings: [],
        fatal:
          "EMAIL_PROVIDER=outbox is for development and tests only: it writes every verification code to a file. " +
          "Refusing to start in production. Set EMAIL_PROVIDER=resend."
      };
    }
    const dir = (env.EMAIL_OUTBOX_DIR ?? "").trim();
    if (!dir) return unconfigured("EMAIL_OUTBOX_DIR is not set");
    return {
      config: { provider: "outbox", dir, from: parseSender(env.EMAIL_FROM) },
      warnings: [`Using the outbox mail provider: every message, verification codes included, is written to ${dir}.`],
      fatal: null
    };
  }

  if (provider === "resend") {
    const apiKey = (env.EMAIL_API_KEY ?? "").trim();
    const from = parseSender(env.EMAIL_FROM);
    const problems: string[] = [];
    if (!apiKey) problems.push("EMAIL_API_KEY is not set");
    else if (/[\s\u0000-\u001f\u007f]/.test(apiKey)) problems.push("EMAIL_API_KEY contains a space or line break");
    if (!from) problems.push("EMAIL_FROM is not set or is not a valid sender address");
    if (problems.length > 0) return unconfigured(problems.join("; "));
    return { config: { provider: "resend", apiKey, from: from as string }, warnings: [], fatal: null };
  }

  // Deliberately not echoed: someone may have pasted a key into the wrong variable.
  return unconfigured("EMAIL_PROVIDER is not a supported value; use resend");
}

/* ---------- Message checks ---------- */

// Control characters (CR and LF included) and the Unicode line separators.
const HEADER_UNSAFE_RE = /[\u0000-\u001f\u007f\u2028\u2029]/;

interface CleanMessage {
  to: string;
  subject: string;
  text: string;
}

// Throws MailError("invalid") with a fixed sentence: the offending value is
// never put in the message.
function cleanMessage(message: MailMessage): CleanMessage {
  const to = checkEmail(message?.to);
  if (!to.ok) throw new MailError("invalid", "The recipient is not a valid address.");

  const { subject, text } = message;
  if (typeof subject !== "string" || subject.trim() === "") {
    throw new MailError("invalid", "The subject is empty.");
  }
  if (subject.length > MAX_SUBJECT_LENGTH) throw new MailError("invalid", "The subject is too long.");
  if (HEADER_UNSAFE_RE.test(subject)) throw new MailError("invalid", "The subject contains a line break or control character.");

  if (typeof text !== "string" || text.trim() === "") throw new MailError("invalid", "The message text is empty.");
  if (text.length > MAX_TEXT_LENGTH) throw new MailError("invalid", "The message text is too long.");
  if (text.includes("\u0000")) throw new MailError("invalid", "The message text contains a null character.");

  return { to: to.email, subject, text };
}

/* ---------- Providers ---------- */

export interface MailerDeps {
  /** Defaults to the global fetch, looked up at send time (so tests can preload a fake). */
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Defaults to what the environment says; the outbox provider refuses when true. */
  production?: boolean;
}

function resendMailer(config: Extract<MailConfig, { provider: "resend" }>, deps: MailerDeps): Mailer {
  return {
    provider: "resend",
    async send(message) {
      const { to, subject, text } = cleanMessage(message);
      const doFetch = deps.fetch ?? globalThis.fetch;
      let res: Response;
      try {
        res = await doFetch(RESEND_URL, {
          method: "POST",
          // A redirect would carry the Bearer token to another host.
          redirect: "error",
          signal: AbortSignal.timeout(deps.timeoutMs ?? MAIL_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ from: config.from, to: [to], subject, text })
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
          throw new MailError("timeout", "The mail provider did not answer in time.");
        }
        // The underlying error is dropped on purpose: it can quote the request.
        throw new MailError("network", "The mail provider could not be reached.");
      }
      // The body is never read (an error body can quote the recipient); release the socket.
      try {
        await res.body?.cancel();
      } catch {
        /* already closed */
      }
      if (!res.ok) {
        throw new MailError("rejected", `The mail provider refused the message (HTTP ${res.status}).`, res.status);
      }
    }
  };
}

let outboxSequence = 0;

function outboxMailer(config: Extract<MailConfig, { provider: "outbox" }>): Mailer {
  return {
    provider: "outbox",
    async send(message) {
      const { to, subject, text } = cleanMessage(message);
      await fs.promises.mkdir(config.dir, { recursive: true, mode: 0o700 });
      // Name sorts in send order and holds no part of the message or address.
      const name = [
        String(Date.now()).padStart(13, "0"),
        String(++outboxSequence).padStart(6, "0"),
        crypto.randomBytes(4).toString("hex")
      ].join("-");
      await fs.promises.writeFile(
        path.join(config.dir, `${name}.json`),
        JSON.stringify({ to, from: config.from, subject, text, sentAt: new Date().toISOString() }, null, 2),
        // Each file holds a live code: owner-only, and never overwrite.
        { mode: 0o600, flag: "wx" }
      );
    }
  };
}

export function createMailer(config: MailConfig, deps: MailerDeps = {}): Mailer {
  if (config.provider === "outbox") {
    const production = deps.production ?? isProductionEnv(process.env);
    if (production) throw new Error("The outbox mail provider cannot be used in production.");
    return outboxMailer(config);
  }
  return resendMailer(config, deps);
}

/* ---------- The mailer the app uses ---------- */

let cached: { mailer: Mailer | null } | undefined;

/** The configured mailer, or null when e-mail isn't set up (answer 503, don't accept the sign-up). */
export function getMailer(): Mailer | null {
  if (!cached) {
    const decision = decideMail(process.env);
    cached = { mailer: decision.config && !decision.fatal ? createMailer(decision.config) : null };
  }
  return cached.mailer;
}

export function isMailConfigured(): boolean {
  return getMailer() !== null;
}

/** For tests that change process.env between cases. */
export function resetMailerForTests(): void {
  cached = undefined;
}

/**
 * Called once when the server starts. Prints the policy's warnings loudly and
 * stops the process on a fatal one (the outbox provider in production).
 */
export function assertMailConfigAtBoot(
  env: Record<string, string | undefined> = process.env,
  onFatal: (message: string) => never = (message) => {
    console.error(`[Mail] ${message}`);
    process.exit(1);
  }
): MailDecision {
  const decision = decideMail(env);
  for (const warning of decision.warnings) console.warn(`[Mail] ${warning}`);
  if (decision.fatal) onFatal(decision.fatal);
  return decision;
}
