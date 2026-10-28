import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bug, Check, CheckCircle2, Clock, ExternalLink, Inbox, Lightbulb, Megaphone, MessageCircle, RefreshCw, Send, Trash2, UserX } from "lucide-react";
import type { AdminSyncMember, AdminSyncReport, FeedbackCategory, FeedbackItem, SentMessage } from "./types.js";
import { ListSkeleton } from "./Skeleton.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const btnSmall = `inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium ring-1 ring-line transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

// Same bar the leaderboard uses for its "stale" badge: a full day without a
// successful fetch.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

// How often the page quietly reloads while it's open and visible.
const REFRESH_MS = 60_000;

type Health = "not_found" | "failing" | "stale" | "unknown" | "ok";

// Worst first, so the list reads as a to-do list from the top.
const HEALTH_ORDER: Health[] = ["not_found", "failing", "stale", "unknown", "ok"];

function healthOf(m: AdminSyncMember, now: number): Health {
  if (m.state === "not_found") return "not_found";
  if (m.state === "unavailable") return "failing";
  const age = now - Date.parse(m.lastUpdated);
  if (Number.isFinite(age) && age > STALE_AFTER_MS) return "stale";
  if (m.state === "unknown") return "unknown";
  return "ok";
}

const HEALTH_UI: Record<Health, { label: string; cls: string }> = {
  not_found: { label: "Account not found", cls: "bg-rose-400/10 text-rose-300 ring-rose-300/25" },
  failing: { label: "Sync failing", cls: "bg-amber-400/10 text-amber-300 ring-amber-300/25" },
  stale: { label: "Stale", cls: "bg-amber-400/10 text-amber-300 ring-amber-300/25" },
  unknown: { label: "No sync recorded", cls: "bg-tint text-mist-400 ring-line" },
  ok: { label: "Healthy", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-300/25" }
};

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "never";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

const exact = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "Never");

