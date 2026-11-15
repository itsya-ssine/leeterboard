import React from "react";

export default function DifficultyBar({
  easy,
  medium,
  hard,
  size = "sm"
}: {
  easy: number;
  medium: number;
  hard: number;
  size?: "sm" | "lg";
}) {
  const totalSolved = easy + medium + hard;
  const lg = size === "lg";

  const segments = [
    { label: "Easy", letter: "E", value: easy, text: "text-emerald-400", blockColor: "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]" },
    { label: "Medium", letter: "M", value: medium, text: "text-amber-400", blockColor: "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.6)]" },
    { label: "Hard", letter: "H", value: hard, text: "text-rose-400", blockColor: "bg-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.6)]" }
  ];

  return (
    <div
      className="flex w-full flex-col gap-1.5"
      role="img"
      aria-label={`${easy} easy, ${medium} medium, ${hard} hard`}
    >
      {/* 100% Proportional Pixel Bar - No trailing gaps */}
      <div
        className={`flex w-full overflow-hidden border-2 border-ink-700 bg-ink-950 p-[1px] shadow-[1px_1px_0_#000] ${
          lg ? "h-3.5" : "h-2.5"
        }`}
      >
        {totalSolved > 0 ? (
          <div className="flex h-full w-full">
            {easy > 0 && (
              <div
                className="h-full bg-emerald-400 border-r border-ink-950 last:border-r-0 transition-[width] duration-300"
                style={{ width: `${(easy / totalSolved) * 100}%` }}
                title={`${easy} Easy`}
              />
            )}
            {medium > 0 && (
              <div
                className="h-full bg-amber-400 border-r border-ink-950 last:border-r-0 transition-[width] duration-300"
                style={{ width: `${(medium / totalSolved) * 100}%` }}
                title={`${medium} Medium`}
              />
            )}
            {hard > 0 && (
              <div
                className="h-full bg-rose-500 border-r border-ink-950 last:border-r-0 transition-[width] duration-300"
                style={{ width: `${(hard / totalSolved) * 100}%` }}
                title={`${hard} Hard`}
              />
            )}
          </div>
        ) : (
          <div className="h-full w-full bg-ink-800/40" />
        )}
      </div>

      {/* Numerical Indicators */}
      <div className={`flex items-center tabular-nums ${lg ? "gap-4 text-xs" : "gap-2.5 text-[11px]"}`}>
        {segments.map((s) => (
          <span key={s.label} className={`inline-flex items-center gap-1.5 ${s.text}`}>
            <span
              className={`inline-block size-1.5 shrink-0 ${
                s.value > 0 ? s.blockColor : "bg-ink-700"
              }`}
              aria-hidden="true"
            />
            <span className="font-pixel text-[9px] font-bold uppercase tracking-wider text-mist-500">
              {lg ? s.label : s.letter}
            </span>
            <span className="font-mono font-semibold">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
