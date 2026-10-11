import React, { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, Check, Copy, ExternalLink, LogIn, RefreshCw, UserPlus } from "lucide-react";
import { useAuth, type RegistrationChallenge } from "./AuthContext.js";
import Modal from "./Modal.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const inputCls =
  "h-10 w-full rounded-lg bg-ink-950 px-3 text-sm text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50";

const btnPrimary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-400 text-sm font-medium text-ink-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnSecondary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-ink-800 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const linkBtn = `cursor-pointer font-medium text-teal-300 underline-offset-2 hover:underline ${focusRing} rounded`;

type Tab = "login" | "signup";

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

const PURPOSE_COPY: Record<RegistrationChallenge["purpose"], { title: string; done: string }> = {
  create: { title: "Verify your LeetCode account", done: "Create account" },
  claim: { title: "Claim your existing profile", done: "Claim account" },
  reset: { title: "Reset your password", done: "Set new password" }
};

export default function LoginModal({
  open,
  onClose,
  onAuthenticated
}: {
  open: boolean;
  onClose: () => void;
  onAuthenticated?: () => void;
}) {
  const { login, startRegistration, verifyRegistration } = useAuth();

  const [tab, setTab] = useState<Tab>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [challenge, setChallenge] = useState<RegistrationChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Start from a clean form each time the dialog is opened, so a password
  // typed earlier is never still sitting in state.
  useEffect(() => {
    if (open) {
      setTab("login");
      setUsername("");
      setPassword("");
      setDisplayName("");
      setChallenge(null);
      setBusy(false);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setChallenge(null);
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
      setError("Enter your LeetCode username and password.");
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

  const handleStartSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) {
      setError("LeetCode username is required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      setChallenge(await startRegistration(username.trim(), password, displayName.trim() || undefined));
    } catch (err: any) {
      setError(err.message || "Couldn't start sign-up.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyRegistration();
      finish();
    } catch (err: any) {
      if (err.expired) setChallenge(null); // back to the form: it has to be started again
      setError(err.message || "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!challenge) return;
    try {
      await navigator.clipboard.writeText(challenge.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the code is selectable on screen.
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <Modal onClose={onClose} label={tab === "login" ? "Log in" : "Sign up"} maxWidth="max-w-sm" id="auth-modal">
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

          {/* ---------- Log in ---------- */}
          {tab === "login" && (
            <form onSubmit={handleLogin} className="mt-5 flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-mist-400">
                Log in with your LeetCode username and the password you chose for this site.
              </p>

              <div>
                <label htmlFor="login-username" className="mb-1.5 block text-sm font-medium text-mist-400">
                  LeetCode username
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

              {error && <ErrorBox message={error} />}

              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? <RefreshCw className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                {busy ? "Logging in…" : "Log in"}
              </button>

              <p className="text-center text-sm text-mist-500">
                New here, or forgot your password?{" "}
                <button type="button" onClick={() => switchTab("signup")} className={linkBtn}>
                  Sign up / reset
                </button>
              </p>
            </form>
          )}

          {/* ---------- Sign up: step 1 (details) ---------- */}
          {tab === "signup" && !challenge && (
            <form onSubmit={handleStartSignup} className="mt-5 flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-mist-400">
                Pick a password for this site. It is <strong className="font-semibold text-mist-100">not</strong> your
                LeetCode password, and we never ask for that. Next you'll prove the LeetCode account is yours.
                The same steps also reset a forgotten password.
              </p>

              <div>
                <label htmlFor="signup-username" className="mb-1.5 block text-sm font-medium text-mist-400">
                  LeetCode username
                </label>
                <input
                  id="signup-username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="jsmith"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
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

              <div>
                <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium text-mist-400">
                  Password <span className="font-normal text-mist-500">(8+ characters)</span>
                </label>
                <input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  disabled={busy}
                  required
                />
              </div>

              {error && <ErrorBox message={error} />}

              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? <RefreshCw className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                {busy ? "Checking LeetCode…" : "Continue"}
              </button>

              <p className="text-center text-sm text-mist-500">
                Already have a password?{" "}
                <button type="button" onClick={() => switchTab("login")} className={linkBtn}>
                  Log in
                </button>
              </p>
            </form>
          )}

          {/* ---------- Sign up: step 2 (prove ownership) ---------- */}
          {tab === "signup" && challenge && (
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-strong">
                  {PURPOSE_COPY[challenge.purpose].title}
                </h3>
                <p className="mt-1 text-sm text-mist-400">
                  Proving that <span className="font-medium text-strong">@{challenge.leetcodeUsername}</span> is
                  yours.
                  {challenge.purpose === "claim" && " This board entry already exists, so your stats and history are kept."}
                  {challenge.purpose === "reset" && " Your stats stay as they are; only the password changes."}
                </p>
              </div>

              <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-mist-400">
                <li>Copy this code:</li>
              </ol>

              <div className="flex items-center gap-2 rounded-lg bg-ink-950 p-2 pl-3 ring-1 ring-line">
                <code className="min-w-0 flex-1 select-all truncate font-mono text-sm text-teal-300">
                  {challenge.code}
                </code>
                <button
                  type="button"
                  onClick={copyCode}
                  className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-ink-800 px-2.5 text-xs font-medium text-mist-100 ring-1 ring-line hover:bg-ink-700 ${focusRing}`}
                >
                  {copied ? <Check className="size-3.5 text-teal-300" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <ol start={2} className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-mist-400">
                <li>
                  On LeetCode, open{" "}
                  <a
                    href="https://leetcode.com/profile/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 font-medium text-teal-300 hover:underline ${focusRing} rounded`}
                  >
                    Edit Profile <ExternalLink className="size-3" />
                  </a>
                  , paste the code into the <strong className="font-semibold text-mist-100">Summary</strong> field and
                  save.
                </li>
                <li>Come back here and press Verify. You can delete the code from your summary afterwards.</li>
              </ol>

              <p className="text-xs text-mist-500">
                The code expires in {challenge.expiresInMinutes} minutes.
              </p>

              {error && <ErrorBox message={error} />}

              <button type="button" onClick={handleVerify} disabled={busy} className={btnPrimary}>
                {busy ? <RefreshCw className="size-4 animate-spin" /> : <Check className="size-4" />}
                {busy ? "Checking your profile…" : `Verify · ${PURPOSE_COPY[challenge.purpose].done}`}
              </button>

              <button
                type="button"
                onClick={() => {
                  setChallenge(null);
                  setError(null);
                }}
                disabled={busy}
                className={btnSecondary}
              >
                Back
              </button>
            </div>
          )}
        </Modal>
      )}
    </AnimatePresence>
  );
}
