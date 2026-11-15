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
  const total = Math.max(1, easy + medium + hard);
  const lg = size === "lg";
  const numBlocks = lg ? 20 : 14;

  const easyBlocks = Math.round((easy / total) * numBlocks);
  const medBlocks = Math.round((medium / total) * numBlocks);
  const hardBlocks = Math.min(
    numBlocks - (easyBlocks + medBlocks),
    Math.round((hard / total) * numBlocks)
  );

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
      {/* Segmented Pixel Bar */}
      <div
        className={`flex w-full gap-[2px] bg-ink-950 p-[2px] border-2 border-ink-700 ${
          lg ? "h-3.5" : "h-2.5"
        }`}
      >
        {Array.from({ length: numBlocks }).map((_, i) => {
          let bg = "bg-ink-800/80";
          if (i < easyBlocks) {
            bg = "bg-emerald-400";
          } else if (i < easyBlocks + medBlocks) {
            bg = "bg-amber-400";
          } else if (i < easyBlocks + medBlocks + hardBlocks) {
            bg = "bg-rose-500";
          }
          return (
            <span
              key={i}
              className={`h-full flex-1 ${bg} transition-colors duration-200`}
            />
          );
        })}
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
