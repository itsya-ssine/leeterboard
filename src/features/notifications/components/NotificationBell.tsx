import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Award, Bell, CheckCheck, Inbox, Megaphone, Trophy, X } from "lucide-react";
import type { AppNotification, NotificationFeed, NotificationType } from "../../../types.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400";

const POLL_MS = 60_000;
const MIN_RELOAD_GAP_MS = 5_000;

const TYPE_UI: Record<NotificationType, { Icon: typeof Bell; cls: string; label: string }> = {
  badge: { Icon: Award, cls: "border-teal-500/40 bg-teal-950/60 text-teal-300", label: "Badge" },
  achievement: { Icon: Trophy, cls: "border-amber-500/40 bg-amber-950/60 text-amber-300", label: "Achievement" },
  admin: { Icon: Megaphone, cls: "border-sky-500/40 bg-sky-950/60 text-sky-300", label: "Message from an admin" }
};

function timeAgo(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
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

export default function NotificationBell() {
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && (typeof navigator === "undefined" || navigator.onLine)) {
        load();
      }
    }, POLL_MS);
    const onWake = () => {
      if (
        document.visibilityState === "visible" &&
        (typeof navigator === "undefined" || navigator.onLine) &&
        Date.now() - lastLoad.current > MIN_RELOAD_GAP_MS
      ) {
        load();
      }
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [load]);

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
        className={`relative flex size-9 shrink-0 cursor-pointer items-center justify-center border-2 border-ink-700 bg-ink-900 text-mist-100 shadow-[2px_2px_0_#000] transition-colors hover:border-mist-400 hover:bg-ink-800 ${focusRing}`}
      >
        <Bell className="size-4" aria-hidden="true" />
        <span className="sr-only" aria-live="polite">
          {unread > 0 ? `${unread} unread notifications` : "No unread notifications"}
        </span>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-2 grid min-w-[1.25rem] place-items-center border-2 border-ink-950 bg-emerald-400 px-1 font-pixel text-[9px] font-bold leading-[1.125rem] text-ink-950 tabular-nums shadow-[1px_1px_0_#000]"
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
          className="fixed inset-x-3 top-[4.25rem] z-50 shadow-[6px_6px_0_#000] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <div className="overflow-hidden border-2 border-ink-600 bg-ink-900">
            <div className="flex items-center justify-between gap-2 border-b-2 border-ink-700 bg-ink-950 px-4 py-2.5">
              <h2 className="font-pixel text-[11px] font-bold uppercase tracking-wider text-mist-100">
                Inbox
                {unread > 0 && (
                  <span className="ml-2 border border-emerald-500/50 bg-emerald-950/60 px-1.5 py-0.5 text-[9px] text-emerald-300">
                    {unread} new
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={markAllRead}
                disabled={unread === 0}
                className={`inline-flex h-6 cursor-pointer items-center gap-1 border border-ink-700 bg-ink-800 px-2 font-pixel text-[9px] uppercase tracking-wider text-teal-300 transition-colors hover:border-mist-400 hover:bg-ink-700 disabled:cursor-not-allowed disabled:text-mist-500 disabled:hover:bg-ink-800 disabled:hover:border-ink-700 ${focusRing}`}
              >
                <CheckCheck className="size-3" aria-hidden="true" />
                Read all
              </button>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 border-b-2 border-rose-500/80 bg-rose-950/60 px-4 py-2 text-xs text-rose-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 font-sans">{error}</span>
                <button type="button" onClick={load} className={`shrink-0 cursor-pointer font-pixel text-[9px] underline ${focusRing}`}>
                  Retry
                </button>
              </div>
            )}

            {feed === null && !error ? (
              <p className="px-4 py-8 text-center font-pixel text-[11px] uppercase tracking-widest text-mist-500">Loading…</p>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="grid size-10 place-items-center border-2 border-ink-700 bg-ink-950 text-mist-500">
                  <Inbox className="size-5" aria-hidden="true" />
                </span>
                <p className="mt-1 font-pixel text-xs uppercase tracking-wider text-mist-100">All caught up</p>
                <p className="text-xs text-mist-500 font-sans">New badges, weekly wins and messages from admins show up here.</p>
              </div>
            ) : (
              <ul className="max-h-[min(28rem,70vh)] divide-y-2 divide-ink-800 overflow-y-auto overscroll-contain">
                {items.map((n) => {
                  const { Icon, cls, label } = TYPE_UI[n.type] ?? TYPE_UI.admin;
                  return (
                    <li
                      key={n.id}
                      className={`relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-ink-800/60 ${
                        n.read ? "bg-ink-900" : "bg-ink-950/60"
                      }`}
                    >
                      {!n.read && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-1 bg-emerald-400"
                        />
                      )}
                      <span
                        className={`mt-0.5 grid size-7 shrink-0 place-items-center border ${cls} ${n.read ? "opacity-50" : ""}`}
                        title={label}
                      >
                        <Icon className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">{label}</span>
                      </span>

                      <button
                        type="button"
                        onClick={() => markRead(n)}
                        aria-label={n.read ? undefined : `Mark as read: ${n.title}`}
                        className={`block min-w-0 flex-1 text-left ${n.read ? "cursor-default" : "cursor-pointer"} ${focusRing}`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`block min-w-0 break-words text-sm font-semibold ${n.read ? "text-mist-400" : "text-mist-100"}`}>
                            {n.title}
                          </span>
                          {!n.read && (
                            <span
                              className="size-2 shrink-0 bg-emerald-400 shadow-[0_0_6px_#34d399]"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                        {n.body && (
                          <span className="mt-0.5 block whitespace-pre-wrap break-words text-xs text-mist-400 font-sans">{n.body}</span>
                        )}
                        <span className="mt-1 block font-mono text-[10px] uppercase tracking-wider text-mist-500">
                          {timeAgo(n.createdAt, now)}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => dismiss(n)}
                        aria-label={`Dismiss: ${n.title}`}
                        title="Dismiss"
                        className={`-mr-1 grid size-6 shrink-0 cursor-pointer place-items-center border border-transparent text-mist-500 hover:border-ink-700 hover:bg-ink-800 hover:text-mist-100 ${focusRing}`}
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {hasRead && (
              <div className="border-t-2 border-ink-700 bg-ink-950 px-4 py-2 text-right">
                <button
                  type="button"
                  onClick={clearRead}
                  className={`cursor-pointer font-pixel text-[9px] uppercase tracking-wider text-mist-400 transition-colors hover:text-mist-100 ${focusRing}`}
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
