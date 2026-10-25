import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Award, Bell, CheckCheck, Inbox, Megaphone, Trophy, X } from "lucide-react";
import type { AppNotification, NotificationFeed, NotificationType } from "./types.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

// How often the list quietly refreshes while the tab is visible. The server is
// serverless (no persistent connections), so polling is how new notifications
// arrive.
const POLL_MS = 60_000;

// Coming back to a tab fires both `focus` and `visibilitychange`; this keeps
// that from being two requests.
const MIN_RELOAD_GAP_MS = 5_000;

const TYPE_UI: Record<NotificationType, { Icon: typeof Bell; cls: string; label: string }> = {
  badge: { Icon: Award, cls: "bg-teal-400/10 text-teal-300 ring-teal-400/30", label: "Badge" },
  achievement: { Icon: Trophy, cls: "bg-amber-400/10 text-amber-300 ring-amber-300/30", label: "Achievement" },
  admin: { Icon: Megaphone, cls: "bg-sky-400/10 text-sky-300 ring-sky-400/30", label: "Message from an admin" }
};

function timeAgo(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

async function request(method: string, url: string, body?: unknown): Promise<NotificationFeed> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Couldn't load your notifications.");
  return data as NotificationFeed;
}

// Header bell for signed-in members: an unread count, and a panel with their
// badges, achievements and messages from admins. Everything shown here is
// plain text — titles and messages are rendered as React text nodes, never as
// HTML, so nothing an admin types can inject markup.
export default function NotificationBell() {
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Every request takes a ticket; only the newest ticket may update the list,
  // so a slow poll can't overwrite the result of something the member just did.
  const ticket = useRef(0);
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    lastLoad.current = Date.now();
    try {
      const next = await request("GET", "/api/notifications");
      if (mine !== ticket.current) return;
      setFeed(next);
      setError("");
      setNow(Date.now());
    } catch (err: any) {
      if (mine === ticket.current) setError(err.message || "Couldn't load your notifications.");
    }
  }, []);

  // Fetch on load, every minute, and whenever the tab comes back into view.
  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    const onWake = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current > MIN_RELOAD_GAP_MS) load();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [load]);

  // Close on Escape (returning focus to the bell) or a click outside.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  // Applies a change locally right away, sends it, then trusts the server's
  // answer (which is the member's full, current list). On failure, reload.
  const act = async (
    method: string,
    url: string,
    body: unknown,
    optimistic: (f: NotificationFeed) => NotificationFeed
  ) => {
    const mine = ++ticket.current;
    setFeed((f) => (f ? optimistic(f) : f));
    try {
      const next = await request(method, url, body);
      if (mine === ticket.current) {
        setFeed(next);
        setError("");
      }
    } catch (err: any) {
      setError(err.message || "That didn't work. Please try again.");
      load();
    }
  };

  const toggle = () => {
    setOpen((wasOpen) => !wasOpen);
    if (!open) {
      setNow(Date.now());
      load();
    }
  };

  const markRead = (n: AppNotification) => {
    if (n.read) return;
    act("POST", "/api/notifications/read", { ids: [n.id] }, (f) => ({
      notifications: f.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
      unread: Math.max(0, f.unread - 1)
    }));
  };

  const markAllRead = () =>
    act("POST", "/api/notifications/read", { all: true }, (f) => ({
      notifications: f.notifications.map((x) => ({ ...x, read: true })),
      unread: 0
    }));

  const dismiss = (n: AppNotification) =>
    act("DELETE", `/api/notifications/${encodeURIComponent(n.id)}`, undefined, (f) => ({
      notifications: f.notifications.filter((x) => x.id !== n.id),
      unread: n.read ? f.unread : Math.max(0, f.unread - 1)
    }));

  const clearRead = () =>
    act("POST", "/api/notifications/clear-read", {}, (f) => ({
      notifications: f.notifications.filter((x) => !x.read),
      unread: f.unread
    }));

  const unread = feed?.unread ?? 0;
  const items = feed?.notifications ?? [];
  const hasRead = items.some((n) => n.read);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        id="notifications-btn"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        title="Notifications"
        className={`relative inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-ink-800 text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 ${focusRing}`}
      >
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 grid min-w-[1.125rem] place-items-center rounded-full bg-gradient-to-r from-teal-400 to-sky-400 px-1 font-mono text-[0.6875rem] font-bold leading-[1.125rem] text-ink-950 tabular-nums ring-2 ring-ink-950"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Notifications"
          className="fixed inset-x-3 top-[4.25rem] z-50 shadow-2xl shadow-black/60 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <div className="card-aurora animate-rise overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-line bg-gradient-to-r from-teal-400/10 via-sky-400/5 to-transparent px-4 py-3">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-strong">
                <span aria-hidden="true" className="text-aurora-a">{"// "}</span>
                Notifications
                {unread > 0 && (
                  <span className="ml-2 rounded-full bg-teal-400/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-teal-300 ring-1 ring-teal-400/30">
                    {unread} new
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={markAllRead}
                disabled={unread === 0}
                className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-teal-300 transition-colors hover:bg-teal-400/10 disabled:cursor-not-allowed disabled:text-mist-500 disabled:hover:bg-transparent ${focusRing}`}
              >
                <CheckCheck className="size-3.5" aria-hidden="true" />
                Mark all read
              </button>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 border-b border-line bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">{error}</span>
                <button type="button" onClick={load} className={`shrink-0 cursor-pointer rounded font-medium underline ${focusRing}`}>
                  Retry
                </button>
              </div>
            )}

            {feed === null && !error ? (
              <p className="px-4 py-8 text-center font-mono text-xs uppercase tracking-widest text-mist-500">Loading…</p>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="grid size-10 place-items-center rounded-lg bg-tint text-mist-500 ring-1 ring-line">
                  <Inbox className="size-5" aria-hidden="true" />
                </span>
                <p className="mt-1 text-sm font-medium text-strong">You're all caught up.</p>
                <p className="text-xs text-mist-500">New badges, weekly wins and messages from admins show up here.</p>
              </div>
            ) : (
              <ul className="max-h-[min(28rem,70vh)] divide-y divide-line overflow-y-auto overscroll-contain">
                {items.map((n) => {
                  const { Icon, cls, label } = TYPE_UI[n.type] ?? TYPE_UI.admin;
                  return (
                    <li
                      key={n.id}
                      className={`relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-tint ${
                        n.read ? "" : "bg-gradient-to-r from-teal-400/[0.07] to-transparent"
                      }`}
                    >
                      {!n.read && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-teal-300 to-sky-400"
                        />
                      )}
                      <span
                        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ring-1 ${cls} ${n.read ? "opacity-60" : ""}`}
                        title={label}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                        <span className="sr-only">{label}</span>
                      </span>

                      <button
                        type="button"
                        onClick={() => markRead(n)}
                        aria-label={n.read ? undefined : `Mark as read: ${n.title}`}
                        className={`block min-w-0 flex-1 rounded text-left ${n.read ? "cursor-default" : "cursor-pointer"} ${focusRing}`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`block min-w-0 break-words text-sm font-semibold ${n.read ? "text-mist-400" : "text-strong"}`}>
                            {n.title}
                          </span>
                          {!n.read && (
                            <span
                              className="size-2 shrink-0 rounded-full bg-teal-300 shadow-[0_0_8px_rgb(45_212_191/0.8)]"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                        {n.body && (
                          <span className="mt-0.5 block whitespace-pre-wrap break-words text-sm text-mist-400">{n.body}</span>
                        )}
                        <span className="mt-1 block font-mono text-[11px] uppercase tracking-wider text-mist-500">
                          {timeAgo(n.createdAt, now)}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => dismiss(n)}
                        aria-label={`Dismiss: ${n.title}`}
                        title="Dismiss"
                        className={`-mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-mist-500 transition-colors hover:bg-tint hover:text-strong ${focusRing}`}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {hasRead && (
              <div className="border-t border-line bg-ink-950/40 px-4 py-2 text-right">
                <button
                  type="button"
                  onClick={clearRead}
                  className={`cursor-pointer rounded font-mono text-[11px] font-semibold uppercase tracking-wider text-mist-400 transition-colors hover:text-strong ${focusRing}`}
                >
                  Clear read
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
