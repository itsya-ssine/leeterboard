import React from "react";

// The intro every page opens with: a terminal prompt line, a big title and a
// short description, with optional actions on the right. Same markup as the
// intro App.tsx renders for the leaderboard, stats, compare and platform pages.
export default function PageHeader({
  command,
  title,
  description,
  actions
}: {
  command: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2 font-mono text-xs text-mist-500" aria-hidden="true">
          <span className="font-bold text-emerald-400">&#8250;</span>
          <span className="truncate">{command}</span>
          <span className="animate-blink inline-block h-3.5 w-1.5 bg-teal-400" />
        </div>
        <h1 className="animate-rise font-logo text-3xl font-bold tracking-tight text-strong md:text-5xl">{title}</h1>
        {description && <p className="mt-2 max-w-xl text-base text-mist-400">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
