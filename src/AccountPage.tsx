import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Link2,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserRound
} from "lucide-react";
import { useAuth, type PlatformLinkChallenge } from "./AuthContext.js";
import { maskEmail } from "../emails.js";
import { canDisconnectOAuthProvider, oauthErrorMessage, visibleOAuthProviders } from "./signup.js";
import { downloadMyData, type OAuthProvider } from "./authApi.js";
import { hasNothingLinked, rowAccountFor, type LinkId, type RowAccount } from "./linkedAccounts.js";
import { formatRankTitle, rankTextClass } from "./CodeforcesPage.js";
import PageHeader from "./PageHeader.js";
import TierAvatar from "./TierAvatar.js";
import EmptyState from "./EmptyState.js";
import { AccountSkeleton } from "./Skeleton.js";
import { useToast } from "./Toast.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const inputCls =
  "h-10 w-full rounded-lg bg-ink-950 px-3 text-sm text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50";

const btnBase = `inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnPrimary = `${btnBase} w-full bg-gradient-to-r from-teal-400 to-sky-400 text-ink-950 shadow-[0_0_0_1px_rgb(255_255_255/0.12)_inset,0_6px_20px_-6px_rgb(45_212_191/0.6)] hover:brightness-110 active:scale-[0.97]`;
const btnSecondary = `${btnBase} w-full bg-ink-800/80 text-mist-100 ring-1 ring-line hover:bg-ink-700 hover:ring-line-strong active:scale-[0.97]`;
const btnDanger = `${btnBase} w-full bg-rose-500 text-white shadow-[0_6px_20px_-8px_rgb(244_63_94/0.6)] hover:bg-rose-400 active:scale-[0.97]`;
// Header actions: a square icon button on phones, icon plus label from sm.
const btnLinkResponsive = `inline-flex size-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-ink-800/80 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 hover:ring-line-strong active:scale-[0.97] sm:w-auto sm:px-4 ${focusRing}`;

// Compact button for the rows in the Linked accounts card.
const btnSmall = `inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-ink-800/80 px-3 text-xs font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 hover:ring-line-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

const labelCls = "mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-widest text-mist-500";

type Notice = { kind: "error" | "success"; message: string } | null;

// Notice state for a form. Errors stay inline next to the form that caused
// them; successes pop up as a toast instead of taking up room in the card.
function useNoticeState() {
  const { toast } = useToast();
  const [notice, setNotice] = useState<Notice>(null);
  const set = useCallback(
    (next: Notice) => {
      if (next?.kind === "success") toast("success", next.message);
      setNotice(next);
    },
    [toast]
  );
  return [notice, set] as const;
}

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice || notice.kind === "success") return null;
  const isError = notice.kind === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg p-3 text-sm ring-1 ${
        isError
          ? "bg-rose-500/10 text-rose-300 ring-rose-400/20"
          : "bg-teal-400/10 text-teal-300 ring-teal-400/20"
      }`}
    >
      {isError ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Check className="mt-0.5 size-4 shrink-0" />}
      <span>{notice.message}</span>
    </div>
  );
}

function Card({
  icon,
  title,
  description,
  id,
  children
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className="card-aurora min-w-0 animate-rise overflow-hidden p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-tint ring-1 ring-line" aria-hidden="true">
          {icon}
        </span>
        <h2 className="min-w-0 font-mono text-[11px] font-semibold uppercase tracking-widest text-strong">
          <span aria-hidden="true" className="text-aurora-a">{"// "}</span>
          {title}
        </h2>
      </div>
      {description && <p className="mt-3 text-sm text-mist-400">{description}</p>}
      <div className="mt-4">{children}</div>
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-teal-300/70 to-transparent" />
    </section>
  );
}


/* ---------- Linked accounts ---------- */

// What the UI needs to know about each extra platform. `available: false`
// shows the row but keeps Add disabled (the server rejects linking until the
// platform has a provider); flip it when the provider lands.
const PLATFORM_UI: Record<
  LinkId,
  {
    label: string;
    available: boolean;
    placeholder: string;
    profileUrl: (handle: string) => string;
    // Where the member pastes the proof code.
    settingsUrl: (handle: string) => string;
    settingsLabel: string;
  }
> = {
  leetcode: {
    label: "LeetCode",
    available: true,
    placeholder: "your LeetCode username",
    profileUrl: (h) => `https://leetcode.com/u/${encodeURIComponent(h)}/`,
    settingsUrl: () => "https://leetcode.com/profile/",
    settingsLabel: "your LeetCode profile"
  },
  codeforces: {
    label: "Codeforces",
    available: true,
    placeholder: "your Codeforces handle",
    profileUrl: (h) => `https://codeforces.com/profile/${encodeURIComponent(h)}`,
    settingsUrl: () => "https://codeforces.com/settings/social",
    settingsLabel: "Settings > Social"
  },
  codingame: {
    label: "CodinGame",
    available: true,
    placeholder: "id from codingame.com/profile/<id>",
    profileUrl: (h) => `https://www.codingame.com/profile/${encodeURIComponent(h)}`,
    settingsUrl: (h) => `https://www.codingame.com/profile/${encodeURIComponent(h)}`,
    settingsLabel: "your profile"
  }
};

const PLATFORM_ORDER: LinkId[] = ["leetcode", "codeforces", "codingame"];

