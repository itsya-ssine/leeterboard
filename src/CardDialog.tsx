import React from "react";
import { RefreshCw } from "lucide-react";

// Shared pieces of the two "card" windows (the profile share card and the
// comparison card): the buttons, switches, header and preview stage. Only the
// window around the card is styled here; the card picture itself is drawn
// elsewhere (shareCard.ts / compareCard.ts) and is left as it is.

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const btnBase = `inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
export const btnPrimary = `${btnBase} bg-gradient-to-r from-teal-400 to-sky-400 text-ink-950 shadow-[0_0_0_1px_rgb(255_255_255/0.12)_inset,0_6px_20px_-6px_rgb(45_212_191/0.6)] hover:brightness-110 active:scale-[0.97] disabled:shadow-none`;
export const btnSecondary = `${btnBase} bg-ink-800/80 text-mist-100 ring-1 ring-line hover:bg-ink-700 hover:ring-line-strong active:scale-[0.97]`;

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
    <div role="group" aria-label={label} className="inline-flex rounded-xl bg-ink-950/80 p-1 ring-1 ring-line">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`h-8 cursor-pointer rounded-lg px-3.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${focusRing} ${
            value === opt.value
              ? "bg-gradient-to-b from-ink-700 to-ink-800 text-strong ring-1 ring-line-strong"
              : "text-mist-400 hover:text-strong"
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
    <div className="mr-10 flex items-start gap-3.5">
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-xl bg-tint text-teal-300 ring-1 ring-line"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-widest text-mist-500">{`// ${eyebrow}`}</div>
        <h2 className="mt-0.5 text-xl font-bold tracking-tight text-strong">{title}</h2>
        <p className="mt-1 text-sm text-mist-400">{description}</p>
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
      className="relative grid place-items-center overflow-hidden rounded-xl bg-ink-950/80 p-3 ring-1 ring-line"
      style={{ minHeight: "12rem" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(var(--color-line-strong) 1px, transparent 1px)",
          backgroundSize: "18px 18px"
        }}
      />
      <span
        aria-hidden="true"
        className="absolute left-3 top-2.5 font-mono text-[10px] uppercase tracking-widest text-mist-500"
      >
        {"// preview"}
      </span>
      {error ? (
        <p role="alert" className="relative px-4 py-10 text-center text-sm text-rose-300">
          {error}
        </p>
      ) : previewUrl ? (
        <img
          src={previewUrl}
          alt={alt}
          className={`relative mt-4 max-h-[50vh] w-auto max-w-full rounded-lg object-contain shadow-2xl shadow-black/50 transition-opacity ${
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
