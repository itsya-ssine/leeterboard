import React, { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, LogIn, RefreshCw, UserPlus } from "lucide-react";
import { useAuth } from "./AuthContext.js";
import Modal from "./Modal.js";
import { useToast } from "./Toast.js";
import { AFTER_SIGNUP_PROMPT, checkSignup, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./signup.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const inputCls =
  "h-10 w-full rounded-lg bg-ink-950 px-3 text-sm text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50";

const btnPrimary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-400 text-sm font-medium text-ink-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
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
  const { login, register } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
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
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const switchTab = (next: Tab) => {
    setTab(next);
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

  // One step: the account exists and is signed in as soon as the server says
  // so. The new member lands on their account page to link LeetCode,
  // Codeforces or CodinGame; until they do they are on no leaderboard.
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = checkSignup(username, password);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await register(username.trim(), password, displayName.trim() || undefined);
      window.location.hash = "#/account";
      toast("success", `Account created. ${AFTER_SIGNUP_PROMPT}`);
      finish();
    } catch (err: any) {
      setError(err.message || "Couldn't create your account.");
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
          label={tab === "login" ? "Log in" : "Sign up"}
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
          {tab === "login" && (
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

          {/* ---------- Sign up ---------- */}
          {tab === "signup" && (
            <form onSubmit={handleSignup} className="mt-5 flex flex-col gap-4" noValidate>
              <p className="text-sm leading-relaxed text-mist-400">
                Pick a username and a password for this site. You can link your LeetCode, Codeforces and CodinGame
                accounts afterwards from your account settings.
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

              {error && <ErrorBox message={error} />}

              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? <RefreshCw className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                {busy ? "Creating account…" : "Create account"}
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
