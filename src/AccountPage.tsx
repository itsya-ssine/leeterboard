import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
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
  Trash2,
  UserRound
} from "lucide-react";
import { useAuth, type PlatformLinkChallenge } from "./AuthContext.js";
import type { PlatformAccount, PlatformId } from "./types.js";
import { formatRankTitle, rankTextClass } from "./CodeforcesPage.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const inputCls =
  "h-10 w-full rounded-lg bg-ink-950 px-3 text-sm text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50";

const btnBase = `inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnPrimary = `${btnBase} w-full bg-teal-400 text-ink-950 hover:bg-teal-300`;
const btnSecondary = `${btnBase} w-full bg-ink-800 text-mist-100 ring-1 ring-line hover:bg-ink-700`;
const btnDanger = `${btnBase} w-full bg-rose-500 text-white hover:bg-rose-400`;
const btnLink = `${btnBase} bg-ink-800 text-mist-100 ring-1 ring-line hover:bg-ink-700`;
// Header actions: a square icon button on phones, icon plus label from sm.
const btnLinkResponsive = `inline-flex size-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-ink-800 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 sm:w-auto sm:px-4 ${focusRing}`;

// Compact button for the rows in the Linked accounts card.
const btnSmall = `inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-ink-800 px-3 text-xs font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

const labelCls = "mb-1.5 block text-sm font-medium text-mist-400";

type Notice = { kind: "error" | "success"; message: string } | null;

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
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
    <section id={id} aria-label={title} className="min-w-0 rounded-xl bg-ink-900 p-4 ring-1 ring-line sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-strong">
        {icon}
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-mist-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}


/* ---------- Linked accounts ---------- */

// What the UI needs to know about each extra platform. `available: false`
// shows the row but keeps Add disabled (the server rejects linking until the
// platform has a provider); flip it when the provider lands.
const PLATFORM_UI: Record<
  PlatformId,
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

const PLATFORM_ORDER: PlatformId[] = ["codeforces", "codingame"];

