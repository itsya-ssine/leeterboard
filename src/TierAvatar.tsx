import React from "react";
import { Gem } from "lucide-react";
import { tierOf, tierSummary, type RatingTier } from "./tiers.js";

// An avatar inside a frame that reflects the member's contest-rating tier, so
// a profile shows what was earned. Newbie to Pupil get a plain coloured ring;
// each tier above adds more: a glow, a two-tone ring, a banded ring, and for
// Grandmaster a slowly turning one. Unrated members keep the neutral ring.

const mix = (color: string, pct: number, into = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${into})`;

function frameFor(tier: RatingTier | null): { background: string; glow: string; spin: boolean; border: string } {
  if (!tier) {
    return {
      background: "var(--color-line-strong)",
      glow: "2px 2px 0px #000",
      spin: false,
      border: "var(--color-ink-700)"
    };
  }
  const c = tier.color;
  switch (tier.level) {
    case 0:
      return { background: c, glow: `2px 2px 0px #000`, spin: false, border: c };
    case 1:
    case 2:
      return { background: c, glow: `2px 2px 0px #000, 0 0 10px ${mix(c, 50)}`, spin: false, border: c };
    case 3:
    case 4:
      return {
        background: `linear-gradient(135deg, ${c}, ${mix(c, 45, "white")} 50%, ${c})`,
        glow: `2px 2px 0px #000, 0 0 14px ${mix(c, 65)}`,
        spin: false,
        border: c
      };
    case 5:
      return {
        background: `conic-gradient(from 200deg, ${c}, ${mix(c, 40, "#fde68a")}, ${c}, ${mix(c, 40, "#fde68a")}, ${c})`,
        glow: `2px 2px 0px #000, 0 0 18px ${mix(c, 75)}`,
        spin: false,
        border: "#fbbf24"
      };
    default:
      return {
        background: `conic-gradient(from 0deg, ${c}, #fbbf24, ${mix(c, 50, "white")}, ${c}, #fbbf24, ${c})`,
        glow: `2px 2px 0px #000, 0 0 22px ${mix(c, 85)}`,
        spin: true,
        border: "#f43f5e"
      };
  }
}

// Inner picture radius for the supported frame shapes (frame minus its padding).
const INNER_RADIUS: Record<string, string> = {
  "rounded-full": "rounded-full",
  "rounded-xl": "rounded-[8px]",
  "rounded-2xl": "rounded-[12px]"
};

// The frame itself, for any picture and any tier. TierAvatar below is the
// LeetCode flavour (tier from the contest rating); the Codeforces and CodinGame
// pages pass their own tier.
export function FramedAvatar({
  src,
  tier,
  className = "size-10",
  shape = "rounded-full",
  title,
  showGem = false,
  gemSize = "md"
}: {
  src: string;
  tier: RatingTier | null;
  className?: string;
  shape?: "rounded-full" | "rounded-xl" | "rounded-2xl";
  title?: string;
  showGem?: boolean;
  gemSize?: "sm" | "md";
}) {
  const frame = frameFor(tier);

  return (
    <span className={`relative inline-block shrink-0 ${className}`} title={title}>
      {/* Outer neon halo / glow layer (free of overflow-hidden clipping) */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 ${shape}`}
        style={{ boxShadow: frame.glow }}
      />
      {/* Framed avatar image with clipped rotating gradient */}
      <span className={`relative block size-full overflow-hidden p-[2px] ${shape}`}>
        <span
          aria-hidden="true"
          className={`absolute ${frame.spin ? "-inset-1/2 motion-safe:animate-spin" : "inset-0"}`}
          style={{ background: frame.background, animationDuration: "8s" }}
        />
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className={`relative size-full border-2 border-ink-900 bg-ink-800 object-cover ${INNER_RADIUS[shape]}`}
        />
      </span>
      {showGem && tier && (
        <span
          aria-hidden="true"
          className={`absolute z-10 grid place-items-center bg-ink-900 border-2 shadow-[1px_1px_0_#000] ${
            shape === "rounded-full" ? "rounded-full" : "rounded-none"
          } ${gemSize === "sm" ? "-bottom-0.5 -left-0.5 size-5" : "-bottom-1 -left-1 size-7"}`}
          style={{ borderColor: tier.color, color: tier.color }}
        >
          <Gem className={gemSize === "sm" ? "size-3" : "size-3.5"} />
        </span>
      )}
    </span>
  );
}

export default function TierAvatar({
  user,
  className,
  showGem = false,
  gemSize
}: {
  user: { avatarUrl: string; contestRating: number | null };
  className?: string;
  showGem?: boolean;
  gemSize?: "sm" | "md";
}) {
  return (
    <FramedAvatar
      src={user.avatarUrl}
      tier={tierOf(user)}
      className={className}
      title={showGem ? tierSummary(user) : undefined}
      showGem={showGem}
      gemSize={gemSize}
    />
  );
}