function StatusBadge({ health }: { health: Health }) {
  const { label, cls } = HEALTH_UI[health];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${cls}`}
    >
      {label}
    </span>
  );
}

// Limits mirror the server's (notificationRoutes.ts), which enforces them.
const MAX_TITLE_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 500;

const fieldCls =
  "w-full rounded-lg bg-ink-950 px-3 text-sm text-mist-100 placeholder:text-mist-500 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50";

// Send a notification to one member or to everyone, and see what was sent and
// how many people have read it. Everything is shown as plain text.
function MessagesPanel({ members }: { members: AdminSyncMember[] }) {
  const [to, setTo] = useState("all");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [sent, setSent] = useState<SentMessage[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const loadSent = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load sent messages.");
      setSent(data.messages as SentMessage[]);
      setLoadError("");
    } catch (err: any) {
      setLoadError(err.message || "Couldn't load sent messages.");
    } finally {
      setNow(Date.now());
    }
  }, []);

  // Read counts change as members open their notifications, so keep them fresh.
  useEffect(() => {
    loadSent();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadSent();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadSent]);

  const sortedMembers = [...members].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const trimmedTitle = title.trim();
  const canSend = !sending && trimmedTitle.length > 0 && members.length > 0;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    const target = to === "all" ? null : members.find((m) => m.id === to);
    // A message can't be taken back, so ask before it goes to everyone.
    if (to === "all" && !confirm(`Send this message to all ${members.length} members? It can't be unsent.`)) return;

    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, title: trimmedTitle, message })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send the message.");
      setNotice({
        kind: "success",
        message: target
          ? `Sent to ${target.displayName}.`
          : `Sent to ${data.sent} ${data.sent === 1 ? "member" : "members"}.`
      });
      setTitle("");
      setMessage("");
      await loadSent();
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message || "Couldn't send the message." });
    } finally {
      setSending(false);
    }
  };

  return (
    <section aria-labelledby="messages-heading" className="mt-8" id="admin-messages">
      <h2 id="messages-heading" className="mb-3 flex items-center gap-2 text-base font-semibold text-strong">
        <Megaphone className="size-4 text-teal-300" aria-hidden="true" />
        Send a message
      </h2>

      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={send} className="rounded-xl bg-ink-900 p-5 ring-1 ring-line lg:col-span-2" id="send-message-form">
          <label htmlFor="msg-to" className="mb-1.5 block text-sm font-medium text-mist-100">
            Send to
          </label>
          <select
            id="msg-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={sending}
            className={`${fieldCls} h-10 cursor-pointer`}
          >
            <option value="all">Everyone ({members.length})</option>
            {sortedMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} (@{m.leetcodeUsername})
              </option>
            ))}
          </select>

          <div className="mb-1.5 mt-4 flex items-baseline justify-between">
            <label htmlFor="msg-title" className="text-sm font-medium text-mist-100">
              Title
            </label>
            <span className="text-xs text-mist-500 tabular-nums" aria-hidden="true">
              {title.length}/{MAX_TITLE_LENGTH}
            </span>
          </div>
          <input
            id="msg-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="e.g. Weekly meetup moved to Friday"
            disabled={sending}
            autoComplete="off"
            className={`${fieldCls} h-10`}
          />

          <div className="mb-1.5 mt-4 flex items-baseline justify-between">
            <label htmlFor="msg-body" className="text-sm font-medium text-mist-100">
              Message <span className="font-normal text-mist-500">(optional)</span>
            </label>
            <span className="text-xs text-mist-500 tabular-nums" aria-hidden="true">
              {message.length}/{MAX_MESSAGE_LENGTH}
            </span>
          </div>
          <textarea
            id="msg-body"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={5}
            placeholder="Plain text only."
            disabled={sending}
            className={`${fieldCls} resize-y py-2.5`}
          />

          {notice && (
            <div
              role={notice.kind === "error" ? "alert" : "status"}
              className={`mt-4 rounded-lg p-3 text-sm ring-1 ${
                notice.kind === "error"
                  ? "bg-rose-500/10 text-rose-300 ring-rose-400/20"
                  : "bg-teal-400/10 text-teal-300 ring-teal-400/20"
              }`}
            >
              {notice.message}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSend}
            className={`mt-4 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          >
            <Send className="size-4" aria-hidden="true" />
            {sending ? "Sending…" : to === "all" ? "Send to everyone" : "Send message"}
          </button>
        </form>

        <div className="overflow-hidden rounded-xl bg-ink-900 ring-1 ring-line lg:col-span-3">
          <div className="border-b border-line px-5 py-2.5 text-xs font-medium text-mist-500">Recently sent</div>

          {loadError && (
            <div role="alert" className="flex items-start gap-2 border-b border-line bg-rose-500/10 px-5 py-2.5 text-xs text-rose-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{loadError}</span>
            </div>
          )}

          {sent === null ? (
            loadError ? null : <ListSkeleton bare label="Loading messages" rows={3} />
          ) : sent.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-mist-500">No messages sent yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {sent.map((m) => {
                const pct = m.recipients > 0 ? Math.round((m.read / m.recipients) * 100) : 0;
                return (
                  <li key={m.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 break-words font-medium text-strong">{m.title}</span>
                      <span className="shrink-0 text-xs text-mist-500" title={exact(m.createdAt)}>
                        {ago(m.createdAt, now)}
                      </span>
                    </div>
                    {m.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-mist-400">{m.body}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-mist-400">
                      <span className="inline-flex items-center rounded bg-tint px-1.5 py-0.5 ring-1 ring-line">
                        {m.recipientName === null ? `Everyone (${m.recipients})` : m.recipientName}
                      </span>
                      <span className="tabular-nums">
                        Read by {m.read} of {m.recipients}
                      </span>
                      <span
                        className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-800"
                        role="img"
                        aria-label={`${pct}% have read it`}
                      >
                        <span className="block h-full rounded-full bg-teal-400" style={{ width: `${pct}%` }} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

const FEEDBACK_UI: Record<FeedbackCategory, { label: string; cls: string; Icon: typeof Bug }> = {
  bug: { label: "Bug", cls: "bg-rose-400/10 text-rose-300 ring-rose-300/25", Icon: Bug },
  idea: { label: "Idea", cls: "bg-teal-400/10 text-teal-300 ring-teal-300/25", Icon: Lightbulb },
  other: { label: "Other", cls: "bg-tint text-mist-400 ring-line", Icon: MessageCircle }
};

// What members and visitors sent through the Feedback button. Unread first in
// spirit (a dot and a heavier title), newest first in order. Everything is
// shown as plain text, never as HTML.
function FeedbackPanel() {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/feedback", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load feedback.");
      setItems(data.items as FeedbackItem[]);
      setUnread(Number(data.unread) || 0);
      setLoadError("");
    } catch (err: any) {
      setLoadError(err.message || "Couldn't load feedback.");
    } finally {
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const toggleRead = async (item: FeedbackItem) => {
    setBusyId(item.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/feedback/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: !item.read })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't update the feedback.");
      await load();
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message || "Couldn't update the feedback." });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: FeedbackItem) => {
    if (!confirm("Delete this feedback? It can't be restored.")) return;
    setBusyId(item.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/feedback/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't delete the feedback.");
      setNotice({ kind: "success", message: "Feedback deleted." });
      await load();
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message || "Couldn't delete the feedback." });
    } finally {
      setBusyId(null);
    }
  };

  const shown = items === null ? [] : onlyUnread ? items.filter((i) => !i.read) : items;

  return (
    <section aria-labelledby="feedback-heading" className="mt-8" id="admin-feedback">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="feedback-heading" className="flex items-center gap-2 text-base font-semibold text-strong">
          <Inbox className="size-4 text-teal-300" aria-hidden="true" />
          Feedback
          {unread > 0 && (
            <span className="rounded-full bg-teal-400 px-2 py-0.5 text-xs font-medium tabular-nums text-ink-950">
              {unread} unread
            </span>
          )}
        </h2>
        <div role="group" aria-label="Filter feedback" className="inline-flex rounded-lg bg-ink-950 p-1 ring-1 ring-line">
          {(
            [
              { value: false, label: "All" },
              { value: true, label: "Unread" }
            ] as const
          ).map((opt) => (
            <button
              key={opt.label}
              type="button"
              aria-pressed={onlyUnread === opt.value}
              onClick={() => setOnlyUnread(opt.value)}
              className={`h-7 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors ${focusRing} ${
                onlyUnread === opt.value ? "bg-ink-700 text-strong" : "text-mist-400 hover:text-strong"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mb-3 rounded-lg p-3 text-sm ring-1 ${
            notice.kind === "error"
              ? "bg-rose-500/10 text-rose-300 ring-rose-400/20"
              : "bg-teal-400/10 text-teal-300 ring-teal-400/20"
          }`}
        >
          {notice.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-ink-900 ring-1 ring-line">
        {loadError && (
          <div role="alert" className="flex items-start gap-2 border-b border-line bg-rose-500/10 px-5 py-2.5 text-xs text-rose-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{loadError}</span>
          </div>
        )}

        {items === null ? (
          loadError ? null : <ListSkeleton bare label="Loading feedback" rows={3} />
        ) : shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-mist-500">
            {items.length === 0 ? "No feedback yet." : "Nothing unread."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((item) => {
              const { label, cls, Icon } = FEEDBACK_UI[item.category] ?? FEEDBACK_UI.other;
              const busy = busyId === item.id;
              return (
                <li key={item.id} className="px-4 py-4 md:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {!item.read && (
                        <span className="size-2 shrink-0 rounded-full bg-teal-400" role="img" aria-label="Unread" />
                      )}
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${cls}`}>
                        <Icon className="size-3" aria-hidden="true" />
                        {label}
                      </span>
                      <span className={`min-w-0 truncate text-sm ${item.read ? "text-mist-400" : "font-medium text-strong"}`}>
                        {item.authorName ? `${item.authorName} (@${item.authorUsername})` : "Anonymous"}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-mist-500" title={exact(item.createdAt)}>
                      {ago(item.createdAt, now)}
                    </span>
                  </div>

                  <p className={`mt-2 whitespace-pre-wrap break-words text-sm ${item.read ? "text-mist-400" : "text-mist-100"}`}>
                    {item.message}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs text-mist-500">
                      {item.page ? `Sent from ${item.page}` : ""}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => toggleRead(item)}
                        disabled={busy}
                        className={`${btnSmall} bg-ink-800 text-mist-100 hover:bg-ink-700`}
                      >
                        <Check className="size-3.5" aria-hidden="true" />
                        {item.read ? "Mark unread" : "Mark read"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(item)}
                        disabled={busy}
                        className={`${btnSmall} bg-ink-800 text-rose-300 hover:bg-rose-500/10`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// Admin-only page: who failed to sync and why, when each member was last
// synced, and which LeetCode accounts have gone missing (removed or renamed).
export default function AdminDashboard({ onChanged }: { onChanged: () => void }) {
  const [report, setReport] = useState<AdminSyncReport | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sync-status");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load sync status.");
      setReport(data as AdminSyncReport);
      setLoadError("");
    } catch (err: any) {
      setLoadError(err.message || "Couldn't load sync status.");
    } finally {
      setNow(Date.now());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const retry = async (m: AdminSyncMember) => {
    setBusyId(m.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/users/${m.id}/refresh`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sync failed.");
      setNotice({ kind: "success", message: `@${m.leetcodeUsername} synced.` });
      onChanged();
    } catch (err: any) {
      setNotice({ kind: "error", message: `@${m.leetcodeUsername}: ${err.message}` });
    } finally {
      setBusyId(null);
      await load();
    }
  };

  const remove = async (m: AdminSyncMember) => {
    if (!confirm(`Remove ${m.displayName} (@${m.leetcodeUsername}) from the board?`)) return;
    setBusyId(m.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/users/${m.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't remove the member.");
      setNotice({ kind: "success", message: `${m.displayName} was removed.` });
      onChanged();
    } catch (err: any) {
      setNotice({ kind: "error", message: err.message });
    } finally {
      setBusyId(null);
      await load();
    }
  };

  if (loading && !report) {
    return <ListSkeleton label="Loading sync status" rows={6} />;
  }

  if (!report) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl bg-rose-500/10 p-4 text-sm text-rose-300 ring-1 ring-rose-400/20">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{loadError || "Couldn't load sync status."}</span>
      </div>
    );
  }

  const rows = report.members
    .map((m) => ({ m, health: healthOf(m, now) }))
    .sort(
      (a, b) =>
        HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health) ||
        Date.parse(a.m.lastUpdated) - Date.parse(b.m.lastUpdated)
    );

  const count = (h: Health) => rows.filter((r) => r.health === h).length;
  const problems = rows.filter((r) => r.health !== "ok" && r.health !== "unknown").length;
  const shown = onlyProblems ? rows.filter((r) => r.health !== "ok" && r.health !== "unknown") : rows;

  const cards = [
    { label: "Members", value: rows.length, hint: "on the board" },
    { label: "Healthy", value: count("ok"), hint: "synced recently", tone: "text-emerald-300" },
    {
      label: "Failing or stale",
      value: count("failing") + count("stale"),
      hint: "LeetCode isn't answering, or no update in 24 h",
      tone: count("failing") + count("stale") > 0 ? "text-amber-300" : ""
    },
    {
      label: "Account not found",
      value: count("not_found"),
      hint: "removed or renamed on LeetCode",
      tone: count("not_found") > 0 ? "text-rose-300" : ""
    }
  ];

  return (
    <div id="admin-dashboard">
      <section
        aria-label="Sync summary"
        className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line lg:grid-cols-4"
      >
        {cards.map((c) => (
          <div key={c.label} className="min-w-0 bg-ink-900 p-5">
            <div className="text-sm text-mist-500">{c.label}</div>
            <div className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${c.tone || "text-strong"}`}>
              {c.value}
            </div>
            <div className="mt-1 text-sm text-mist-500">{c.hint}</div>
          </div>
        ))}
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-mist-400">
          Last full sync{" "}
          <span className="font-medium text-mist-100" title={exact(report.lastSyncAll || null)}>
            {ago(report.lastSyncAll || null, now)}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Filter members" className="inline-flex rounded-lg bg-ink-950 p-1 ring-1 ring-line">
            {(
              [
                { value: false, label: "All" },
                { value: true, label: `Needs attention${problems ? ` (${problems})` : ""}` }
              ] as const
            ).map((opt) => (
              <button
                key={opt.label}
                type="button"
                aria-pressed={onlyProblems === opt.value}
                onClick={() => setOnlyProblems(opt.value)}
                className={`h-7 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors ${focusRing} ${
                  onlyProblems === opt.value ? "bg-ink-700 text-strong" : "text-mist-400 hover:text-strong"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              load();
            }}
            className={`${btnSmall} bg-ink-800 text-mist-100 hover:bg-ink-700`}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Reload
          </button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300 ring-1 ring-rose-400/20">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{loadError} Showing the last data that loaded.</span>
        </div>
      )}
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mb-3 rounded-lg p-3 text-sm ring-1 ${
            notice.kind === "error"
              ? "bg-rose-500/10 text-rose-300 ring-rose-400/20"
              : "bg-teal-400/10 text-teal-300 ring-teal-400/20"
          }`}
        >
          {notice.message}
        </div>
      )}

      <section aria-label="Members" className="overflow-hidden rounded-xl bg-ink-900 ring-1 ring-line">
        <div className="hidden grid-cols-12 gap-x-4 border-b border-line px-5 py-2.5 text-xs font-medium text-mist-500 md:grid">
          <div className="col-span-4">Member</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Last synced</div>
          <div className="col-span-2">Last attempt</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {shown.length === 0 ? (
          <p className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-mist-500">
            <CheckCircle2 className="size-4 text-emerald-300" aria-hidden="true" />
            {rows.length === 0 ? "No members yet." : "Nothing needs attention."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map(({ m, health }) => {
              const busy = busyId === m.id;
              return (
                <li
                  key={m.id}
                  id={`sync-row-${m.id}`}
                  className="grid grid-cols-1 items-start gap-x-4 gap-y-3 px-4 py-4 md:grid-cols-12 md:px-5"
                >
                  <div className="flex min-w-0 items-center gap-3 md:col-span-4">
                    <img
                      src={m.avatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="size-10 shrink-0 rounded-full bg-ink-800 object-cover ring-1 ring-line-strong"
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-strong">{m.displayName}</div>
                      <a
                        href={`https://leetcode.com/u/${encodeURIComponent(m.leetcodeUsername)}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open this profile on LeetCode"
                        className={`inline-flex max-w-full items-center gap-1 rounded text-sm text-mist-500 transition-colors hover:text-teal-300 ${focusRing}`}
                      >
                        <span className="truncate">@{m.leetcodeUsername}</span>
                        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                        <span className="sr-only">(opens LeetCode)</span>
                      </a>
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <StatusBadge health={health} />
                    {health === "not_found" && (
                      <p className="mt-1 text-xs text-mist-500">
                        LeetCode has no user with this name — it was removed or renamed.
                      </p>
                    )}
                    {m.failures > 0 && (
                      <p
                        className="mt-1 flex items-center gap-1 text-xs text-mist-500"
                        title={m.failingSince ? `Failing since ${exact(m.failingSince)}` : undefined}
                      >
                        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                        {m.failures} failed {m.failures === 1 ? "attempt" : "attempts"}
                        {m.failingSince ? ` · since ${ago(m.failingSince, now)}` : ""}
                      </p>
                    )}
                  </div>

                  <div className="md:col-span-2">
                    <div className="flex items-center gap-1.5 text-sm text-mist-100" title={exact(m.lastUpdated)}>
                      <Clock className="size-3.5 shrink-0 text-mist-500 md:hidden" aria-hidden="true" />
                      {ago(m.lastUpdated, now)}
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <div className="text-sm text-mist-400" title={exact(m.lastAttempt)}>
                      {ago(m.lastAttempt, now)}
                    </div>
                  </div>

                  <div className="flex gap-2 md:col-span-2 md:justify-end">
                    <button
                      type="button"
                      onClick={() => retry(m)}
                      disabled={busy}
                      className={`${btnSmall} bg-ink-800 text-mist-100 hover:bg-ink-700`}
                    >
                      <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(m)}
                      disabled={busy}
                      title="Remove this member from the board"
                      className={`${btnSmall} bg-ink-800 text-rose-300 hover:bg-rose-500/10`}
                    >
                      {health === "not_found" ? (
                        <UserX className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      )}
                      Remove
                    </button>
                  </div>

                  {m.error && health !== "ok" && (
                    <p className="break-words rounded bg-tint px-2.5 py-1.5 text-xs text-mist-400 md:col-span-12">
                      Last error: {m.error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <MessagesPanel members={report.members} />
      <FeedbackPanel />
    </div>
  );
}
