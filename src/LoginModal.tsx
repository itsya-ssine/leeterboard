import React, { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, KeyRound, LogIn, RefreshCw, UserPlus } from "lucide-react";
import { useAuth } from "./AuthContext.js";
import CodeEntry from "./CodeEntry.js";
import Modal from "./Modal.js";
import { useToast } from "./Toast.js";
import { maskEmail } from "../emails.js";
import {
  AFTER_SIGNUP_PROMPT,
  checkEmailInput,
  checkNewPassword,
  checkSignup,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH
} from "./signup.js";
import { classifyCodeError, codeSentMessage, resetSentMessage } from "./signupFlow.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const inputCls =
  "h-10 w-full rounded-lg bg-ink-950 px-3 text-sm text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50";

const btnPrimary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-400 text-sm font-medium text-ink-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const linkBtn = `cursor-pointer font-medium text-teal-300 underline-offset-2 hover:underline ${focusRing} rounded`;

type Tab = "login" | "signup";
// Sign-up and "forgot password" both have two steps: the details, then the code
// that was e-mailed.
type SignupStep = "details" | "code";
// The code step: the line saying where the code went, and how long it lives.
interface CodeStepInfo {
  message: string;
  expiresInMinutes: number;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300 ring-1 ring-rose-400/20"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export default function LoginModal({
  open,
  onClose,
  onAuthenticated,
  dismissible = true,
  notice
}: {
  open: boolean;
  onClose: () => void;
  onAuthenticated?: () => void;
  dismissible?: boolean;
  // A message shown above the form, e.g. that the session ended.
  notice?: string;
}) {
  const { login, startRegistration, verifyRegistration, startPasswordReset, verifyPasswordReset } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<SignupStep>("details");
  // "Forgot password?" is a view of the log-in tab: e-mail + new password, then
  // the code. It reuses the e-mail and password fields and the code step below.
  const [forgot, setForgot] = useState(false);
  // Step 2: where the code went, when it was requested (for the resend
  // countdown), and a confirmation after a resend.
  const [challenge, setChallenge] = useState<CodeStepInfo | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [notice2, setNotice2] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from a clean form each time the dialog is opened, so a password
  // typed earlier is never still sitting in state.
  useEffect(() => {
    if (open) {
      setTab("login");
      setUsername("");
      setPassword("");
      setDisplayName("");
      setEmail("");
      setForgot(false);
      setStep("details");
      setChallenge(null);
      setNotice2(null);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setForgot(false);
    setStep("details");
    setChallenge(null);
    setNotice2(null);
    setError(null);
  };

  const finish = () => {
    setPassword("");
    onAuthenticated?.();
    onClose();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    try {
      await login(username.trim(), password);
      finish();
    } catch (err: any) {
      setError(err.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  // Step 1 of 2: the server checks the details and e-mails a 6-digit code. No
  // account exists yet. Asking again for an address that is already registered
  // looks exactly the same, so this step says nothing about who has an account.
  const requestCode = async (): Promise<CodeStepInfo | null> => {
    const problem = checkSignup(username, password, email);
    if (problem) {
      setError(problem);
      return null;
    }
    setBusy(true);
    try {
      const sent = await startRegistration(username.trim(), password, email.trim(), displayName.trim() || undefined);
      setSentAt(Date.now());
      return { message: codeSentMessage(sent.maskedEmail), expiresInMinutes: sent.expiresInMinutes };
    } catch (err: any) {
      setError(err.message || "Couldn't send the code.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice2(null);
    const sent = await requestCode();
    if (sent) {
      setChallenge(sent);
      setStep("code");
    }
  };

  const handleResend = async () => {
    setError(null);
    setNotice2(null);
    const sent = await requestCode();
    if (sent) {
      setChallenge(sent);
      setNotice2("A new code was sent. The earlier one no longer works.");
    }
  };

  // Step 2 of 2: the right code creates the account and signs in. The new
  // member lands on their account page to link LeetCode, Codeforces or
  // CodinGame; until they do they are on no leaderboard.
  const handleVerify = async (code: string) => {
    setError(null);
    setNotice2(null);
    setBusy(true);
    try {
      await verifyRegistration(code);
      window.location.hash = "#/account";
      toast("success", `Account created. ${AFTER_SIGNUP_PROMPT}`);
      finish();
    } catch (err) {
      const failure = classifyCodeError(err);
      if (failure.action === "restart") {
        // Expired, locked or the name was taken meanwhile: back to the details
        // (kept, so nothing has to be retyped) with the reason.
        setStep("details");
        setChallenge(null);
      }
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const useDifferentEmail = () => {
    setStep("details");
    setChallenge(null);
    setNotice2(null);
    setError(null);
  };

  // ---------- Forgot password ----------
  // Step 1 of 2: the address and the NEW password. The server answers the same
  // whether or not the address belongs to an account (and sends a code only if
  // it does), so this form says "if" and never what it found. The password is
  // chosen now and held, hashed, by the server until the right code arrives.
  const openForgot = () => {
    setForgot(true);
    setEmail(""); // not a leftover from the sign-up form
    setStep("details");
    setChallenge(null);
    setNotice2(null);
    setError(null);
    setPassword(""); // whatever was typed in the log-in form is not a new password
  };

  const closeForgot = () => {
    setForgot(false);
    setStep("details");
    setChallenge(null);
    setNotice2(null);
    setError(null);
    setPassword("");
  };

  const requestResetCode = async (): Promise<CodeStepInfo | null> => {
    const problem = checkEmailInput(email) ?? checkNewPassword(password);
    if (problem) {
      setError(problem);
      return null;
    }
    setBusy(true);
    try {
      const sent = await startPasswordReset(email.trim(), password);
      setSentAt(Date.now());
      return {
        message: resetSentMessage(maskEmail(email.trim().toLowerCase())),
        expiresInMinutes: sent.expiresInMinutes
      };
    } catch (err: any) {
      setError(err.message || "Couldn't start the password reset.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleForgotDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice2(null);
    const sent = await requestResetCode();
    if (sent) {
      setChallenge(sent);
      setStep("code");
    }
  };

  const handleForgotResend = async () => {
    setError(null);
    setNotice2(null);
    const sent = await requestResetCode();
    if (sent) {
      setChallenge(sent);
      setNotice2("If that address has an account, a new code was sent. The earlier one no longer works.");
    }
  };

  // Step 2 of 2: the right code sets the new password, signs this device in
  // (every other session is signed out by the server) and closes the dialog.
  const handleForgotVerify = async (code: string) => {
    setError(null);
    setNotice2(null);
    setBusy(true);
    try {
      await verifyPasswordReset(code);
      toast("success", "Password changed. You're signed in.");
      finish();
    } catch (err) {
      const failure = classifyCodeError(err);
      if (failure.action === "restart") {
        setStep("details");
        setChallenge(null);
      }
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <Modal
          onClose={onClose}
          dismissible={dismissible}
          label={tab === "signup" ? "Sign up" : forgot ? "Reset password" : "Log in"}
          maxWidth="max-w-sm"
          id="auth-modal"
        >
          {/* ---------- Tabs ---------- */}
          <div
            role="tablist"
            aria-label="Account"
            className="mr-8 inline-flex rounded-lg bg-ink-950 p-1 ring-1 ring-line"
          >
            {(
              [
                { key: "login", label: "Log in" },
                { key: "signup", label: "Sign up" }
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => switchTab(t.key)}
                className={`h-8 cursor-pointer rounded-md px-4 text-sm font-medium transition-colors ${focusRing} ${
                  tab === t.key ? "bg-ink-700 text-strong" : "text-mist-400 hover:text-strong"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {notice && (
            <p role="status" className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200 ring-1 ring-amber-400/20">
              {notice}
            </p>
          )}

          {/* ---------- Log in ---------- */}
          {tab === "login" && !forgot && (
            <form onSubmit={handleLogin} className="mt-5 flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-mist-400">
                Log in with your username and password. If you joined before accounts were separate from LeetCode, your username is your LeetCode username.
              </p>

              <div>
                <label htmlFor="login-username" className="mb-1.5 block text-sm font-medium text-mist-400">
                  Username
                </label>
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={inputCls}
                  disabled={busy}
                  required
                />
              </div>

              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-mist-400">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  disabled={busy}
                  required
                />
              </div>
              <p className="-mt-2 text-right text-sm">
                <button type="button" onClick={openForgot} className={linkBtn}>
                  Forgot password?
                </button>
              </p>

              {error && <ErrorBox message={error} />}

              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? <RefreshCw className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                {busy ? "Logging in…" : "Log in"}
              </button>

              <p className="text-center text-sm text-mist-500">
                New here?{" "}
                <button type="button" onClick={() => switchTab("signup")} className={linkBtn}>
                  Sign up
                </button>
              </p>
            </form>
          )}

          {/* ---------- Forgot password, step 2: the code ---------- */}
          {tab === "login" && forgot && step === "code" && challenge && (
            <CodeEntry
              message={challenge.message}
              expiresInMinutes={challenge.expiresInMinutes}
              sentAt={sentAt}
              busy={busy}
              error={error}
              notice={notice2}
              submitLabel="Verify and set new password"
              busyLabel="Setting password…"
              backLabel="Use a different email"
              onSubmit={handleForgotVerify}
              onResend={handleForgotResend}
              onBack={() => {
                setStep("details");
                setChallenge(null);
                setNotice2(null);
                setError(null);
              }}
            />
          )}

          {/* ---------- Forgot password, step 1: the address and the new password ---------- */}
          {tab === "login" && forgot && step === "details" && (
            <form onSubmit={handleForgotDetails} className="mt-5 flex flex-col gap-4" noValidate>
              <p className="text-sm leading-relaxed text-mist-400">
                Enter the email address on your account and choose a new password. We send a 6-digit code there to
                confirm it is you. If you never added an email address to your account, this can't work for you: ask
                an admin to reset your password.
              </p>

              <div>
                <label htmlFor="forgot-email" className="mb-1.5 block text-sm font-medium text-mist-400">
                  Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={254}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  disabled={busy}
                  required
                />
              </div>

              <div>
                <label htmlFor="forgot-password" className="mb-1.5 block text-sm font-medium text-mist-400">
                  New password <span className="font-normal text-mist-500">({PASSWORD_MIN_LENGTH}+ characters)</span>
                </label>
                <input
                  id="forgot-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_MAX_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  disabled={busy}
                  required
                />
              </div>

              {error && <ErrorBox message={error} />}

              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? <RefreshCw className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {busy ? "Sending code…" : "Send me a code"}
              </button>

              <p className="text-center text-sm text-mist-500">
                Remembered it?{" "}
                <button type="button" onClick={closeForgot} className={linkBtn}>
                  Back to log in
                </button>
              </p>
            </form>
          )}

          {/* ---------- Sign up, step 2: the code ---------- */}
          {tab === "signup" && step === "code" && challenge && (
            <CodeEntry
              message={challenge.message}
              expiresInMinutes={challenge.expiresInMinutes}
              sentAt={sentAt}
              busy={busy}
              error={error}
              notice={notice2}
              submitLabel="Verify and create account"
              busyLabel="Creating account…"
              backLabel="Use a different email"
              onSubmit={handleVerify}
              onResend={handleResend}
              onBack={useDifferentEmail}
            />
          )}

          {/* ---------- Sign up, step 1: the details ---------- */}
          {tab === "signup" && step === "details" && (
            <form onSubmit={handleDetails} className="mt-5 flex flex-col gap-4" noValidate>
              <p className="text-sm leading-relaxed text-mist-400">
                Pick a username and a password for this site, and give an email address. We send a 6-digit code there to
                confirm it, and it is what you use if you forget your password. Your email is never shown to other
                members. You can link your LeetCode, Codeforces and CodinGame accounts afterwards from your account
                settings.
              </p>

              <div>
                <label htmlFor="signup-username" className="mb-1.5 block text-sm font-medium text-mist-400">
                  Username <span className="font-normal text-mist-500">(letters, numbers, underscores)</span>
                </label>
                <input
                  id="signup-username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={30}
                  placeholder="jsmith"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={inputCls}
                  disabled={busy}
                  required
                />
              </div>

              <div>
                <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium text-mist-400">
                  Email
                </label>
                <input
                  id="signup-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={254}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  disabled={busy}
                  required
                />
              </div>

              <div>
                <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium text-mist-400">
                  Password <span className="font-normal text-mist-500">({PASSWORD_MIN_LENGTH}+ characters)</span>
                </label>
                <input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_MAX_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  disabled={busy}
                  required
                />
              </div>

              <div>
                <label htmlFor="signup-display" className="mb-1.5 block text-sm font-medium text-mist-400">
                  Display name <span className="font-normal text-mist-500">(optional)</span>
                </label>
                <input
                  id="signup-display"
                  type="text"
                  autoComplete="nickname"
                  maxLength={40}
                  placeholder="CodeSlayer"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={inputCls}
                  disabled={busy}
                />
              </div>

              {error && <ErrorBox message={error} />}

              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? <RefreshCw className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                {busy ? "Sending code…" : "Send me a code"}
              </button>

              <p className="text-center text-sm text-mist-500">
                Already have an account?{" "}
                <button type="button" onClick={() => switchTab("login")} className={linkBtn}>
                  Log in
                </button>
              </p>
            </form>
          )}
        </Modal>
      )}
    </AnimatePresence>
  );
}
