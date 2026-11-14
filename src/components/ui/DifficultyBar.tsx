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
  const segments = [
    { label: "Easy", letter: "E", value: easy, bar: "bg-gradient-to-r from-emerald-500 to-emerald-300", dot: "bg-emerald-400", text: "text-emerald-300" },
    { label: "Medium", letter: "M", value: medium, bar: "bg-gradient-to-r from-amber-500 to-amber-300", dot: "bg-amber-400", text: "text-amber-300" },
    { label: "Hard", letter: "H", value: hard, bar: "bg-gradient-to-r from-rose-500 to-rose-300", dot: "bg-rose-400", text: "text-rose-300" }
  ];

  return (
    <div
      className="flex w-full flex-col gap-2"
      role="img"
      aria-label={`${easy} easy, ${medium} medium, ${hard} hard`}
    >
      <div className={`flex w-full gap-0.5 overflow-hidden rounded-full bg-tint ${lg ? "h-2.5" : "h-1.5"}`}>
        {segments.map(
          (s) =>
            s.value > 0 && (
              <div
                key={s.label}
                className={`h-full rounded-full ${s.bar} transition-[width] duration-700 ease-out`}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.value} ${s.label}`}
              />
            )
        )}
      </div>
      <div className={`flex items-center tabular-nums ${lg ? "gap-5 text-sm" : "gap-3 text-xs"}`}>
        {segments.map((s) => (
          <span key={s.label} className={`inline-flex items-center gap-1.5 ${s.text}`}>
            <span className="balloon mb-0.5" aria-hidden="true" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-mist-500">
              {lg ? s.label : s.letter}
            </span>
            <span className="font-mono font-semibold">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