// "Hide on my profile" switch, shared by every platform row.
// Hidden stats still count on the leaderboards and in the global stats.
function HideSwitch({
  id,
  hidden,
  busy,
  label,
  onToggle
}: {
  id: string;
  hidden: boolean;
  busy: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm text-mist-100">
          {hidden ? (
            <EyeOff className="size-3.5 shrink-0 text-mist-500" aria-hidden="true" />
          ) : (
            <Eye className="size-3.5 shrink-0 text-mist-500" aria-hidden="true" />
          )}
          Hide on my profile
        </p>
        <p className="mt-0.5 text-xs text-mist-500">
          {hidden
            ? "Other members can't see these stats on your profile. They still count on the leaderboard and in the global stats."
            : "Everyone can see these stats on your profile."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={hidden}
        aria-label={label}
        onClick={onToggle}
        disabled={busy}
        id={id}
        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${
          hidden ? "bg-gradient-to-r from-teal-400 to-sky-400" : "bg-ink-700 ring-1 ring-line"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
            hidden ? "translate-x-5" : "translate-x-0"
          }`}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function PlatformRow({
  platform,
  account,
  onChanged
}: {
  platform: LinkId;
  account: RowAccount | undefined;
  onChanged?: () => void;
}) {
  const {
    startPlatformLink,
    verifyPlatformLink,
    unlinkPlatform,
    setPlatformHidden,
    startLeetcodeLink,
    verifyLeetcodeLink,
    unlinkLeetcode,
    setHideLeetcodeStats
  } = useAuth();
  const ui = PLATFORM_UI[platform];

  const [step, setStep] = useState<"idle" | "handle" | "verify">("idle");
  const [handle, setHandle] = useState("");
  const [challenge, setChallenge] = useState<PlatformLinkChallenge | null>(null);
  const [challengeExpiresAt, setChallengeExpiresAt] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useNoticeState();
  const [copied, setCopied] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const reset = useCallback(() => {
    setStep("idle");
    setHandle("");
    setChallenge(null);
    setChallengeExpiresAt(0);
    setNotice(null);
    setCopied(false);
  }, [setNotice]);

  // Live countdown for challenge expiration (UX-03)
  useEffect(() => {
    if (step !== "verify" || !challengeExpiresAt) return;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((challengeExpiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setNotice({ kind: "error", message: "Verification code expired. Please generate a new code." });
      }
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [step, challengeExpiresAt, setNotice]);

  // Background auto-check every 6 seconds while in Step 2 (UX-03)
  useEffect(() => {
    if (step !== "verify" || !challenge || busy || secondsLeft <= 0) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20;

    const autoTimer = setInterval(async () => {
      if (cancelled || attempts >= maxAttempts) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      attempts++;
      try {
        const updated = platform === "leetcode" ? await verifyLeetcodeLink() : await verifyPlatformLink(platform);
        if (cancelled) return;
        const synced = platform === "leetcode" ? updated.lastUpdated : updated.platforms?.[platform]?.lastUpdated;
        reset();
        setNotice({
          kind: "success",
          message: synced
            ? `${ui.label} linked successfully!`
            : `${ui.label} linked. Your stats will show up after the next sync.`
        });
        onChanged?.();
      } catch {
        // Silent during auto-check: profile might still be saving on LeetCode
      }
    }, 6000);

    return () => {
      cancelled = true;
      clearInterval(autoTimer);
    };
  }, [step, challenge, busy, secondsLeft, platform, ui.label, verifyLeetcodeLink, verifyPlatformLink, reset, setNotice, onChanged]);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const trimmed = handle.trim();
    if (!trimmed) {
      setNotice({ kind: "error", message: `Enter your ${ui.label} handle.` });
      return;
    }
    setBusy(true);
    try {
      const nextChallenge =
        platform === "leetcode" ? await startLeetcodeLink(trimmed) : await startPlatformLink(platform, trimmed);
      setChallenge(nextChallenge);
      setChallengeExpiresAt(Date.now() + (nextChallenge.expiresInMinutes || 30) * 60_000);
      setStep("verify");
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message || `Couldn't start linking ${ui.label}.` });
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerateCode = async () => {
    if (!challenge) return;
    setNotice(null);
    setBusy(true);
    try {
      const nextChallenge =
        platform === "leetcode"
          ? await startLeetcodeLink(challenge.handle)
          : await startPlatformLink(platform, challenge.handle);
      setChallenge(nextChallenge);
      setChallengeExpiresAt(Date.now() + (nextChallenge.expiresInMinutes || 30) * 60_000);
      setNotice({ kind: "success", message: "New verification code generated." });
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message || "Couldn't generate a new code." });
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setNotice(null);
    setBusy(true);
    try {
      const updated = platform === "leetcode" ? await verifyLeetcodeLink() : await verifyPlatformLink(platform);
      const synced = platform === "leetcode" ? updated.lastUpdated : updated.platforms?.[platform]?.lastUpdated;
      reset();
      setNotice({
        kind: "success",
        message: synced
          ? `${ui.label} linked.`
          : `${ui.label} linked. Your stats will show up after the next sync.`
      });
      onChanged?.();
    } catch (err: any) {
      if (err.expired) {
        // The request is gone on the server: back to the handle form.
        setChallenge(null);
        setStep("handle");
        setNotice({ kind: "error", message: "The verification code expired. Enter your handle to try again." });
      } else {
        const raw = err.message || "";
        const isNotFound = /not found|could not find|missing|code/i.test(raw);
        setNotice({
          kind: "error",
          message:
            isNotFound && platform === "leetcode"
              ? "We found your LeetCode profile, but couldn't find the code in your Summary yet. LeetCode can take 15–30 seconds to reflect updates — please make sure you clicked Save and try again."
              : raw || `Couldn't verify your ${ui.label} account.`
        });
      }
    } finally {
      setBusy(false);
    }
  };

  // Hide / show this platform on the member's profile. It still counts on the
  // leaderboard and in the global stats.
  const handleHidden = async () => {
    if (!account) return;
    setNotice(null);
    setBusy(true);
    try {
      if (platform === "leetcode") await setHideLeetcodeStats(!account.hidden);
      else await setPlatformHidden(platform, !account.hidden);
      onChanged?.();
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message || "Couldn't change who can see this." });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setNotice(null);
    setBusy(true);
    try {
      if (platform === "leetcode") await unlinkLeetcode();
      else await unlinkPlatform(platform);
      setConfirmingRemove(false);
      setNotice({ kind: "success", message: `${ui.label} removed.` });
      onChanged?.();
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message || `Couldn't remove ${ui.label}.` });
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
      // Clipboard blocked: the code is selectable on screen.
    }
  };

  return (
    <div id={`account-platform-${platform}`} className="min-w-0 rounded-xl bg-ink-950/80 p-3 ring-1 ring-line">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-strong">{ui.label}</p>
          {account ? (
            <p className="truncate text-xs text-mist-500">
              <a
                href={ui.profileUrl(account.handle)}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 rounded font-medium text-teal-300 hover:underline ${focusRing}`}
              >
                @{account.handle}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
              {account.lastUpdated ? (
                <>
                  {" "}
                  {platform === "codingame" ? (
                    <>
                      · {account.solved.toLocaleString()} XP
                      {account.rating != null && <> · Level {account.rating}</>}
                    </>
                  ) : platform === "leetcode" ? (
                    <>
                      · {account.solved.toLocaleString()} solved
                      {account.rating != null && <> · {account.rating} contest rating</>}
                    </>
                  ) : (
                    <>
                      · {account.solved} solved
                      {account.rating != null && (
                        <>
                          {" "}
                          · <span className={rankTextClass(account.rankTitle)}>{account.rating}</span>{" "}
                          <span className={rankTextClass(account.rankTitle)}>
                            {formatRankTitle(account.rankTitle)}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </>
              ) : (
                " · not synced yet"
              )}
            </p>
          ) : (
            <p className="text-xs text-mist-500">{ui.available ? "Not linked" : "Coming soon"}</p>
          )}
        </div>

        {account && !confirmingRemove && (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setConfirmingRemove(true);
            }}
            disabled={busy}
            className={btnSmall}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Remove
          </button>
        )}
        {!account && step === "idle" && (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setStep("handle");
            }}
            disabled={!ui.available}
            className={btnSmall}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add
          </button>
        )}
      </div>

      {/* Visibility */}
      {account && !confirmingRemove && (
        <HideSwitch
          id={`account-platform-${platform}-hidden`}
          hidden={account.hidden}
          busy={busy}
          label={`Hide ${ui.label} stats on my profile`}
          onToggle={handleHidden}
        />
      )}

      {/* Remove confirmation */}
      {account && confirmingRemove && (
        <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
          <p className="text-sm leading-relaxed text-rose-300">
            Remove <span className="font-semibold">@{account.handle}</span>? Its stats and history are deleted from
            the board. You can link it again later.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              disabled={busy}
              className={btnSecondary}
            >
              Cancel
            </button>
            <button type="button" onClick={handleRemove} disabled={busy} className={btnDanger}>
              {busy ? <RefreshCw className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {busy ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      )}

      {/* 3-Step Wizard Indicator (UX-03) */}
      {!account && step !== "idle" && (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 font-mono text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className={`grid size-5 place-items-center rounded-full text-[10px] font-bold ${
                step === "handle"
                  ? "bg-teal-400 text-ink-950"
                  : "bg-teal-400/20 text-teal-300 ring-1 ring-teal-400/30"
              }`}
            >
              1
            </span>
            <span className={step === "handle" ? "font-semibold text-strong" : "text-mist-400"}>Handle</span>
          </div>
          <span className="mx-2 h-px flex-1 bg-line" aria-hidden="true" />
          <div className="flex items-center gap-1.5">
            <span
              className={`grid size-5 place-items-center rounded-full text-[10px] font-bold ${
                step === "verify"
                  ? "bg-teal-400 text-ink-950"
                  : "bg-ink-800 text-mist-500 ring-1 ring-line"
              }`}
            >
              2
            </span>
            <span className={step === "verify" ? "font-semibold text-strong" : "text-mist-500"}>Proof code</span>
          </div>
          <span className="mx-2 h-px flex-1 bg-line" aria-hidden="true" />
          <div className="flex items-center gap-1.5">
            <span className="grid size-5 place-items-center rounded-full bg-ink-800 text-[10px] font-bold text-mist-500 ring-1 ring-line">
              3
            </span>
            <span className="text-mist-500">Connected</span>
          </div>
        </div>
      )}

      {/* Step 1: handle */}
      {!account && step === "handle" && (
        <form onSubmit={handleStart} className="mt-3 flex flex-col gap-3">
          <div>
            <label htmlFor={`acct-${platform}-handle`} className={labelCls}>
              {ui.label} handle
            </label>
            <input
              id={`acct-${platform}-handle`}
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={64}
              placeholder={ui.placeholder}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className={inputCls}
              disabled={busy}
            />
            <p className="mt-1.5 text-xs text-mist-500">
              Next you'll prove the account is yours by saving a short one-time code on its profile.
            </p>
          </div>
          <NoticeBox notice={notice} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={reset} disabled={busy} className={btnSecondary}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy && <RefreshCw className="size-4 animate-spin" />}
              {busy ? "Checking…" : "Continue"}
            </button>
          </div>
        </form>
      )}

      {/* Step 2: prove ownership */}
      {!account && step === "verify" && challenge && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-mist-400">
            Proving that <span className="font-medium text-strong">@{challenge.handle}</span> is yours.
          </p>

          <ol className="list-decimal space-y-2 break-words pl-5 text-sm leading-relaxed text-mist-400">
            <li>Copy this one-time proof code:</li>
          </ol>
          <div className="flex items-center gap-2 rounded-lg bg-ink-900 p-2 pl-3 font-mono ring-1 ring-line">
            <code className="min-w-0 flex-1 select-all truncate font-mono text-xs text-teal-300 sm:text-sm">
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

          <ol start={2} className="list-decimal space-y-2 break-words pl-5 text-sm leading-relaxed text-mist-400">
            <li>
              {challenge.instructions ? (
                <>{challenge.instructions} </>
              ) : (
                <>Paste the code into a profile field of that account and save it. </>
              )}
              <a
                href={ui.settingsUrl(challenge.handle)}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 rounded font-medium text-teal-300 hover:underline ${focusRing}`}
              >
                Open {ui.settingsLabel} <ExternalLink className="size-3" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          </ol>

          {/* Platform verification tip (UX-03) */}
          <div className="rounded-lg bg-ink-950/60 p-3 text-xs leading-relaxed text-mist-400 ring-1 ring-line">
            <div className="flex items-center gap-1.5 font-medium text-strong">
              <Sparkles className="size-3.5 text-teal-300" aria-hidden="true" />
              <span>How to verify on {ui.label}:</span>
            </div>
            <p className="mt-1 text-mist-400">
              {platform === "leetcode"
                ? "Paste the code into the Summary box on your LeetCode profile settings and click the green Save button. LeetCode can take 15–30 seconds to reflect public updates."
                : "Paste the code into your profile social settings and click Save."}
            </p>
            <p className="mt-2 text-[11px] text-mist-500">
              Note: Verification is tied to your active browser session. Please remain in this browser until completed.
            </p>
          </div>

          {/* Countdown & new code action (UX-03) */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-mist-400">
              <Clock className="size-3.5 text-amber-300" aria-hidden="true" />
              <span>
                Code expires in:{" "}
                <strong className="font-mono tabular-nums text-strong">
                  {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, "0")}
                </strong>
              </span>
            </div>
            <button
              type="button"
              onClick={handleRegenerateCode}
              disabled={busy}
              className={`cursor-pointer font-medium text-teal-300 underline underline-offset-2 hover:text-teal-200 disabled:opacity-50 ${focusRing}`}
            >
              Generate new code
            </button>
          </div>

          <p className="text-xs text-mist-500">
            Auto-checking your profile every few seconds while this screen is open, or verify immediately below.
          </p>

          <NoticeBox notice={notice} />

          <button type="button" onClick={handleVerify} disabled={busy} className={btnPrimary}>
            {busy ? <RefreshCw className="size-4 animate-spin" /> : <Check className="size-4" />}
            {busy ? "Checking your profile…" : "Verify & link"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("handle");
              setChallenge(null);
              setNotice(null);
            }}
            disabled={busy}
            className={btnSecondary}
          >
            Back
          </button>
        </div>
      )}

      {/* Result of the last action when no form is open */}
      {step === "idle" && notice && (
        <div className="mt-3">
          <NoticeBox notice={notice} />
        </div>
      )}
    </div>
  );
}

