import React from "react";
import { Gem } from "lucide-react";
import { tierOf, tierSummary, type RatingTier } from "./tiers.js";

// An avatar inside a frame that reflects the member's contest-rating tier, so
// a profile shows what was earned. Newbie to Pupil get a plain coloured ring;
// each tier above adds more: a glow, a two-tone ring, a banded ring, and for
// Grandmaster a slowly turning one. Unrated members keep the neutral ring.

const mix = (color: string, pct: number, into = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${into})`;

function frameFor(tier: RatingTier | null): { background: string; glow: string; spin: boolean } {
  if (!tier) return { background: "var(--color-line-strong)", glow: "none", spin: false };
  const c = tier.color;
  switch (tier.level) {
    case 0:
      return { background: c, glow: "none", spin: false };
    case 1:
    case 2:
      return { background: c, glow: `0 0 14px -3px ${mix(c, 60)}`, spin: false };
    case 3:
    case 4:
      return {
        background: `linear-gradient(135deg, ${c}, ${mix(c, 45, "white")} 50%, ${c})`,
        glow: `0 0 18px -3px ${mix(c, 70)}`,
        spin: false
      };
    case 5:
      return {
        background: `conic-gradient(from 200deg, ${c}, ${mix(c, 40, "#fde68a")}, ${c}, ${mix(c, 40, "#fde68a")}, ${c})`,
        glow: `0 0 22px -3px ${mix(c, 80)}`,
        spin: false
      };
    default:
      return {
        background: `conic-gradient(from 0deg, ${c}, #fbbf24, ${mix(c, 50, "white")}, ${c}, #fbbf24, ${c})`,
        glow: `0 0 26px -2px ${mix(c, 85)}`,
        spin: true
      };
  }
}

export default function TierAvatar({
  user,
  className = "size-10",
  showGem = false,
  gemSize = "md"
}: {
  user: { avatarUrl: string; contestRating: number | null };
  // Sizing and anything layout related (size-*, transitions, group-hover:...).
  className?: string;
  // A small tier gem on the corner, for the large avatars.
  showGem?: boolean;
  gemSize?: "sm" | "md";
}) {
  const tier = tierOf(user);
  const frame = frameFor(tier);

  return (
    <span className={`relative inline-block shrink-0 ${className}`} title={showGem ? tierSummary(user) : undefined}>
      <span
        className="relative block size-full overflow-hidden rounded-full p-[2px]"
        style={{ boxShadow: frame.glow }}
      >
        <span
          aria-hidden="true"
          className={`absolute ${frame.spin ? "-inset-1/2 motion-safe:animate-spin" : "inset-0"}`}
          style={{ background: frame.background, animationDuration: "8s" }}
        />
        <img
          src={user.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="relative size-full rounded-full border-2 border-ink-900 bg-ink-800 object-cover"
        />
      </span>
      {showGem && tier && (
        <span
          aria-hidden="true"
          className={`absolute grid place-items-center rounded-full bg-ink-900 ring-2 ring-line-strong ${
            gemSize === "sm" ? "-bottom-0.5 -left-0.5 size-5" : "-bottom-1 -left-1 size-7"
          }`}
          style={{ color: tier.color }}
        >
          <Gem className={gemSize === "sm" ? "size-3" : "size-3.5"} />
        </span>
      )}
    </span>
  );
}
