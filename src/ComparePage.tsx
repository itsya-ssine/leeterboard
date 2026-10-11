import React, { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { User } from "./types.js";
import { chartColors, useTheme } from "./theme.js";
import {
  barShare,
  buildHistorySeries,
  compareStats,
  tallyLeads,
  type CompareRow,
  type HistoryMode
} from "./compare.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

// Member A is always teal and member B amber, in the header, the stat rows and
// the chart, so the two are easy to tell apart at a glance.
const SIDE = {
  a: { text: "text-teal-300", bg: "bg-teal-400", ring: "ring-teal-300/40", dot: "bg-teal-400" },
  b: { text: "text-amber-300", bg: "bg-amber-400", ring: "ring-amber-300/40", dot: "bg-amber-400" }
} as const;

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

const enc = (u: User) => encodeURIComponent(u.leetcodeUsername);

// #/compare/<a>/<b>, with each part optional.
function readSelection(): [string | null, string | null] {
  const parts = window.location.hash.replace(/^#\/compare\/?/, "").split("/").filter(Boolean);
  const decode = (s: string | undefined) => {
    if (!s) return null;
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  };
  return [decode(parts[0]), decode(parts[1])];
}

function formatValue(v: number | null, format: CompareRow["format"]): string {
  if (v == null) return "—";
  if (format === "plus") return `+${v.toLocaleString()}`;
  if (format === "days") return `${v.toLocaleString()} ${v === 1 ? "day" : "days"}`;
  return v.toLocaleString();
}

function Value({ row, side }: { row: CompareRow; side: "a" | "b" }) {
  const leads = row.leader === side;
  return (
    <span
      className={`tabular-nums ${
        leads ? `text-base font-semibold ${SIDE[side].text}` : "text-sm text-mist-400"
      } ${side === "b" ? "text-right" : "text-left"}`}
    >
      {formatValue(row[side], row.format)}
      {leads && <span className="sr-only"> (ahead)</span>}
    </span>
  );
}

function StatRow({ row }: { row: CompareRow }) {
  const share = barShare(row);
  return (
    <li className="px-4 py-3 md:px-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-x-3">
        <Value row={row} side="a" />
        <span className="text-center text-sm text-mist-500">{row.label}</span>
        <Value row={row} side="b" />
      </div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-tint" aria-hidden="true">
        {share != null && (
          <>
            <div className={`${SIDE.a.bg} ${row.leader === "a" ? "opacity-90" : "opacity-40"}`} style={{ width: `${share * 100}%` }} />
            <div className={`${SIDE.b.bg} flex-1 ${row.leader === "b" ? "opacity-90" : "opacity-40"}`} />
          </>
        )}
      </div>
    </li>
  );
}

function MemberHeader({ user, side, leads }: { user: User; side: "a" | "b"; leads: number }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <img
        src={user.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        className={`size-16 rounded-full bg-ink-800 object-cover ring-2 md:size-20 ${SIDE[side].ring}`}
      />
      <div className="min-w-0 max-w-full">
        <div className="truncate text-base font-semibold tracking-tight text-strong md:text-lg">{user.displayName}</div>
        <div className="truncate text-sm text-mist-500">@{user.leetcodeUsername}</div>
      </div>
      <div className={`text-sm font-medium ${SIDE[side].text}`}>
        Ahead in {leads} {leads === 1 ? "stat" : "stats"}
      </div>
    </div>
  );
}

function MemberSelect({
  side,
  label,
  value,
  users,
  otherId,
  onChange
}: {
  side: "a" | "b";
  label: string;
  value: string;
  users: User[];
  otherId: string;
  onChange: (username: string) => void;
}) {
  const id = `compare-select-${side}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 flex items-center gap-2 text-xs font-medium text-mist-500">
        <span className={`size-2 rounded-full ${SIDE[side].dot}`} aria-hidden="true" />
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-10 w-full cursor-pointer rounded-lg bg-ink-950 px-3 text-sm text-mist-100 ring-1 ring-line transition-colors hover:ring-line-strong ${focusRing}`}
      >
        {users.map((u) => (
          <option key={u.id} value={u.leetcodeUsername} disabled={u.id === otherId}>
            {u.displayName} (@{u.leetcodeUsername})
          </option>
        ))}
      </select>
    </div>
  );
}

