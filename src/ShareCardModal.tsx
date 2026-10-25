import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, ImageIcon, Linkedin, Share2 } from "lucide-react";
import Modal from "./Modal.js";
import { btnPrimary, btnSecondary, CardHeader, focusRing, PreviewStage, Segmented, StatusLine } from "./CardDialog.js";
import type { User } from "./types.js";
import { renderShareCard, type CardFormat, type CardTheme } from "./shareCard.js";

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
      <CardHeader
        icon={<Share2 className="size-5" />}
        eyebrow="share.card"
        title="Share your card"
        description="A picture of your stats to post on LinkedIn or send to friends."
      />

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

      <div className="mt-4">
        <PreviewStage
          error={error}
          previewUrl={previewUrl}
          rendering={rendering}
          alt={`Share card for ${user.displayName}`}
          loadingText="Drawing your card…"
        />
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

      <StatusLine>{notice}</StatusLine>

      <div className="mt-4 border-t border-line pt-4">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label htmlFor="share-caption" className="font-mono text-[11px] font-semibold uppercase tracking-widest text-mist-500">
            Caption
          </label>
          <button
            type="button"
            onClick={handleCopyCaption}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded font-mono text-[11px] font-semibold uppercase tracking-wider text-mist-400 transition-colors hover:text-teal-300 ${focusRing}`}
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
          className="w-full resize-y rounded-xl bg-ink-950/80 px-3.5 py-3 text-sm leading-relaxed text-mist-100 ring-1 ring-line transition focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
        <p className="mt-1.5 text-xs text-mist-500">
          LinkedIn can't attach an image from a link, so the card is copied or downloaded for you to add to the post.
        </p>
      </div>
    </Modal>
  );
}
