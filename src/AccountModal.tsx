import React, { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, Check, KeyRound, RefreshCw, Trash2, UserRound } from "lucide-react";
import { useAuth } from "./AuthContext.js";
import Modal from "./Modal.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const inputCls =
  "h-10 w-full rounded-lg bg-ink-950 px-3 text-sm text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50";

const btnPrimary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-400 text-sm font-medium text-ink-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnSecondary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-ink-800 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnDanger = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-rose-500 text-sm font-medium text-white transition-colors hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

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

function Section({
  icon,
  title,
  children
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function AccountModal({
  open,
  onClose,
  onChanged
}: {
  open: boolean;
  onClose: () => void;
  // Called after something the leaderboard shows has changed (a rename or a
  // deleted account), so it can reload.
  onChanged?: () => void;
}) {
  const { user, updateDisplayName, changePassword, deleteAccount } = useAuth();

  const [name, setName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameNotice, setNameNotice] = useState<Notice>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNotice, setPwNotice] = useState<Notice>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<Notice>(null);

  // Fresh form (and no passwords left in state) every time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(user?.displayName ?? "");
      setNameNotice(null);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setPwNotice(null);
      setConfirmingDelete(false);
      setDeletePw("");
      setDeleteNotice(null);
    }
    // Only when opening — not whenever the user object changes mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!user) return null;

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
      onClose();
    } catch (err: any) {
      setDeleteNotice({ kind: "error", message: err.message || "Couldn't delete your account." });
      setDeleteBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <Modal onClose={onClose} label="Account settings" maxWidth="max-w-md" id="account-modal">
          <h2 className="mr-8 text-lg font-semibold tracking-tight text-white">Account settings</h2>

          <div className="mt-4 flex items-center gap-3 rounded-lg bg-ink-950 p-3 ring-1 ring-line">
            <img
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-10 shrink-0 rounded-full bg-ink-800 object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">@{user.leetcodeUsername}</p>
              <p className="text-xs text-mist-500">Your avatar comes from LeetCode and updates automatically.</p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-5">
            {/* ---------- Display name ---------- */}
            <Section icon={<UserRound className="size-4 text-teal-300" />} title="Display name">
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
            </Section>

            {/* ---------- Password ---------- */}
            <Section icon={<KeyRound className="size-4 text-teal-300" />} title="Change password">
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
                  <label htmlFor="acct-current-pw" className="mb-1.5 block text-sm font-medium text-mist-400">
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
                  <label htmlFor="acct-new-pw" className="mb-1.5 block text-sm font-medium text-mist-400">
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
                  <label htmlFor="acct-confirm-pw" className="mb-1.5 block text-sm font-medium text-mist-400">
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
            </Section>

            {/* ---------- Delete account ---------- */}
            <Section icon={<Trash2 className="size-4 text-rose-300" />} title="Delete account">
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
            </Section>
          </div>
        </Modal>
      )}
    </AnimatePresence>
  );
}