// Two members, head to head: every stat side by side with who is ahead, and
// their solved counts over time on one chart.
export default function ComparePage({ users }: { users: User[] }) {
  const [selA, setSelA] = useState<string | null>(() => readSelection()[0]);
  const [selB, setSelB] = useState<string | null>(() => readSelection()[1]);
  const [mode, setMode] = useState<HistoryMode>("gained");
  const { theme } = useTheme();
  const c = chartColors(theme);

  if (users.length < 2) {
    return (
      <p className="rounded-xl bg-ink-900 px-5 py-10 text-center text-sm text-mist-500 ring-1 ring-line">
        {users.length === 0 ? "Loading members…" : "You need at least two members on the board to compare."}
      </p>
    );
  }

  const find = (name: string | null) =>
    name ? users.find((u) => u.leetcodeUsername.toLowerCase() === name.toLowerCase()) : undefined;

  // Missing or unknown picks (a deep link to someone who has since left, or
  // only one name given) fall back to the top of the board.
  const a = find(selA) ?? users[0];
  const b = (() => {
    const picked = find(selB);
    return picked && picked.id !== a.id ? picked : users.find((u) => u.id !== a.id)!;
  })();

  // Keep the URL shareable without adding a history entry for every change.
  const sync = (nextA: User, nextB: User) => {
    window.history.replaceState(null, "", `#/compare/${enc(nextA)}/${enc(nextB)}`);
  };
  const pick = (side: "a" | "b", username: string) => {
    const chosen = find(username);
    if (!chosen) return;
    if (side === "a") {
      setSelA(chosen.leetcodeUsername);
      setSelB(b.leetcodeUsername);
      sync(chosen, b);
    } else {
      setSelA(a.leetcodeUsername);
      setSelB(chosen.leetcodeUsername);
      sync(a, chosen);
    }
  };
  const swap = () => {
    setSelA(b.leetcodeUsername);
    setSelB(a.leetcodeUsername);
    sync(b, a);
  };

  const rows = compareStats(a, b);
  const leads = tallyLeads(rows);
  const { points, startDate } = buildHistorySeries(a, b, mode);
  const last = points[points.length - 1];

  const verdict =
    leads.a === leads.b
      ? "Dead even on the stats that count."
      : `${(leads.a > leads.b ? a : b).displayName} is ahead in more stats.`;

  return (
    <div id="compare-page">
      {/* ---------- Pickers ---------- */}
      <section
        aria-label="Choose members to compare"
        className="mb-6 grid grid-cols-[1fr_auto_1fr] items-end gap-x-2 gap-y-3 md:gap-x-4"
      >
        <MemberSelect side="a" label="Member A" value={a.leetcodeUsername} users={users} otherId={b.id} onChange={(v) => pick("a", v)} />
        <button
          type="button"
          onClick={swap}
          aria-label="Swap the two members"
          title="Swap"
          className={`inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-ink-800 text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 ${focusRing}`}
        >
          <ArrowLeftRight className="size-4" aria-hidden="true" />
        </button>
        <MemberSelect side="b" label="Member B" value={b.leetcodeUsername} users={users} otherId={a.id} onChange={(v) => pick("b", v)} />
      </section>

      {/* ---------- Head to head ---------- */}
      <section aria-label="Head to head" className="mb-8 overflow-hidden rounded-xl bg-ink-900 ring-1 ring-line">
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-x-3 px-4 py-6 md:px-5">
          <MemberHeader user={a} side="a" leads={leads.a} />
          <span className="self-center text-xs font-semibold uppercase tracking-widest text-mist-500">vs</span>
          <MemberHeader user={b} side="b" leads={leads.b} />
        </div>
        <p className="border-t border-line px-4 py-2.5 text-center text-sm text-mist-400">
          {verdict}
          {leads.tied > 0 && <> {leads.tied} {leads.tied === 1 ? "stat is" : "stats are"} level or unavailable.</>}
        </p>
        <ul aria-label="Stats" className="divide-y divide-line border-t border-line">
          {rows.map((row) => (
            <StatRow key={row.id} row={row} />
          ))}
        </ul>
      </section>

      {/* ---------- History ---------- */}
      <section aria-label="History" className="mb-8 rounded-xl bg-ink-900 p-5 ring-1 ring-line">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-strong">History</h2>
            <p className="mt-0.5 text-sm text-mist-500">
              {mode === "gained"
                ? "Problems solved since the first day both have data"
                : "Total problems solved over time"}
            </p>
          </div>
          <div role="group" aria-label="History view" className="inline-flex rounded-lg bg-ink-950 p-1 ring-1 ring-line">
            {(
              [
                { value: "gained", label: "Progress" },
                { value: "total", label: "Total" }
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={mode === opt.value}
                onClick={() => setMode(opt.value)}
                className={`h-7 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors ${focusRing} ${
                  mode === opt.value ? "bg-ink-700 text-strong" : "text-mist-400 hover:text-strong"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {([["a", a], ["b", b]] as const).map(([side, u]) => (
            <span key={side} className="inline-flex items-center gap-2 text-mist-100">
              <span className={`size-2.5 rounded-full ${SIDE[side].dot}`} aria-hidden="true" />
              <span className="max-w-40 truncate">{u.displayName}</span>
              {last && mode === "gained" && (
                <span className={`font-semibold tabular-nums ${SIDE[side].text}`}>+{last[side].toLocaleString()}</span>
              )}
            </span>
          ))}
        </div>

        {points.length < 2 ? (
          <p className="py-10 text-center text-sm text-mist-500">
            The chart appears once the two of them share more than one day of history.
          </p>
        ) : (
          <>
            <div
              className="h-64 w-full"
              role="img"
              aria-label={`Solved counts for ${a.displayName} and ${b.displayName} from ${shortDate(startDate!)} to ${shortDate(last.date)}. ${a.displayName} ${
                mode === "gained" ? "gained" : "has"
              } ${last.a.toLocaleString()}, ${b.displayName} ${mode === "gained" ? "gained" : "has"} ${last.b.toLocaleString()}.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    tick={{ fill: c.tick, fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                  />
                  <YAxis
                    domain={
                      mode === "gained"
                        ? [0, (max: number) => Math.max(5, Math.ceil(max * 1.1))]
                        : [
                            (min: number) => Math.max(0, Math.floor(min * 0.98)),
                            (max: number) => Math.ceil(max * 1.02)
                          ]
                    }
                    allowDecimals={false}
                    tickFormatter={(v: number) => v.toLocaleString()}
                    tick={{ fill: c.tick, fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                  />
                  <Tooltip
                    cursor={{ stroke: c.cursor }}
                    contentStyle={{
                      background: c.tooltipBg,
                      border: `1px solid ${c.tooltipBorder}`,
                      borderRadius: 8,
                      color: c.tooltipText,
                      fontSize: 13
                    }}
                    labelStyle={{ color: c.tooltipLabel }}
                    labelFormatter={(label) => shortDate(String(label))}
                    formatter={(value, name) => [
                      `${mode === "gained" ? "+" : ""}${Number(value).toLocaleString()}`,
                      String(name)
                    ]}
                  />
                  <Line type="monotone" dataKey="a" name={a.displayName} stroke={c.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="b" name={b.displayName} stroke={c.accentB} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 text-sm text-mist-500">
              Since {shortDate(startDate!)}:{" "}
              {([["a", a], ["b", b]] as const).map(([side, u], i) => {
                const gained = last[side] - (mode === "gained" ? 0 : points[0][side]);
                return (
                  <React.Fragment key={side}>
                    {i > 0 && ", "}
                    <span className={`font-medium ${SIDE[side].text}`}>{u.displayName}</span> +{gained.toLocaleString()}
                  </React.Fragment>
                );
              })}
              .
            </p>
          </>
        )}
      </section>
    </div>
  );
}
