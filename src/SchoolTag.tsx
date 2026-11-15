import React from "react";
import { GraduationCap } from "lucide-react";

// A small pill with the member's school, shown under their name on the
// leaderboard. Renders nothing when the member hasn't set one.
export default function SchoolTag({ school, className = "" }: { school?: string; className?: string }) {
  const name = school?.trim();
  if (!name) return null;
  return (
    <span
      title={name}
      className={`inline-flex max-w-full items-center gap-1.5 border border-teal-500/40 bg-ink-900/90 px-2 py-0.5 text-[11px] font-mono text-teal-300 shadow-[1px_1px_0_#000] ${className}`}
    >
      <GraduationCap className="size-3 shrink-0 text-teal-400" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}
