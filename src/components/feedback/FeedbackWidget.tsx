import React, { useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, Bug, CheckCircle2, Lightbulb, MessageCircle, MessageSquare, Send } from "lucide-react";
import Modal from "../ui/Modal.js";
import { useAuth } from "../../AuthContext.js";
import type { FeedbackCategory } from "../../types.js";
import { PixelCheck, PixelSkull } from "../../pixelArt.js";

const MIN_LENGTH = 3;
const MAX_LENGTH = 1000;

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400";

const floatBtn = `inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 border-2 border-emerald-600 bg-emerald-400 text-ink-950 font-pixel text-xs font-bold uppercase shadow-[3px_3px_0_#022c22] transition-transform hover:brightness-110 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${focusRing}`;

const btnPrimary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 border-2 border-emerald-600 bg-emerald-400 text-ink-950 font-pixel text-xs font-bold uppercase shadow-[2px_2px_0_#022c22] transition-transform hover:brightness-110 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnSecondary = `inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 border-2 border-ink-700 bg-ink-800 text-mist-100 font-pixel text-xs font-bold uppercase shadow-[2px_2px_0_#000] transition-transform hover:border-mist-400 hover:bg-ink-700 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${focusRing}`;

const CATEGORIES: { value: FeedbackCategory; label: string; Icon: typeof Bug; placeholder: string }[] = [
  { value: "bug", label: "Bug", Icon: Bug, placeholder: "What happened, and what did you expect to happen?" },
  { value: "idea", label: "Idea", Icon: Lightbulb, placeholder: "What would make leeterboard better?" },
  { value: "other", label: "Other", Icon: MessageCircle, placeholder: "Anything on your mind." }
];

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
      <div
        className="fixed z-40 flex items-center gap-2 right-4 sm:right-6"
        style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <button
          type="button"
          onClick={openDialog}
          aria-haspopup="dialog"
          title="Send feedback"
          className={`${floatBtn} px-3 sm:px-4`}
        >
          <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Feedback</span>
          <span className="sr-only sm:hidden">Send feedback</span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <Modal onClose={() => setOpen(false)} label="Feedback Terminal">
            {status === "sent" ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center" role="status">
                <div className="grid size-12 place-items-center border-2 border-emerald-500/80 bg-emerald-950/60 shadow-[3px_3px_0_#022c22]">
                  <PixelCheck size={20} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-pixel text-sm uppercase tracking-wide text-strong">Feedback Received</h3>
                  <p className="mt-1.5 text-sm text-mist-400 font-sans">Thanks, the admins will see it on their Admin page.</p>
                </div>
                <div className="flex w-full flex-col gap-2.5 mt-2">
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
                  <h3 className="pr-10 font-pixel text-xs uppercase tracking-wider text-strong">Report / Suggest</h3>
                  <p className="mt-1 text-xs text-mist-400 font-sans">
                    Report a bug, suggest an idea, or send feedback straight to the admins.
                  </p>
                </div>

                <div role="group" aria-label="Kind of feedback" className="grid grid-cols-3 gap-1.5 border-2 border-ink-700 bg-ink-950 p-1.5">
                  {CATEGORIES.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={category === value}
                      onClick={() => setCategory(value)}
                      className={`inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 font-pixel text-[10px] uppercase tracking-wider transition-colors ${focusRing} ${
                        category === value
                          ? "border border-teal-400 bg-ink-800 text-teal-300 shadow-[1px_1px_0_#000]"
                          : "border border-transparent text-mist-400 hover:text-mist-100"
                      }`}
                    >
                      <Icon className="size-3" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>

                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <label htmlFor="feedback-message" className="font-pixel text-[10px] uppercase tracking-wider text-mist-400">
                      Message
                    </label>
                    <span className="font-mono text-xs tabular-nums text-mist-500" aria-hidden="true">
                      {message.length}/{MAX_LENGTH}
                    </span>
                  </div>
                  <textarea
                    id="feedback-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={MAX_LENGTH}
                    rows={5}
                    autoFocus
                    disabled={status === "sending"}
                    placeholder={current.placeholder}
                    className="w-full resize-y border-2 border-ink-700 bg-ink-950 p-3 font-sans text-sm text-mist-100 placeholder:text-mist-500 shadow-[2px_2px_0_#000] focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:opacity-50"
                  />
                  <p className="mt-1.5 font-mono text-[11px] text-mist-500">
                    {user
                      ? `Sent as ${user.displayName} (@${user.loginUsername}).`
                      : "You're not signed in, so this will be sent anonymously."}
                  </p>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 border-2 border-rose-500/80 bg-rose-950/60 p-3 text-xs text-rose-300 shadow-[2px_2px_0_#4c0519]"
                  >
                    <PixelSkull size={14} className="mt-0.5 shrink-0" color="#f43f5e" />
                    <span>{error}</span>
                  </div>
                )}

                <button type="submit" disabled={!canSend} className={btnPrimary}>
                  <Send className="size-3.5" aria-hidden="true" />
                  {status === "sending" ? "Transmitting…" : "Transmit"}
                </button>
              </form>
            )}
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}