function PlatformRow({
  platform,
  account,
  onChanged
}: {
  platform: PlatformId;
  account: PlatformAccount | undefined;
  onChanged?: () => void;
}) {
  const { startPlatformLink, verifyPlatformLink, unlinkPlatform, setPlatformHidden } = useAuth();
  const ui = PLATFORM_UI[platform];

  const [step, setStep] = useState<"idle" | "handle" | "verify">("idle");
  const [handle, setHandle] = useState("");
  const [challenge, setChallenge] = useState<PlatformLinkChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const reset = () => {
    setStep("idle");
    setHandle("");
    setChallenge(null);
    setNotice(null);
    setCopied(false);
  };

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
      setChallenge(await startPlatformLink(platform, trimmed));
      setStep("verify");
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message || `Couldn't start linking ${ui.label}.` });
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setNotice(null);
    setBusy(true);
    try {
      const updated = await verifyPlatformLink(platform);
      const linked = updated.platforms?.[platform];
      reset();
      setNotice({
        kind: "success",
        message: linked?.lastUpdated
          ? `${ui.label} linked.`
          : `${ui.label} linked. Your stats will show up after the next sync.`
      });
      onChanged?.();
    } catch (err: any) {
      if (err.expired) {
        // The request is gone on the server: back to the handle form.
        setChallenge(null);
        setStep("handle");
      }
      setNotice({ kind: "error", message: err.message || `Couldn't verify your ${ui.label} account.` });
    } finally {
      setBusy(false);
    }
  };

  // Hide / show this platform for other members. The server only sends a hidden
  // account to its owner and to admins.
  const handleHidden = async () => {
    if (!account) return;
    setNotice(null);
    setBusy(true);
    try {
      await setPlatformHidden(platform, !account.hidden);
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
      await unlinkPlatform(platform);
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
    <div id={`account-platform-${platform}`} className="min-w-0 rounded-lg bg-ink-950 p-3 ring-1 ring-line">
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
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm text-mist-100">
              {account.hidden ? (
                <EyeOff className="size-3.5 shrink-0 text-mist-500" aria-hidden="true" />
              ) : (
                <Eye className="size-3.5 shrink-0 text-mist-500" aria-hidden="true" />
              )}
              Hide from other members
            </p>
            <p className="mt-0.5 text-xs text-mist-500">
              {account.hidden
                ? "Only you and admins can see these stats."
                : "Everyone can see these stats on the board and on your profile."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={account.hidden}
            aria-label={`Hide ${ui.label} stats from other members`}
            onClick={handleHidden}
            disabled={busy}
            id={`account-platform-${platform}-hidden`}
            className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${
              account.hidden ? "bg-teal-400" : "bg-ink-700 ring-1 ring-line"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                account.hidden ? "translate-x-5" : "translate-x-0"
              }`}
              aria-hidden="true"
            />
          </button>
        </div>
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

      {/* Step 1: handle */}
      {!account && step === "handle" && (
        <form onSubmit={handleStart} className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
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
              Next you'll prove the account is yours by saving a short code on its profile.
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
        <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
          <p className="text-sm text-mist-400">
            Proving that <span className="font-medium text-strong">@{challenge.handle}</span> is yours.
          </p>

          <ol className="list-decimal space-y-2 break-words pl-5 text-sm leading-relaxed text-mist-400">
            <li>Copy this code:</li>
          </ol>
          <div className="flex items-center gap-2 rounded-lg bg-ink-900 p-2 pl-3 ring-1 ring-line">
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
              </a>
            </li>
          </ol>

          <p className="text-xs text-mist-500">The code expires in {challenge.expiresInMinutes} minutes.</p>

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

  return (
    <Card
      icon={<Link2 className="size-4 text-teal-300" />}
      title="Linked accounts"
      description="Add other platforms to appear on their boards. You prove each account is yours with a short code."
      id="account-platforms-card"
    >
      <div className="flex flex-col gap-3">
        {/* LeetCode is the main account: always linked, never removable here. */}
        <div id="account-platform-leetcode" className="rounded-lg bg-ink-950 p-3 ring-1 ring-line">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-strong">LeetCode</p>
              <p className="truncate text-xs text-mist-500">@{user.leetcodeUsername} · main account</p>
            </div>
            <span
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-ink-800 px-3 text-xs font-medium text-mist-400 ring-1 ring-line"
              title="LeetCode is your main account and can't be removed."
            >
              <Lock className="size-3.5" aria-hidden="true" />
              Locked
            </span>
          </div>
        </div>

        {PLATFORM_ORDER.map((platform) => (
          <PlatformRow key={platform} platform={platform} account={user.platforms?.[platform]} onChanged={onChanged} />
        ))}
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
    logout
  } = useAuth();

  const [name, setName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameNotice, setNameNotice] = useState<Notice>(null);

  const [school, setSchool] = useState("");
  const [schoolBusy, setSchoolBusy] = useState(false);
  const [schoolNotice, setSchoolNotice] = useState<Notice>(null);

  const [bio, setBio] = useState("");
  const [github, setGithub] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");
  const [aboutBusy, setAboutBusy] = useState(false);
  const [aboutNotice, setAboutNotice] = useState<Notice>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNotice, setPwNotice] = useState<Notice>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<Notice>(null);

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
    return <p className="py-10 text-center text-sm text-mist-500">Checking your session…</p>;
  }

  if (!user) {
    return (
      <div
        id="account-signed-out"
        className="mx-auto max-w-xl rounded-xl bg-ink-900 px-5 py-12 text-center ring-1 ring-line"
      >
        <p className="font-medium text-strong">You're not signed in</p>
        <p className="mt-1 text-sm text-mist-500">Log in to change your name, school, links or password.</p>
        <a href="#/" className={`${btnLink} mt-5`}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to the leaderboard
        </a>
      </div>
    );
  }

  const profileHref = `#/u/${encodeURIComponent(user.leetcodeUsername)}`;

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
    if (newPw.length < 8) {
      setPwNotice({ kind: "error", message: "New password must be at least 8 characters." });
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
    if (!deletePw) {
      setDeleteNotice({ kind: "error", message: "Enter your password to confirm." });
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteAccount(deletePw);
      setDeletePw("");
      onChanged?.();
      goHome();
    } catch (err: any) {
      setDeleteNotice({ kind: "error", message: err.message || "Couldn't delete your account." });
      setDeleteBusy(false);
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

  return (
    <div id="account-page" className="mx-auto w-full min-w-0 max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-strong sm:text-3xl md:text-4xl">Account settings</h1>
          <p className="mt-2 max-w-xl text-base text-mist-400">
            Choose how you appear on the board, and manage your password and account.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={profileHref} className={btnLinkResponsive} id="account-view-profile" aria-label="View my profile" title="View my profile">
            <UserRound className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">View my profile</span>
          </a>
          <a href="#/" className={btnLinkResponsive} aria-label="Back to the leaderboard" title="Leaderboard">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Leaderboard</span>
          </a>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-3 rounded-xl bg-ink-900 p-4 ring-1 ring-line">
        <img
          src={user.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-12 shrink-0 rounded-full bg-ink-800 object-cover"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-strong">@{user.leetcodeUsername}</p>
          <p className="text-xs text-mist-500">Your avatar comes from LeetCode and updates automatically.</p>
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

          <Card icon={<KeyRound className="size-4 text-teal-300" />} title="Change password" id="account-password-card">
            <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
              {/* Lets password managers attach the new password to the right account. */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={user.leetcodeUsername}
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
                  New password <span className="font-normal text-mist-500">(8+ characters)</span>
                </label>
                <input
                  id="acct-new-pw"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
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
            </form>
          </Card>

          <Card icon={<LogOut className="size-4 text-teal-300" />} title="Log out">
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-mist-400">
                Sign out of <span className="font-medium text-strong">@{user.leetcodeUsername}</span> on this device.
                Your stats and history are kept.
              </p>
              <button type="button" onClick={handleLogout} className={btnSecondary} id="logout-btn">
                <LogOut className="size-4" />
                Log out
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
                  This can't be undone. Enter your password to permanently delete{" "}
                  <span className="font-semibold">@{user.leetcodeUsername}</span>.
                </p>
                <div>
                  <label htmlFor="acct-delete-pw" className="sr-only">
                    Password
                  </label>
                  <input
                    id="acct-delete-pw"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Your password"
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