function LinkedAccountsCard({ onChanged }: { onChanged?: () => void }) {
  const { user } = useAuth();
  if (!user) return null;

  const nothingLinked = hasNothingLinked(user);

  return (
    <Card
      icon={<Link2 className="size-4 text-teal-300" />}
      title="Linked accounts"
      description="Link LeetCode, Codeforces and CodinGame to appear on their boards. All optional: you prove each account is yours with a short code."
      id="account-platforms-card"
    >
      <div className="flex flex-col gap-3">
        {nothingLinked && (
          <p
            id="account-nothing-linked"
            className="rounded-lg bg-ink-950/80 p-3 text-sm text-mist-400 ring-1 ring-line"
          >
            You don't appear on any leaderboard yet. Link an account below to join one.
          </p>
        )}
        {PLATFORM_ORDER.map((platform) => (
          <PlatformRow
            key={platform}
            platform={platform}
            account={rowAccountFor(user, platform)}
            onChanged={onChanged}
          />
        ))}
      </div>
    </Card>
  );
}

/* ---------- Sign-in methods ---------- */

function providerLabel(provider: OAuthProvider): string {
  return provider === "github" ? "GitHub" : "Google";
}

function SignInMethodsCard() {
  const { user, oauthProviders, signInMethods, startOAuthLink, unlinkOAuth } = useAuth();
  const [connectingProvider, setConnectingProvider] = useState<OAuthProvider | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [busyProvider, setBusyProvider] = useState<OAuthProvider | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [returnNotice, setReturnNotice] = useState<string | null>(null);

  useEffect(() => {
    const query = window.location.hash.split("?")[1] ?? "";
    const params = new URLSearchParams(query);
    const connected = params.get("connected");
    const error = params.get("oauth_error");
    if (connected === "github" || connected === "google") {
      setReturnNotice(`${providerLabel(connected)} connected successfully.`);
    } else if (error) {
      const message = oauthErrorMessage(error);
      if (message) setNotice({ kind: "error", message });
    }
    if (connected || error) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/account`);
    }
  }, []);

  if (!user) return null;

  const providers = visibleOAuthProviders(oauthProviders, signInMethods.providers);

  const connect = async (provider: OAuthProvider) => {
    setNotice(null);
    setBusyProvider(provider);
    try {
      const url = await startOAuthLink(provider, signInMethods.password ? currentPassword : undefined);
      window.location.assign(url);
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message || `Couldn't connect ${providerLabel(provider)}.` });
      setBusyProvider(null);
    }
  };

  const disconnect = async (provider: OAuthProvider) => {
    setNotice(null);
    setBusyProvider(provider);
    try {
      await unlinkOAuth(provider);
      setNotice({ kind: "success", message: `${providerLabel(provider)} disconnected.` });
      setConnectingProvider(null);
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message || `Couldn't disconnect ${providerLabel(provider)}.` });
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <Card
      icon={<Lock className="size-4 text-teal-300" />}
      title="Sign-in methods"
      description="Manage the ways you can securely sign in to your account."
      id="account-signin-methods-card"
    >
      <div className="flex flex-col gap-3">
        {user.email ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-ink-950/80 p-3 text-sm text-mist-100 ring-1 ring-line">
            <span className="min-w-0 break-all font-mono">{maskEmail(user.email)}</span>
            {user.emailVerified && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-300">
                <Check className="size-3.5" aria-hidden="true" />
                Verified
              </span>
            )}
          </div>
        ) : (
          <p className="rounded-lg bg-ink-950/80 p-3 text-sm text-mist-400 ring-1 ring-line">
            No email yet. Connect GitHub or Google to add a verified one.
          </p>
        )}

        {returnNotice && (
          <p role="status" className="rounded-lg bg-teal-400/10 p-3 text-sm text-teal-300 ring-1 ring-teal-400/20">
            {returnNotice}
          </p>
        )}
        {notice && (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            className={`rounded-lg p-3 text-sm ring-1 ${notice.kind === "error" ? "bg-rose-500/10 text-rose-300 ring-rose-400/20" : "bg-teal-400/10 text-teal-300 ring-teal-400/20"}`}
          >
            {notice.message}
          </div>
        )}

        {user.isAdmin ? (
          <p className="text-sm text-mist-500">Admin accounts must sign in with a password.</p>
        ) : providers.length === 0 ? (
          <p className="text-sm text-mist-500">No sign-in providers are currently available.</p>
        ) : (
          providers.map((provider) => {
            const connected = signInMethods.providers.includes(provider);
            const lastMethod = connected && !canDisconnectOAuthProvider(signInMethods, provider);
            return (
              <div key={provider} className="rounded-lg bg-ink-950/60 p-3 ring-1 ring-line">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-mist-100">
                    <Link2 className="size-4 text-mist-400" aria-hidden="true" />
                    {providerLabel(provider)}
                    {connected && <span className="text-xs font-medium text-teal-300">Connected</span>}
                  </div>
                  {connected ? (
                    <button
                      type="button"
                      className={btnSmall}
                      disabled={busyProvider !== null || lastMethod}
                      onClick={() => void disconnect(provider)}
                      title={lastMethod ? "Connect another sign-in method before disconnecting this one." : undefined}
                    >
                      {busyProvider === provider ? "Disconnecting…" : "Disconnect"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={btnSmall}
                      disabled={!oauthProviders.includes(provider) || busyProvider !== null}
                      onClick={() => {
                        setNotice(null);
                        setCurrentPassword("");
                        setConnectingProvider(provider);
                        if (!signInMethods.password) void connect(provider);
                      }}
                    >
                      Connect
                    </button>
                  )}
                </div>
                {lastMethod && (
                  <p className="mt-2 text-xs text-mist-500">This is your last way to sign in. Connect another method before disconnecting it.</p>
                )}
                {connectingProvider === provider && !connected && signInMethods.password && (
                  <form
                    className="mt-3 flex flex-col gap-2 border-t border-line pt-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void connect(provider);
                    }}
                  >
                    <label htmlFor={`oauth-link-password-${provider}`} className={labelCls}>Current password</label>
                    <input
                      id={`oauth-link-password-${provider}`}
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      className={inputCls}
                      disabled={busyProvider !== null}
                      required
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className={btnSecondary} onClick={() => setConnectingProvider(null)} disabled={busyProvider !== null}>Cancel</button>
                      <button type="submit" className={btnPrimary} disabled={busyProvider !== null || !currentPassword}>
                        {busyProvider === provider ? "Connecting…" : `Continue with ${providerLabel(provider)}`}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

const goHome = () => {
  window.location.hash = "#/";
};

export default function AccountPage({
  // Called after something the leaderboard shows has changed (a rename, school,
  // bio or links, or a deleted account), so it can reload its data.
  onChanged
}: {
  onChanged?: () => void;
}) {
  const {
    status,
    user,
    updateDisplayName,
    updateSchool,
    updateProfileDetails,
    changePassword,
    deleteAccount,
    signInMethods,
    logout,
    logoutAll
  } = useAuth();

  const [name, setName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameNotice, setNameNotice] = useNoticeState();

  const [school, setSchool] = useState("");
  const [schoolBusy, setSchoolBusy] = useState(false);
  const [schoolNotice, setSchoolNotice] = useNoticeState();

  const [bio, setBio] = useState("");
  const [github, setGithub] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");
  const [aboutBusy, setAboutBusy] = useState(false);
  const [aboutNotice, setAboutNotice] = useNoticeState();

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNotice, setPwNotice] = useNoticeState();

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useNoticeState();
  const [deleteNotice, setDeleteNotice] = useNoticeState();

  // Fill the forms once, when the signed-in member is first known — not every
  // time the user object changes, which would overwrite what they are typing.
  const userId = user?.id;
  useEffect(() => {
    if (!user) return;
    setName(user.displayName);
    setSchool(user.school ?? "");
    setBio(user.bio ?? "");
    setGithub(user.githubUrl ?? "");
    setLinkedin(user.linkedinUrl ?? "");
    setWebsite(user.websiteUrl ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (status === "loading") {
    return <AccountSkeleton />;
  }

  if (!user) {
    return (
      <EmptyState
        id="account-signed-out"
        className="mx-auto max-w-xl"
        icon={<Lock className="size-5" aria-hidden="true" />}
        title="You're not signed in"
        description="Log in to change your name, school, links or password."
        action={{ label: "Back to the leaderboard", href: "#/", icon: <ArrowLeft className="size-4" aria-hidden="true" /> }}
      />
    );
  }

  const profileHref = `#/u/${encodeURIComponent(user.loginUsername)}`;

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameNotice(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setNameNotice({ kind: "error", message: "Display name can't be empty." });
      return;
    }
    if (trimmed === user.displayName) {
      setNameNotice({ kind: "error", message: "That is already your display name." });
      return;
    }
    setNameBusy(true);
    try {
      const updated = await updateDisplayName(trimmed);
      setName(updated.displayName);
      setNameNotice({ kind: "success", message: "Display name updated." });
      onChanged?.();
    } catch (err: any) {
      setNameNotice({ kind: "error", message: err.message || "Couldn't update your display name." });
    } finally {
      setNameBusy(false);
    }
  };

  const handleSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setSchoolNotice(null);
    const trimmed = school.trim();
    if (trimmed === (user.school ?? "")) {
      setSchoolNotice({ kind: "error", message: "That is already your school." });
      return;
    }
    setSchoolBusy(true);
    try {
      const updated = await updateSchool(trimmed);
      setSchool(updated.school);
      setSchoolNotice({
        kind: "success",
        message: updated.school ? "School updated." : "School removed."
      });
      onChanged?.();
    } catch (err: any) {
      setSchoolNotice({ kind: "error", message: err.message || "Couldn't update your school." });
    } finally {
      setSchoolBusy(false);
    }
  };

  const handleAbout = async (e: React.FormEvent) => {
    e.preventDefault();
    setAboutNotice(null);
    const next = {
      bio: bio.trim(),
      github: github.trim(),
      linkedin: linkedin.trim(),
      website: website.trim()
    };
    if (
      next.bio === (user.bio ?? "") &&
      next.github === (user.githubUrl ?? "") &&
      next.linkedin === (user.linkedinUrl ?? "") &&
      next.website === (user.websiteUrl ?? "")
    ) {
      setAboutNotice({ kind: "error", message: "Nothing has changed." });
      return;
    }
    setAboutBusy(true);
    try {
      const updated = await updateProfileDetails(next);
      // Show what the server actually stored (links are tidied up).
      setBio(updated.bio);
      setGithub(updated.githubUrl);
      setLinkedin(updated.linkedinUrl);
      setWebsite(updated.websiteUrl);
      setAboutNotice({ kind: "success", message: "Profile details updated." });
      // The profile page reads from the board's data, so refresh it.
      onChanged?.();
    } catch (err: any) {
      setAboutNotice({ kind: "error", message: err.message || "Couldn't update your profile details." });
    } finally {
      setAboutBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwNotice(null);
    if (newPw.length < 10) {
      setPwNotice({ kind: "error", message: "New password must be at least 10 characters." });
      return;
    }
    if (newPw !== confirmPw) {
      setPwNotice({ kind: "error", message: "The new passwords don't match." });
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(currentPw, newPw);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setPwNotice({
        kind: "success",
        message: "Password changed. You've been signed out of your other devices."
      });
    } catch (err: any) {
      setPwNotice({ kind: "error", message: err.message || "Couldn't change your password." });
    } finally {
      setPwBusy(false);
    }
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteNotice(null);
    if (signInMethods.password && !deletePw) {
      setDeleteNotice({ kind: "error", message: "Enter your password to confirm." });
      return;
    }
    if (!signInMethods.password && deletePw.trim().toLowerCase() !== user.loginUsername.toLowerCase()) {
      setDeleteNotice({ kind: "error", message: "That isn't your username. Check the spelling and try again." });
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteAccount(deletePw, signInMethods.password);
      setDeletePw("");
      onChanged?.();
      goHome();
    } catch (err: any) {
      setDeleteNotice({ kind: "error", message: err.message || "Couldn't delete your account." });
      setDeleteBusy(false);
    }
  };

  // Saves a JSON copy of everything stored about this member. No password is
  // asked for: it is the member's own data, behind their signed-in session.
  const handleExport = async () => {
    setExportNotice(null);
    setExportBusy(true);
    try {
      const fileName = await downloadMyData();
      setExportNotice({ kind: "success", message: `Your data was saved as ${fileName}.` });
    } catch (err: any) {
      setExportNotice({ kind: "error", message: err.message || "Couldn't download your data." });
    } finally {
      setExportBusy(false);
    }
  };

  // logout() clears the local session even when the request fails, but it
  // re-throws the network error, so swallow it here: the member is signed out
  // on this device either way.
  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Already signed out locally.
    }
    goHome();
  };

  const handleLogoutAll = async () => {
    try {
      await logoutAll();
    } catch {
      // Already signed out locally.
    }
    goHome();
  };

  return (
    <div id="account-page" className="mx-auto w-full min-w-0 max-w-4xl space-y-6">
      <PageHeader
        command="./leeterboard account --settings"
        title="Account settings"
        description="Choose how you appear on the board, and manage your password and account."
        actions={
          <>
            <a href={profileHref} className={btnLinkResponsive} id="account-view-profile" aria-label="View my profile" title="View my profile">
              <UserRound className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">View my profile</span>
            </a>
            <a href="#/" className={btnLinkResponsive} aria-label="Back to the leaderboard" title="Leaderboard">
              <ArrowLeft className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Leaderboard</span>
            </a>
          </>
        }
      />

      <div className="card-aurora flex min-w-0 animate-rise items-center gap-4 overflow-hidden p-4">
        <TierAvatar user={user} className="size-14" showGem gemSize="sm" />
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-bold text-strong">@{user.loginUsername}</p>
          {user.leetcodeLinked && (
            <p className="mt-0.5 text-xs text-mist-500">Your avatar comes from LeetCode and updates automatically.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
        {/* ---------- Left column: how you appear ---------- */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card icon={<UserRound className="size-4 text-teal-300" />} title="Display name" id="account-name-card">
            <form onSubmit={handleRename} className="flex flex-col gap-3">
              <div>
                <label htmlFor="acct-name" className="sr-only">
                  Display name
                </label>
                <input
                  id="acct-name"
                  type="text"
                  autoComplete="nickname"
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                  disabled={nameBusy}
                />
              </div>
              <NoticeBox notice={nameNotice} />
              <button type="submit" disabled={nameBusy} className={btnPrimary}>
                {nameBusy && <RefreshCw className="size-4 animate-spin" />}
                {nameBusy ? "Saving…" : "Save name"}
              </button>
            </form>
          </Card>

          <Card
            icon={<GraduationCap className="size-4 text-teal-300" />}
            title="School"
            description="Optional. Shown as a tag next to your name on the leaderboard."
            id="account-school-card"
          >
            <form onSubmit={handleSchool} className="flex flex-col gap-3">
              <div>
                <label htmlFor="acct-school" className="sr-only">
                  School
                </label>
                <input
                  id="acct-school"
                  type="text"
                  autoComplete="organization"
                  maxLength={60}
                  placeholder="e.g. 42 Network, ENSA Khouribga"
                  value={school}
                  onChange={(e) => setSchool(e.target.value)}
                  className={inputCls}
                  disabled={schoolBusy}
                />
                <p className="mt-1.5 text-xs text-mist-500">Leave it empty to remove it.</p>
              </div>
              <NoticeBox notice={schoolNotice} />
              <button type="submit" disabled={schoolBusy} className={btnPrimary}>
                {schoolBusy && <RefreshCw className="size-4 animate-spin" />}
                {schoolBusy ? "Saving…" : "Save school"}
              </button>
            </form>
          </Card>

          <Card
            icon={<Link2 className="size-4 text-teal-300" />}
            title="Bio & links"
            description="All optional, and shown publicly on your profile page."
            id="account-about-card"
          >
            <form onSubmit={handleAbout} className="flex flex-col gap-3">
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label htmlFor="acct-bio" className="text-sm font-medium text-mist-400">
                    Bio
                  </label>
                  <span className="text-xs tabular-nums text-mist-500">{bio.length}/200</span>
                </div>
                <textarea
                  id="acct-bio"
                  rows={3}
                  maxLength={200}
                  placeholder="A line or two about you"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full resize-y rounded-lg bg-ink-950 px-3 py-2 text-sm text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50"
                  disabled={aboutBusy}
                />
              </div>
              <div>
                <label htmlFor="acct-github" className={labelCls}>
                  GitHub
                </label>
                <input
                  id="acct-github"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  maxLength={200}
                  placeholder="github.com/your-name"
                  value={github}
                  onChange={(e) => setGithub(e.target.value)}
                  className={inputCls}
                  disabled={aboutBusy}
                />
              </div>
              <div>
                <label htmlFor="acct-linkedin" className={labelCls}>
                  LinkedIn
                </label>
                <input
                  id="acct-linkedin"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  maxLength={200}
                  placeholder="linkedin.com/in/your-name"
                  value={linkedin}
                  onChange={(e) => setLinkedin(e.target.value)}
                  className={inputCls}
                  disabled={aboutBusy}
                />
              </div>
              <div>
                <label htmlFor="acct-website" className={labelCls}>
                  Portfolio / website
                </label>
                <input
                  id="acct-website"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  maxLength={200}
                  placeholder="your-site.com"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className={inputCls}
                  disabled={aboutBusy}
                />
                <p className="mt-1.5 text-xs text-mist-500">Leave a field empty to remove it.</p>
              </div>
              <NoticeBox notice={aboutNotice} />
              <button type="submit" disabled={aboutBusy} className={btnPrimary}>
                {aboutBusy && <RefreshCw className="size-4 animate-spin" />}
                {aboutBusy ? "Saving…" : "Save bio & links"}
              </button>
            </form>
          </Card>
        </div>

        {/* ---------- Right column: security and account ---------- */}
        <div className="flex min-w-0 flex-col gap-6">
          <LinkedAccountsCard onChanged={onChanged} />

          <SignInMethodsCard />

          {signInMethods.password && <Card icon={<KeyRound className="size-4 text-teal-300" />} title="Change password" id="account-password-card">
            <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
              {/* Lets password managers attach the new password to the right account. */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={user.loginUsername}
                readOnly
                hidden
              />
              <div>
                <label htmlFor="acct-current-pw" className={labelCls}>
                  Current password
                </label>
                <input
                  id="acct-current-pw"
                  type="password"
                  autoComplete="current-password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className={inputCls}
                  disabled={pwBusy}
                  required
                />
              </div>
              <div>
                <label htmlFor="acct-new-pw" className={labelCls}>
                  New password <span className="font-normal text-mist-500">(10+ characters)</span>
                </label>
                <input
                  id="acct-new-pw"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={128}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className={inputCls}
                  disabled={pwBusy}
                  required
                />
              </div>
              <div>
                <label htmlFor="acct-confirm-pw" className={labelCls}>
                  Confirm new password
                </label>
                <input
                  id="acct-confirm-pw"
                  type="password"
                  autoComplete="new-password"
                  maxLength={128}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className={inputCls}
                  disabled={pwBusy}
                  required
                />
              </div>
              <NoticeBox notice={pwNotice} />
              <button type="submit" disabled={pwBusy} className={btnPrimary}>
                {pwBusy && <RefreshCw className="size-4 animate-spin" />}
                {pwBusy ? "Changing…" : "Change password"}
              </button>
              {user.passwordResetAt && (
                <p className="text-xs text-mist-500">
                  Password was last reset via linked account on {new Date(user.passwordResetAt).toLocaleDateString()}.
                </p>
              )}
            </form>
          </Card>}

          <Card icon={<LogOut className="size-4 text-teal-300" />} title="Sessions & Log out">
            <div className="flex flex-col gap-4">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-mist-400">Active sessions</h4>
                <p className="mt-1 text-sm leading-relaxed text-mist-400">
                  Sessions are versioned and revocable. You can sign out of this device, or revoke all active sessions across all devices (e.g. shared or lost computers).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={handleLogout} className={btnSecondary} id="logout-btn">
                  <LogOut className="size-4" />
                  Log out (this device)
                </button>
                <button type="button" onClick={handleLogoutAll} className={btnSecondary} id="logout-all-btn">
                  <AlertTriangle className="size-4 text-amber-300" />
                  Log out of all devices
                </button>
              </div>
            </div>
          </Card>

          <Card icon={<Download className="size-4 text-teal-300" />} title="Download your data" id="account-export-card">
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-mist-400">
                Get a copy of everything we store about you as one JSON file: your profile, sign-in connections, e-mail,
                stats and daily history for every linked platform, badges, notifications and feedback you sent. Your
                password and one-time codes are never included.
              </p>
              <NoticeBox notice={exportNotice} />
              <button type="button" onClick={handleExport} disabled={exportBusy} className={btnSecondary} id="export-data-btn">
                {exportBusy ? <RefreshCw className="size-4 animate-spin" /> : <Download className="size-4" />}
                {exportBusy ? "Preparing…" : "Download my data"}
              </button>
            </div>
          </Card>

          <Card icon={<Trash2 className="size-4 text-rose-300" />} title="Delete account" id="account-delete-card">
            {!confirmingDelete ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm leading-relaxed text-mist-400">
                  Removes you from the leaderboard and permanently deletes your stats and history. You can sign up
                  again later, but your history starts from zero.
                </p>
                <button type="button" onClick={() => setConfirmingDelete(true)} className={btnSecondary}>
                  <Trash2 className="size-4" />
                  Delete my account…
                </button>
              </div>
            ) : (
              <form onSubmit={handleDelete} className="flex flex-col gap-3">
                <p className="text-sm leading-relaxed text-rose-300">
                  This can't be undone. {signInMethods.password ? "Enter your password" : "Type your username"} to permanently delete{" "}
                  <span className="font-semibold">@{user.loginUsername}</span>.
                </p>
                <div>
                  <label htmlFor="acct-delete-pw" className="sr-only">
                    {signInMethods.password ? "Password" : "Username"}
                  </label>
                  <input
                    id="acct-delete-pw"
                    type={signInMethods.password ? "password" : "text"}
                    autoComplete={signInMethods.password ? "current-password" : "username"}
                    placeholder={signInMethods.password ? "Your password" : user.loginUsername}
                    value={deletePw}
                    onChange={(e) => setDeletePw(e.target.value)}
                    className={inputCls}
                    disabled={deleteBusy}
                    required
                  />
                </div>
                <NoticeBox notice={deleteNotice} />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDelete(false);
                      setDeletePw("");
                      setDeleteNotice(null);
                    }}
                    disabled={deleteBusy}
                    className={btnSecondary}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={deleteBusy} className={btnDanger}>
                    {deleteBusy ? <RefreshCw className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    {deleteBusy ? "Deleting…" : "Delete forever"}
                  </button>
                </div>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
