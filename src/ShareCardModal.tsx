import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, ImageIcon, Linkedin, RefreshCw, Share2 } from "lucide-react";
import Modal from "./Modal.js";
import type { User } from "./types.js";
import { renderShareCard, type CardFormat, type CardTheme } from "./shareCard.js";

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

export default function ShareCardModal({
  user,
  rank,
  rankOf,
  topPercent,
  badgesEarned,
  onClose
}: {
  user: User;
  rank: number | null;
  rankOf: number;
  topPercent: number | null;
  badgesEarned: number;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<CardFormat>("wide");
  const [theme, setTheme] = useState<CardTheme>("dark");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [captionCopied, setCaptionCopied] = useState(false);

  // Link to this member's public profile page.
  const profileUrl = useMemo(
    () => `${window.location.origin}${window.location.pathname}#/u/${encodeURIComponent(user.leetcodeUsername)}`,
    [user.leetcodeUsername]
  );

  const [caption, setCaption] = useState(() => {
    const parts: string[] = [];
    parts.push(
      rank != null
        ? `I'm #${rank} of ${rankOf} on the Leeterboard 🏆`
        : `I'm on the Leeterboard 🏆`
    );
    const facts = [`${user.allTimeSolved.toLocaleString("en-US")} LeetCode problems solved`];
    if ((user.currentStreak ?? 0) > 1) facts.push(`a ${user.currentStreak}-day streak`);
    parts.push(facts.join(" and ") + ".");
    parts.push(profileUrl);
    return parts.join("\n\n");
  });

  const data = useMemo(
    () => ({
      displayName: user.displayName,
      leetcodeUsername: user.leetcodeUsername,
      avatarUrl: user.avatarUrl,
      school: user.school ?? "",
      rank,
      rankOf,
      topPercent,
      allTimeSolved: user.allTimeSolved,
      easySolved: user.easySolved,
      mediumSolved: user.mediumSolved,
      hardSolved: user.hardSolved,
      weeklyProgress: user.weeklyProgress,
      currentStreak: user.currentStreak,
      contestRating: user.contestRating,
      badgesEarned,
      host: window.location.host
    }),
    [user, rank, rankOf, topPercent, badgesEarned]
  );

  // Redraw whenever the format or theme changes.
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setError(null);
    renderShareCard(data, format, theme)
      .then((b) => {
        if (cancelled) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(b);
        urlRef.current = url;
        setBlob(b);
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

  const filename = `leeterboard-${user.leetcodeUsername}-${format}.png`;
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
    setNotice((await copyImage(blob)) ? "Image copied. Paste it into a post or chat." : "Your browser blocked copying the image. Use Download instead.");
  };

  const handleShare = async () => {
    if (!blob) return;
    try {
      await navigator.share({
        files: [new File([blob], filename, { type: "image/png" })],
        text: caption
      });
    } catch (err: any) {
      // Closing the share sheet is not an error.
      if (err?.name !== "AbortError") setNotice("Couldn't open the share sheet. Use Download instead.");
    }
  };

  // LinkedIn can't receive an image from a link, so open the composer first
  // (this has to happen inside the click), then put the image on the clipboard
  // or, failing that, download it, so it is one paste or upload away.
  const handleLinkedIn = async () => {
    if (!blob) return;
    const composer = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(caption)}`;
    window.open(composer, "_blank", "noopener,noreferrer");
    if (await copyImage(blob)) {
      setNotice("LinkedIn is open. Paste the image into your post (Ctrl/Cmd+V). If the text is empty, use Copy caption.");
    } else {
      downloadBlob(blob, filename);
      setNotice("LinkedIn is open and the card was downloaded. Attach the image to your post. If the text is empty, use Copy caption.");
    }
  };

  const handleCopyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCaptionCopied(true);
      window.setTimeout(() => setCaptionCopied(false), 1800);
    } catch {
      setNotice("Your browser blocked copying. Select the text and copy it by hand.");
    }
  };

  return (
    <Modal onClose={onClose} label="Share card" maxWidth="max-w-2xl" id="share-card-modal">
      <h2 className="mr-8 text-lg font-semibold tracking-tight text-strong">Share your card</h2>
      <p className="mt-1 text-sm text-mist-500">
        A picture of your stats to post on LinkedIn or send to friends.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Segmented<CardFormat>
          label="Card shape"
          value={format}
          onChange={setFormat}
          options={[
            { value: "wide", label: "Wide (LinkedIn)" },
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
            alt={`Share card for ${user.displayName}`}
            className={`max-h-[50vh] w-auto max-w-full rounded-lg object-contain transition-opacity ${
              rendering ? "opacity-40" : "opacity-100"
            }`}
          />
        ) : (
          <div className="flex items-center gap-2 py-10 text-sm text-mist-500">
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            Drawing your card…
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={handleDownload} disabled={!blob || rendering} className={btnPrimary}>
          <Download className="size-4" aria-hidden="true" />
          Download PNG
        </button>
        <button type="button" onClick={handleLinkedIn} disabled={!blob || rendering} className={btnSecondary}>
          <Linkedin className="size-4" aria-hidden="true" />
          Post on LinkedIn
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

      <div className="mt-3 border-t border-line pt-4">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label htmlFor="share-caption" className="text-sm font-medium text-mist-400">
            Caption
          </label>
          <button
            type="button"
            onClick={handleCopyCaption}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded text-xs font-medium text-mist-400 transition-colors hover:text-teal-300 ${focusRing}`}
          >
            {captionCopied ? (
              <Check className="size-3.5 text-teal-300" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {captionCopied ? "Copied" : "Copy caption"}
          </button>
        </div>
        <textarea
          id="share-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={4}
          maxLength={1500}
          className="w-full resize-y rounded-lg bg-ink-950 px-3 py-2 text-sm text-mist-100 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
        <p className="mt-1.5 text-xs text-mist-500">
          LinkedIn can't attach an image from a link, so the card is copied or downloaded for you to add to the post.
        </p>
      </div>
    </Modal>
  );
}
