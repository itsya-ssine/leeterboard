import React from "react";
import { RefreshCw } from "lucide-react";

// Shared pieces of the two "card" windows (the profile share card and the
// comparison card): the buttons, switches, header and preview stage. Only the
// window around the card is styled here; the card picture itself is drawn
// elsewhere (shareCard.ts / compareCard.ts) and is left as it is.

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const btnBase = `inline-flex h-10 cursor-pointer items-center justify-center gap-2 px-4 font-pixel text-[10px] uppercase tracking-wider transition-transform active:translate-x-[1px] active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
export const btnPrimary = `${btnBase} border-2 border-teal-400 bg-teal-400 font-bold text-ink-950 shadow-[2px_2px_0_#000] hover:bg-teal-300 active:shadow-none`;
export const btnSecondary = `${btnBase} border-2 border-ink-700 bg-ink-900 text-mist-100 shadow-[2px_2px_0_#000] hover:border-teal-400 hover:text-teal-300 active:shadow-none`;

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex border-2 border-ink-700 bg-ink-950 p-0.5 shadow-[2px_2px_0_#000]">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`h-8 cursor-pointer px-3.5 font-pixel text-[9px] uppercase tracking-wider transition-colors ${focusRing} ${
            value === opt.value
              ? "bg-teal-400 font-bold text-ink-950 shadow-[1px_1px_0_#000]"
              : "text-mist-400 hover:bg-ink-900 hover:text-strong"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Icon tile, a mono "// eyebrow", the title and a line of help.
export function CardHeader({
  icon,
  eyebrow,
  title,
  description
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <div className="mr-10 flex items-start gap-3.5 border-b-2 border-ink-700 pb-4">
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center border-2 border-ink-700 bg-ink-950 text-teal-300 shadow-[2px_2px_0_#000]"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-pixel text-[9px] uppercase tracking-widest text-emerald-400">{`// ${eyebrow}`}</div>
        <h2 className="mt-1 font-pixel text-base font-bold uppercase tracking-wide text-strong">{title}</h2>
        <p className="mt-1 font-mono text-xs text-mist-400">{description}</p>
      </div>
    </div>
  );
}

// The dotted stage the finished card sits on.
export function PreviewStage({
  error,
  previewUrl,
  rendering,
  alt,
  loadingText
}: {
  error: string | null;
  previewUrl: string | null;
  rendering: boolean;
  alt: string;
  loadingText: string;
}) {
  return (
    <div
      className="relative grid place-items-center overflow-hidden border-2 border-ink-700 bg-ink-950 p-4 shadow-[2px_2px_0_#000] pixel-grid-bg"
      style={{ minHeight: "12rem" }}
    >
      <span
        aria-hidden="true"
        className="absolute left-3 top-2.5 font-pixel text-[8px] uppercase tracking-widest text-emerald-400"
      >
        {"// PREVIEW"}
      </span>
      {error ? (
        <p role="alert" className="relative px-4 py-10 text-center font-mono text-sm text-rose-300">
          {error}
        </p>
      ) : previewUrl ? (
        <img
          src={previewUrl}
          alt={alt}
          className={`relative mt-4 max-h-[50vh] w-auto max-w-full border-2 border-ink-700 object-contain shadow-[4px_4px_0_#000] transition-opacity ${
            rendering ? "opacity-40" : "opacity-100"
          }`}
        />
      ) : (
        <div className="relative flex items-center gap-2 py-10 font-mono text-xs text-mist-500">
          <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
          {loadingText}
        </div>
      )}
    </div>
  );
}

export function StatusLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" aria-live="polite" className="mt-3 min-h-5 font-mono text-xs text-teal-300">
      {children}
    </p>
  );
}
