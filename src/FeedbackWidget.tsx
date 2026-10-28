import React, { useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, Bug, CheckCircle2, Lightbulb, MessageCircle, MessageSquare, Send, Star } from "lucide-react";
import Modal from "./Modal.js";
import { useAuth } from "./AuthContext.js";
import type { FeedbackCategory } from "./types.js";

const REPO_URL = "https://github.com/itsya-ssine/leeterboard";

// Limits mirror the server's (feedbackRoutes.ts), which enforces them.
const MIN_LENGTH = 3;
const MAX_LENGTH = 1000;

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const floatBtn = `inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full text-sm font-medium shadow-lg shadow-black/30 transition-colors ${focusRing}`;

const btnPrimary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-400 text-sm font-medium text-ink-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnSecondary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-ink-800 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 ${focusRing}`;

const CATEGORIES: { value: FeedbackCategory; label: string; Icon: typeof Bug; placeholder: string }[] = [
  { value: "bug", label: "Bug", Icon: Bug, placeholder: "What happened, and what did you expect to happen?" },
  { value: "idea", label: "Idea", Icon: Lightbulb, placeholder: "What would make leeterboard better?" },
  { value: "other", label: "Other", Icon: MessageCircle, placeholder: "Anything on your mind." }
];

// Two floating buttons at the bottom right of every page: one opens the
// GitHub repo so people can star it, the other opens a short feedback form
// whose messages land in the admins' inbox (Admin page > Feedback).
export default function FeedbackWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const trimmed = message.trim();
  const canSend = status !== "sending" && trimmed.length >= MIN_LENGTH;
  const current = CATEGORIES.find((c) => c.value === category)!;

  const openDialog = () => {
    setError("");
    // A finished message starts over; an unsent draft is kept.
    if (status === "sent") setStatus("idle");
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The hash is where the app keeps its page (e.g. #/profile/alice), so
        // the admins can see where the message was written.
        body: JSON.stringify({ category, message: trimmed, page: window.location.hash.slice(0, 100) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send your feedback. Please try again.");
      setMessage("");
      setStatus("sent");
    } catch (err: any) {
      setError(err.message || "Couldn't send your feedback. Please try again.");
      setStatus("idle");
    }
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 sm:bottom-6 sm:right-6">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Star leeterboard on GitHub"
          className={`${floatBtn} w-11 bg-ink-900 text-mist-100 ring-1 ring-line hover:bg-ink-800 hover:ring-line-strong sm:w-auto sm:px-4`}
        >
          <Star className="size-4 text-amber-300" aria-hidden="true" />
          <span className="hidden sm:inline">Star on GitHub</span>
          <span className="sr-only sm:hidden">Star on GitHub</span>
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <button
          type="button"
          onClick={openDialog}
          aria-haspopup="dialog"
          title="Send feedback"
          className={`${floatBtn} w-11 bg-teal-400 text-ink-950 hover:bg-teal-300 sm:w-auto sm:px-4`}
        >
          <MessageSquare className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Feedback</span>
          <span className="sr-only sm:hidden">Send feedback</span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <Modal onClose={() => setOpen(false)} label="Send feedback">
            {status === "sent" ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center" role="status">
                <CheckCircle2 className="size-10 text-teal-300" aria-hidden="true" />
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-strong">Feedback sent</h3>
                  <p className="mt-1 text-sm text-mist-400">Thanks, the admins will see it on their Admin page.</p>
                </div>
                <div className="flex w-full flex-col gap-2">
                  <button type="button" onClick={() => setOpen(false)} className={btnPrimary}>
                    Close
                  </button>
                  <button type="button" onClick={() => setStatus("idle")} className={btnSecondary}>
                    Send more feedback
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-4">
                <div>
                  <h3 className="pr-10 text-lg font-semibold tracking-tight text-strong">Send feedback</h3>
                  <p className="mt-1 text-sm leading-relaxed text-mist-400">
                    Report a bug, suggest an idea, or say what you think. It goes straight to the admins.
                  </p>
                </div>

                <div role="group" aria-label="Kind of feedback" className="grid grid-cols-3 gap-1 rounded-lg bg-ink-950 p-1 ring-1 ring-line">
                  {CATEGORIES.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={category === value}
                      onClick={() => setCategory(value)}
                      className={`inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors ${focusRing} ${
                        category === value ? "bg-ink-700 text-strong" : "text-mist-400 hover:text-strong"
                      }`}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>

                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <label htmlFor="feedback-message" className="text-sm font-medium text-mist-400">
                      Your message
                    </label>
                    <span className="text-xs tabular-nums text-mist-500" aria-hidden="true">
                      {message.length}/{MAX_LENGTH}
                    </span>
                  </div>
                  <textarea
                    id="feedback-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={MAX_LENGTH}
                    rows={6}
                    autoFocus
                    disabled={status === "sending"}
                    placeholder={current.placeholder}
                    className="w-full resize-y rounded-lg bg-ink-950 px-3 py-2.5 text-sm text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50"
                  />
                  <p className="mt-1.5 text-xs text-mist-500">
                    {user
                      ? `Sent as ${user.displayName} (@${user.leetcodeUsername}).`
                      : "You're not signed in, so this will be sent anonymously."}
                  </p>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300 ring-1 ring-rose-400/20"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <button type="submit" disabled={!canSend} className={btnPrimary}>
                  <Send className="size-4" aria-hidden="true" />
                  {status === "sending" ? "Sending…" : "Send feedback"}
                </button>
              </form>
            )}
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}
