import React, { useEffect, useState } from "react";
import { Timer } from "lucide-react";

export function nextRoundStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return today + (7 - sinceMonday) * 86_400_000;
}

export function formatLocalReset(nextMs: number): string {
  try {
    const d = new Date(nextMs);
    const day = d.toLocaleDateString(undefined, { weekday: "short" });
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${day} ${time} your time (Mon 00:00 UTC)`;
  } catch {
    return "Monday 00:00 UTC";
  }
}

export function isoWeek(nowMs: number): number {
  const d = new Date(nowMs);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

export default function RoundTimer() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const targetMs = nextRoundStartMs(nowMs);
  const left = Math.max(0, targetMs - nowMs);
  const days = Math.floor(left / 86_400_000);
  const hms = [Math.floor(left / 3_600_000) % 24, Math.floor(left / 60_000) % 60, Math.floor(left / 1000) % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const localReset = formatLocalReset(targetMs);
  return (
    <div
      className="inline-flex items-center gap-2 border-2 border-ink-700 bg-ink-950 px-3 py-1 shadow-[2px_2px_0_#000]"
      title={`Weekly round resets on ${localReset}`}
    >
      <span className="size-2 bg-amber-400 shadow-[0_0_6px_#fbbf24] animate-pulse" aria-hidden="true" />
      <span className="font-pixel text-[9px] uppercase tracking-wider text-mist-500">Round Ends</span>
      <span
        className="font-mono text-xs font-bold tabular-nums text-amber-300"
        aria-label={`Round ends in ${days} days, ${hms}. Resets on ${localReset}`}
      >
        {days}d {hms}
      </span>
    </div>
  );
}
