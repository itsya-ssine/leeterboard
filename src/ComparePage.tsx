import React, { useState } from "react";
import { ArrowLeftRight, Crown, ImageIcon, Swords } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { User } from "./types.js";
import { chartColors, useTheme } from "./theme.js";
import {
  buildHistorySeries,
  compareStats,
  tallyLeads,
  type CompareRow,
  type HistoryMode
} from "./compare.js";
import CompareCardModal from "./CompareCardModal.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

// Player A is always teal and player B amber, in the arena, the stat bars and
// the chart, so the two are easy to tell apart at a glance.
const SIDE = {
  a: {
    text: "text-teal-300",
    dot: "bg-teal-400",
    ring: "ring-teal-300/60",
    glow: "bg-teal-400/30",
    pill: "bg-teal-400/10 text-teal-300 ring-teal-400/30",
    barOuter: "bg-gradient-to-l from-teal-300 to-teal-500",
    power: "bg-gradient-to-r from-teal-500 to-teal-300"
  },
  b: {
    text: "text-amber-300",
    dot: "bg-amber-400",
    ring: "ring-amber-300/60",
    glow: "bg-amber-400/30",
    pill: "bg-amber-400/10 text-amber-300 ring-amber-400/30",
    barOuter: "bg-gradient-to-r from-amber-300 to-amber-500",
    power: "bg-gradient-to-l from-amber-500 to-amber-300"
  }
} as const;

// A balloon next to the difficulty rows, in the same colours as elsewhere.
const ROW_BALLOON: Record<string, string> = {
  easy: "text-emerald-400",
  medium: "text-amber-400",
  hard: "text-rose-400"
};

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
      className={`font-mono tabular-nums ${
        leads ? `text-base font-bold ${SIDE[side].text}` : "text-sm text-mist-400"
      } ${side === "b" ? "text-right" : "text-left"}`}
    >
      {formatValue(row[side], row.format)}
      {leads && <span className="sr-only"> (ahead)</span>}
    </span>
  );
}

// One stat as a pair of mirrored bars that meet in the middle, like the two
// health bars of a versus screen. Both are scaled to the larger value.
function StatRow({ row }: { row: CompareRow }) {
  const max = Math.max(row.a ?? 0, row.b ?? 0);
  const width = (v: number | null) => {
    if (v == null || max <= 0 || v <= 0) return 0;
    return Math.max(3, (v / max) * 100);
  };
  const fill = (side: "a" | "b") => (row.leader === side ? "opacity-100" : "opacity-45");
  const glow = (side: "a" | "b") =>
    row.leader === side
      ? side === "a"
        ? "shadow-[0_0_10px_rgb(45_212_191/0.5)]"
        : "shadow-[0_0_10px_rgb(251_191_36/0.5)]"
      : "";

  return (
    <li className="px-4 py-3 md:px-6">
      <div className="mb-1.5 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-widest text-mist-500">
        {ROW_BALLOON[row.id] && <span className={`balloon mb-0.5 ${ROW_BALLOON[row.id]}`} aria-hidden="true" />}
        {row.label}
      </div>
      <div className="grid grid-cols-[4.5rem_1fr_1fr_4.5rem] items-center gap-x-2">
        <Value row={row} side="a" />
        <div className="flex h-2.5 justify-end overflow-hidden rounded-l-full bg-tint" aria-hidden="true">
          <div
            className={`h-full rounded-l-full transition-[width] duration-700 ease-out ${SIDE.a.barOuter} ${fill("a")} ${glow("a")}`}
            style={{ width: `${width(row.a)}%` }}
          />
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-r-full bg-tint" aria-hidden="true">
          <div
            className={`h-full rounded-r-full transition-[width] duration-700 ease-out ${SIDE.b.barOuter} ${fill("b")} ${glow("b")}`}
            style={{ width: `${width(row.b)}%` }}
          />
        </div>
        <Value row={row} side="b" />
      </div>
    </li>
  );
}

