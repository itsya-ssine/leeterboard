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
      className="ticker relative z-10 overflow-hidden border-b border-line bg-ink-950/60 py-1.5 font-mono text-xs"
    >
      <div className="ticker-track">
        {items.map((u, i) => (
          <span key={`${u.id}-${i}`} className="mx-5 inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
            <span className="rounded-[3px] bg-emerald-400/15 px-1.5 py-px font-bold text-emerald-400 ring-1 ring-emerald-400/30">
              AC
            </span>
            <span className="text-mist-100">{u.displayName}</span>
            <span className="font-semibold tabular-nums text-emerald-400">+{u.weeklyProgress}</span>
            <span className="text-mist-500">/ {u.allTimeSolved} total</span>
            <span className="text-mist-500/60">//</span>
          </span>
        ))}
      </div>
    </div>
  );
}
