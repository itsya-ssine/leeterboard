import React, { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, LogIn, RefreshCw, UserPlus } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import { useAuth } from "./AuthContext.js";
import { AuthError } from "./authApi.js";
import Modal from "./Modal.js";
import { useToast } from "./Toast.js";
import { AFTER_SIGNUP_PROMPT, checkSignupUsername, oauthErrorMessage, visibleOAuthProviders } from "./signup.js";
import type { OAuthProvider, PendingOAuthSignup } from "./authApi.js";

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

function ProviderButton({
  provider,
  onClick
}: {
  provider: OAuthProvider;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={btnSecondary}>
      {provider === "github" ? (
        <FaGithub className="size-4" aria-hidden="true" />
      ) : (
        <FcGoogle className="size-4" aria-hidden="true" />
      )}
      Continue with {provider === "github" ? "GitHub" : "Google"}
    </button>
  );
}

function clearOAuthErrorFromUrl() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/login`);
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
  const { login, oauthProviders, startOAuthSignIn, fetchPendingOAuthSignup, completeOAuthSignup } = useAuth();
  const { toast } = useToast();

  const usernameStep = window.location.hash.split("?")[0] === "#/signup/username";
  const hasOAuthError = new URLSearchParams(window.location.hash.split("?")[1] ?? "").has("oauth_error");
  const [tab, setTab] = useState<Tab>(usernameStep ? "signup" : "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState<PendingOAuthSignup | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read only the fixed error codes returned by the OAuth callback. Never show
  // a query value directly, and remove it so a refresh doesn't repeat the error.
  useEffect(() => {
    if (!open) return;
    const query = window.location.hash.split("?")[1] ?? "";
    const code = new URLSearchParams(query).get("oauth_error");
    if (!code) return;
    setTab("login");
    setError(oauthErrorMessage(code));
    clearOAuthErrorFromUrl();
  }, [open]);

  // Start from a clean form each time the dialog is opened, so a password
  // typed earlier is never still sitting in state.
  useEffect(() => {
    if (!open) return;
    setTab(usernameStep ? "signup" : "login");
    setUsername("");
    setPassword("");
    setDisplayName("");
    setPending(null);
    setBusy(false);
    if (!usernameStep && !hasOAuthError) setError(null);
  }, [open]);

  // The provider callback leaves a short-lived pending sign-up in an HttpOnly
  // cookie. The username page only receives the masked address and suggestion.
  useEffect(() => {
    if (!open || !usernameStep) return;
    let active = true;
    // Starts false and is switched on here, so nothing the URL says is ever
    // copied into the state that decides what is rendered.
    setPendingLoading(true);
    fetchPendingOAuthSignup()
      .then((data) => {
        if (!active) return;
        setPending(data);
        setDisplayName(data.suggestedDisplayName ?? "");
      })
      .catch((err) => {
        if (!active) return;
        window.location.hash = "#/login";
        setTab("signup");
        setError(
          err instanceof AuthError && err.status === 400
            ? "This sign-up has expired. Please start again."
            : "Couldn't load your sign-up. Please try again."
        );
      })
      .finally(() => {
        if (active) setPendingLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, usernameStep, fetchPendingOAuthSignup]);

  // The username screen is shown because the SERVER answered (or is still being
  // asked) about a pending sign-up, never because of what the URL hash says.
  // The hash only starts that request.
  const showUsernameStep = pendingLoading || pending !== null;

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

  const handleCompleteSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = checkSignupUsername(username);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await completeOAuthSignup(username.trim(), displayName.trim() || undefined);
      window.location.hash = "#/account";
      toast("success", `Account created. ${AFTER_SIGNUP_PROMPT}`);
      finish();
    } catch (err: any) {
      setError(err.message || "Couldn't create your account. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const providerButtons = (providers: OAuthProvider[]) =>
    providers.map((provider) => (
      <ProviderButton key={provider} provider={provider} onClick={() => startOAuthSignIn(provider)} />
    ));

  return (
    <AnimatePresence>
      {open && (
        <Modal
          onClose={onClose}
          dismissible={dismissible}
          label={showUsernameStep ? "Choose a username" : tab === "signup" ? "Sign up" : "Log in"}
          maxWidth="max-w-sm"
          id="auth-modal"
        >
          {showUsernameStep ? (
            <>
              <div className="mt-1">
                <h2 className="text-lg font-semibold text-strong">Choose your username</h2>
              </div>

              {pending && (
                <form onSubmit={handleCompleteSignup} className="mt-5 flex flex-col gap-4" noValidate>
                  <div>
                    <label htmlFor="signup-username" className="mb-1.5 block text-sm font-medium text-mist-400">
                      Username
                    </label>
                    <input
                      id="signup-username"
                      type="text"
                      autoFocus
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
                      Display name
                    </label>
                    <input
                      id="signup-display"
                      type="text"
                      autoComplete="nickname"
                      maxLength={40}
                      placeholder="Your display name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className={inputCls}
                      disabled={busy}
                    />
                  </div>

                  {error && <ErrorBox message={error} />}

                  <button type="submit" disabled={busy || pendingLoading} className={btnPrimary}>
                    {busy ? <RefreshCw className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                    {busy ? "Creating account…" : "Create account"}
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
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
                  <div>
                    <label htmlFor="login-username" className="mb-1.5 block text-sm font-medium text-mist-400">
                      Username
                    </label>
                    <input
                      id="login-username"
                      type="text"
                      autoFocus
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

                  {oauthProviders.length > 0 && (
                    <>
                      <div className="relative my-1">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-line" /></div>
                        <div className="relative flex justify-center"><span className="bg-ink-900 px-2 text-xs text-mist-500">or</span></div>
                      </div>
                      {providerButtons(visibleOAuthProviders(oauthProviders))}
                    </>
                  )}

                </form>
              )}

              {/* ---------- Sign up ---------- */}
              {tab === "signup" && (
                <div className="mt-5 flex flex-col gap-4">
                  {error && <ErrorBox message={error} />}
                  {oauthProviders.length > 0 ? (
                    providerButtons(visibleOAuthProviders(oauthProviders))
                  ) : (
                    <p role="status" className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200 ring-1 ring-amber-400/20">
                      Sign-up is temporarily unavailable.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </AnimatePresence>
  );
}
