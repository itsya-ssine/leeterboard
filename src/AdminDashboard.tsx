import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, RefreshCw, Trash2, UserX } from "lucide-react";
import type { AdminSyncMember, AdminSyncReport } from "./types.js";

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
    return <p className="py-10 text-center text-sm text-mist-500">Loading sync status…</p>;
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
    </div>
  );
}
