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
      className={`inline-flex max-w-full items-center gap-1 rounded-full bg-teal-400/10 px-2 py-0.5 text-xs font-medium text-teal-300 ring-1 ring-teal-400/20 ${className}`}
    >
      <GraduationCap className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}
