import React from "react";
import type { User } from "../../../types.js";

export default function SubmissionTicker({ users }: { users: User[] }) {
  const solvers = [...users]
    .filter((u) => u.weeklyProgress > 0)
    .sort((a, b) => b.weeklyProgress - a.weeklyProgress)
    .slice(0, 14);
  if (solvers.length < 2) return null;
  const items = [...solvers, ...solvers]; // doubled so the loop is seamless
  return (
    <div
      aria-hidden="true"
      className="ticker relative z-10 overflow-hidden border-y-2 border-ink-700 bg-ink-950 py-2 font-mono text-xs shadow-[0_2px_0_#000]"
    >
      <div className="ticker-track">
        {items.map((u, i) => (
          <span key={`${u.id}-${i}`} className="mx-5 inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
            <span className="border border-emerald-500/60 bg-emerald-950/70 px-1.5 py-0.5 font-pixel text-[8px] font-bold uppercase tracking-wider text-emerald-300 shadow-[1px_1px_0_#000]">
              SOLVED
            </span>
            <span className="font-semibold text-mist-100">{u.displayName}</span>
            <span className="font-bold tabular-nums text-emerald-400">+{u.weeklyProgress} this week</span>
            <span className="text-mist-500 font-mono text-[11px]">({u.allTimeSolved} total)</span>
            <span className="font-pixel text-[10px] text-ink-600">■</span>
          </span>
        ))}
      </div>
    </div>
  );
}
