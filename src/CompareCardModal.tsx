import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, ImageIcon, RefreshCw, Share2 } from "lucide-react";
import Modal from "./Modal.js";
import type { User } from "./types.js";
import { compareStats, tallyLeads } from "./compare.js";
import { renderCompareCard } from "./compareCard.js";
import type { CardFormat, CardTheme } from "./shareCard.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const btnBase = `inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnPrimary = `${btnBase} bg-teal-400 text-ink-950 hover:bg-teal-300`;
const btnSecondary = `${btnBase} bg-ink-800 text-mist-100 ring-1 ring-line hover:bg-ink-700`;

function Segmented<T extends string>({
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
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-ink-950 p-1 ring-1 ring-line">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`h-7 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors ${focusRing} ${
            value === opt.value ? "bg-ink-700 text-strong" : "text-mist-400 hover:text-strong"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function copyImage(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

// A picture of the head-to-head between two members, to download or share.
export default function CompareCardModal({ a, b, onClose }: { a: User; b: User; onClose: () => void }) {
  const [format, setFormat] = useState<CardFormat>("wide");
  const [theme, setTheme] = useState<CardTheme>("dark");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const data = useMemo(() => {
    const rows = compareStats(a, b);
    const leads = tallyLeads(rows);
    return {
      a: { displayName: a.displayName, leetcodeUsername: a.leetcodeUsername, avatarUrl: a.avatarUrl },
      b: { displayName: b.displayName, leetcodeUsername: b.leetcodeUsername, avatarUrl: b.avatarUrl },
      rows,
      leadsA: leads.a,
      leadsB: leads.b,
      host: window.location.host
    };
  }, [a, b]);

  // Redraw whenever the members, format or theme change.
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setError(null);
    renderCompareCard(data, format, theme)
      .then((out) => {
        if (cancelled) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(out);
        urlRef.current = url;
        setBlob(out);
        setPreviewUrl(url);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || "Couldn't create the card.");
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, format, theme]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  const filename = `leeterboard-${a.leetcodeUsername}-vs-${b.leetcodeUsername}-${format}.png`;
  const canShareFile = useMemo(() => {
    if (!blob || typeof navigator.canShare !== "function" || typeof navigator.share !== "function") return false;
    try {
      return navigator.canShare({ files: [new File([blob], filename, { type: "image/png" })] });
    } catch {
      return false;
    }
  }, [blob, filename]);

  const handleDownload = () => {
    if (!blob) return;
    downloadBlob(blob, filename);
    setNotice("Card downloaded.");
  };

  const handleCopyImage = async () => {
    if (!blob) return;
    setNotice(
      (await copyImage(blob))
        ? "Image copied. Paste it into a post or chat."
        : "Your browser blocked copying the image. Use Download instead."
    );
  };

  const handleShare = async () => {
    if (!blob) return;
    try {
      await navigator.share({
        files: [new File([blob], filename, { type: "image/png" })],
        text: `${a.displayName} vs ${b.displayName} on the Leeterboard`
      });
    } catch (err: any) {
      // Closing the share sheet is not an error.
      if (err?.name !== "AbortError") setNotice("Couldn't open the share sheet. Use Download instead.");
    }
  };

  return (
    <Modal onClose={onClose} label="Comparison card" maxWidth="max-w-2xl" id="compare-card-modal">
      <h2 className="mr-8 text-lg font-semibold tracking-tight text-strong">Comparison card</h2>
      <p className="mt-1 text-sm text-mist-500">
        {a.displayName} vs {b.displayName}, as a picture to download or send to friends.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Segmented<CardFormat>
          label="Card shape"
          value={format}
          onChange={setFormat}
          options={[
            { value: "wide", label: "Wide" },
            { value: "square", label: "Square" }
          ]}
        />
        <Segmented<CardTheme>
          label="Card theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" }
          ]}
        />
      </div>

      <div
        className="mt-4 grid place-items-center overflow-hidden rounded-xl bg-ink-950 p-2 ring-1 ring-line"
        style={{ minHeight: "12rem" }}
      >
        {error ? (
          <p role="alert" className="px-4 py-10 text-center text-sm text-rose-300">
            {error}
          </p>
        ) : previewUrl ? (
          <img
            src={previewUrl}
            alt={`Comparison card: ${a.displayName} vs ${b.displayName}`}
            className={`max-h-[50vh] w-auto max-w-full rounded-lg object-contain transition-opacity ${
              rendering ? "opacity-40" : "opacity-100"
            }`}
          />
        ) : (
          <div className="flex items-center gap-2 py-10 text-sm text-mist-500">
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            Drawing the card…
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={handleDownload} disabled={!blob || rendering} className={btnPrimary}>
          <Download className="size-4" aria-hidden="true" />
          Download PNG
        </button>
        {canShareFile && (
          <button type="button" onClick={handleShare} disabled={!blob || rendering} className={btnSecondary}>
            <Share2 className="size-4" aria-hidden="true" />
            Share…
          </button>
        )}
        {typeof ClipboardItem !== "undefined" && (
          <button type="button" onClick={handleCopyImage} disabled={!blob || rendering} className={btnSecondary}>
            <ImageIcon className="size-4" aria-hidden="true" />
            Copy image
          </button>
        )}
      </div>

      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-teal-300">
        {notice}
      </p>
    </Modal>
  );
}