function Fighter({ user, side, leads, winner }: { user: User; side: "a" | "b"; leads: number; winner: boolean }) {
  const s = SIDE[side];
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <div className="h-5" aria-hidden="true">
        {winner && (
          <Crown className="animate-float size-5 fill-amber-300/30 text-amber-300 drop-shadow-[0_0_8px_rgb(252_211_77/0.6)]" />
        )}
      </div>
      <span className="relative grid place-items-center">
        <span aria-hidden="true" className={`animate-glow absolute inset-0 scale-125 rounded-full blur-xl ${s.glow}`} />
        <img
          src={user.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className={`relative size-20 rounded-full bg-ink-800 object-cover ring-2 ring-offset-2 ring-offset-ink-900 md:size-28 ${s.ring}`}
        />
      </span>
      <div className="mt-1 min-w-0 max-w-full">
        <div className="truncate text-base font-bold tracking-tight text-strong md:text-xl">{user.displayName}</div>
        <div className="truncate font-mono text-sm text-mist-500">@{user.leetcodeUsername}</div>
      </div>
      <div
        className={`rounded-full px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-widest ring-1 ${s.pill}`}
      >
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
      <label
        htmlFor={id}
        className="mb-1.5 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-mist-500"
      >
        <span className={`size-2 rounded-full ${SIDE[side].dot}`} aria-hidden="true" />
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-11 w-full cursor-pointer rounded-xl bg-ink-900 px-3 text-sm text-mist-100 ring-1 ring-line transition-colors hover:ring-line-strong ${focusRing}`}
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
  const [cardOpen, setCardOpen] = useState(false);
  const { theme } = useTheme();
  const c = chartColors(theme);

  if (users.length < 2) {
    return (
      <p className="card-aurora px-5 py-10 text-center text-sm text-mist-500">
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

  const decided = leads.a !== leads.b;
  const winner = decided ? (leads.a > leads.b ? "a" : "b") : null;
  const verdict = decided
    ? `${(winner === "a" ? a : b).displayName} is ahead in more stats.`
    : "Dead even on the stats that count.";
  const totalLeads = leads.a + leads.b;
  const powerA = totalLeads > 0 ? (leads.a / totalLeads) * 100 : 50;

  return (
    <div id="compare-page">
      {/* ---------- Pickers ---------- */}
      <section
        aria-label="Choose members to compare"
        className="mb-6 grid grid-cols-[1fr_auto_1fr] items-end gap-x-2 gap-y-3 md:gap-x-4"
      >
        <MemberSelect side="a" label="Player A" value={a.leetcodeUsername} users={users} otherId={b.id} onChange={(v) => pick("a", v)} />
        <button
          type="button"
          onClick={swap}
          aria-label="Swap the two members"
          title="Swap"
          className={`group/swap inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-ink-700 to-ink-800 text-mist-100 ring-1 ring-line-strong transition hover:brightness-125 active:scale-95 ${focusRing}`}
        >
          <ArrowLeftRight
            className="size-4 transition-transform duration-300 group-hover/swap:rotate-180"
            aria-hidden="true"
          />
        </button>
        <MemberSelect side="b" label="Player B" value={b.leetcodeUsername} users={users} otherId={a.id} onChange={(v) => pick("b", v)} />
      </section>

      {/* ---------- Head to head ---------- */}
      <section aria-label="Head to head" className="card-aurora relative mb-8 animate-rise overflow-hidden">
        {/* Each side leans toward its own colour */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-teal-400)_9%,transparent),transparent_38%,transparent_62%,color-mix(in_srgb,var(--color-amber-400)_9%,transparent))]"
        />

        <div className="relative flex items-center justify-between border-b border-line px-4 py-2.5 md:px-5">
          <div className="font-mono text-[11px] uppercase tracking-widest text-mist-500">// duel.arena</div>
          <button
            type="button"
            onClick={() => setCardOpen(true)}
            className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg bg-ink-800/80 px-3 font-mono text-xs font-semibold uppercase tracking-wider text-mist-100 ring-1 ring-line transition hover:bg-ink-700 hover:ring-line-strong active:scale-[0.97] ${focusRing}`}
          >
            <ImageIcon className="size-3.5" aria-hidden="true" />
            Create card
          </button>
        </div>

        <div className="relative grid grid-cols-[1fr_auto_1fr] items-start gap-x-3 px-4 pb-6 pt-5 md:px-6">
          <Fighter user={a} side="a" leads={leads.a} winner={winner === "a"} />
          <div className="flex flex-col items-center gap-2 self-center pt-6" aria-hidden="true">
            <span className="grid size-10 place-items-center rounded-full bg-ink-950/70 ring-1 ring-line-strong">
              <Swords className="size-4 text-mist-400" />
            </span>
            <span className="text-aurora font-logo text-3xl font-bold leading-none md:text-4xl">VS</span>
            <span className="font-mono text-lg font-bold tabular-nums text-strong md:text-xl">
              <span className={SIDE.a.text}>{leads.a}</span>
              <span className="mx-1 text-mist-500">:</span>
              <span className={SIDE.b.text}>{leads.b}</span>
            </span>
          </div>
          <Fighter user={b} side="b" leads={leads.b} winner={winner === "b"} />
        </div>

        {/* Tug-of-war: who is ahead in more stats */}
        <div className="relative px-4 pb-4 md:px-6">
          <div
            className="flex h-3 overflow-hidden rounded-full bg-tint"
            role="img"
            aria-label={`${a.displayName} leads ${leads.a} stats, ${b.displayName} leads ${leads.b}`}
          >
            <div
              className={`h-full transition-[width] duration-700 ease-out ${SIDE.a.power}`}
              style={{ width: `${powerA}%` }}
            />
            <div className="w-0.5 shrink-0 bg-ink-950" />
            <div className={`h-full flex-1 ${SIDE.b.power}`} />
          </div>
          <p className="mt-3 text-center font-mono text-xs uppercase tracking-wider text-mist-400">
            {verdict}
            {leads.tied > 0 && (
              <span className="text-mist-500">
                {" "}
                · {leads.tied} {leads.tied === 1 ? "stat is" : "stats are"} level or unavailable
              </span>
            )}
          </p>
        </div>

        <ul aria-label="Stats" className="relative divide-y divide-line border-t border-line">
          {rows.map((row) => (
            <StatRow key={row.id} row={row} />
          ))}
        </ul>
      </section>

      {/* ---------- History ---------- */}
      <section aria-label="History" className="card-aurora mb-8 animate-rise p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-mist-500">// history.log</div>
            <h2 className="mt-1 text-lg font-bold tracking-tight text-strong">History</h2>
            <p className="mt-0.5 text-sm text-mist-500">
              {mode === "gained"
                ? "Problems solved since the first day both have data"
                : "Total problems solved over time"}
            </p>
          </div>
          <div role="group" aria-label="History view" className="inline-flex rounded-xl bg-ink-950/80 p-1 ring-1 ring-line">
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
                className={`h-8 cursor-pointer rounded-lg px-4 font-mono text-xs font-semibold uppercase tracking-wider transition-colors ${focusRing} ${
                  mode === opt.value
                    ? "bg-gradient-to-b from-ink-700 to-ink-800 text-strong ring-1 ring-line-strong"
                    : "text-mist-400 hover:text-strong"
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
                <span className={`font-mono font-bold tabular-nums ${SIDE[side].text}`}>+{last[side].toLocaleString()}</span>
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
                  <Line type="monotone" dataKey="a" name={a.displayName} stroke={c.accent} strokeWidth={3} dot={false} animationDuration={900} />
                  <Line type="monotone" dataKey="b" name={b.displayName} stroke={c.accentB} strokeWidth={3} dot={false} animationDuration={900} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 font-mono text-xs text-mist-500">
              Since {shortDate(startDate!)}:{" "}
              {([["a", a], ["b", b]] as const).map(([side, u], i) => {
                const gained = last[side] - (mode === "gained" ? 0 : points[0][side]);
                return (
                  <React.Fragment key={side}>
                    {i > 0 && ", "}
                    <span className={`font-bold ${SIDE[side].text}`}>{u.displayName}</span> +{gained.toLocaleString()}
                  </React.Fragment>
                );
              })}
              .
            </p>
          </>
        )}
      </section>

      {cardOpen && <CompareCardModal a={a} b={b} onClose={() => setCardOpen(false)} />}
    </div>
  );
}
