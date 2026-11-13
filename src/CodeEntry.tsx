import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { checkCode, normalizeCode } from "./signup.js";
import { resendLabel, secondsLeft } from "./signupFlow.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";
const inputCls =
  "h-12 w-full rounded-lg bg-ink-950 px-3 text-center font-mono text-xl tracking-[0.35em] text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50";
const btnPrimary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-400 text-sm font-medium text-ink-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnSecondary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-ink-950 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const linkBtn = `cursor-pointer font-medium text-teal-300 underline-offset-2 hover:underline ${focusRing} rounded`;

// The step where the person types the 6-digit code from the e-mail. Shared by
// sign-up, forgot password and the account's e-mail card; each owns what
// "verify" and "resend" do, this owns the field, the countdown and the wording.
//
// Accessibility: the code field takes focus when the step appears and again
// after a failed try (selected, so retyping replaces it); an error is announced
// with role="alert"; a new-code confirmation is a polite role="status". The
// countdown on the Resend button is deliberately NOT a live region (a number
// announced every second is noise); the button is disabled meanwhile.
export default function CodeEntry({
  message,
  expiresInMinutes,
  sentAt,
  busy,
  error,
  notice,
  submitLabel = "Verify",
  busyLabel = "Verifying…",
  backLabel,
  onSubmit,
  onResend,
  onBack
}: {
  // The line that says where the code went.
  message: string;
  expiresInMinutes: number;
  // When the code on its way was requested (Date.now()), for the resend countdown.
  sentAt: number;
  busy: boolean;
  // A failure from the last try (wrong code, expired, a lost connection...).
  error: string | null;
  // A confirmation, e.g. that a new code was sent.
  notice?: string | null;
  submitLabel?: string;
  busyLabel?: string;
  backLabel: string;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  const left = secondsLeft(sentAt, now);

  // Tick only while there is something to count down.
  useEffect(() => {
    setNow(Date.now());
    if (secondsLeft(sentAt, Date.now()) === 0) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (secondsLeft(sentAt, t) === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [sentAt]);

  // Focus the field when the step appears, and again (selected) after a failure.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (error) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [error]);

  const shownError = localError ?? error;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = checkCode(code);
    setLocalError(problem);
    if (problem) {
      inputRef.current?.focus();
      return;
    }
    onSubmit(normalizeCode(code));
  };

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
      <div>
        <p className="text-sm leading-relaxed text-mist-400">{message}</p>
        <p className="mt-1 text-sm leading-relaxed text-mist-500">
          It can take a minute to arrive. Check your spam folder too. The code works for {expiresInMinutes} minutes.
        </p>
      </div>

      <div>
        <label htmlFor="email-code" className="mb-1.5 block text-sm font-medium text-mist-400">
          6-digit code
        </label>
        <input
          ref={inputRef}
          id="email-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={14}
          placeholder="000000"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/[^\d\s-]/g, ""));
            setLocalError(null);
          }}
          className={inputCls}
          disabled={busy}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? "email-code-error" : undefined}
        />
      </div>

      {shownError && (
        <div
          id="email-code-error"
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300 ring-1 ring-rose-400/20"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{shownError}</span>
        </div>
      )}

      {notice && !shownError && (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-teal-400/10 p-3 text-sm text-teal-200 ring-1 ring-teal-300/20">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{notice}</span>
        </p>
      )}

      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy && <RefreshCw className="size-4 animate-spin" />}
        {busy ? busyLabel : submitLabel}
      </button>

      <button type="button" onClick={onResend} disabled={busy || left > 0} className={btnSecondary}>
        {resendLabel(left)}
      </button>

      <p className="text-center text-sm text-mist-500">
        <button type="button" onClick={onBack} disabled={busy} className={linkBtn}>
          {backLabel}
        </button>
      </p>
    </form>
  );
}
