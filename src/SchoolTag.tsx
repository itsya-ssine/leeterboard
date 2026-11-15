import React from "react";
import { PixelGraduationCap } from "./pixelArt.js";

export type SchoolThemeVariant = "teal" | "cyan" | "purple" | "amber" | "rose" | "blue" | "neutral";

export interface SchoolTagProps {
  school?: string;
  className?: string;
  variant?: SchoolThemeVariant;
  size?: "sm" | "md";
  showIcon?: boolean;
}

const VARIANTS: readonly ("teal" | "cyan" | "purple" | "amber" | "rose" | "blue")[] = [
  "teal",
  "cyan",
  "purple",
  "amber",
  "rose",
  "blue"
] as const;

/**
 * Deterministically picks a retro RPG guild theme for a school name,
 * ensuring students from the same school share an identical visual guild badge.
 */
export function getSchoolVariant(name: string): "teal" | "cyan" | "purple" | "amber" | "rose" | "blue" {
  let hash = 0;
  const normalized = name.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % VARIANTS.length;
  return VARIANTS[index];
}

const THEMES: Record<
  "teal" | "cyan" | "purple" | "amber" | "rose" | "blue" | "neutral",
  {
    border: string;
    bg: string;
    text: string;
    bracket: string;
    shadow: string;
    glow: string;
  }
> = {
  teal: {
    border: "border-emerald-500/60",
    bg: "bg-emerald-950/80",
    text: "text-emerald-300",
    bracket: "text-emerald-400/60",
    shadow: "shadow-[2px_2px_0_#022c22]",
    glow: "hover:shadow-[0_0_8px_rgba(16,185,129,0.4)]"
  },
  cyan: {
    border: "border-cyan-500/60",
    bg: "bg-cyan-950/80",
    text: "text-cyan-300",
    bracket: "text-cyan-400/60",
    shadow: "shadow-[2px_2px_0_#083344]",
    glow: "hover:shadow-[0_0_8px_rgba(6,182,212,0.4)]"
  },
  purple: {
    border: "border-purple-500/60",
    bg: "bg-purple-950/80",
    text: "text-purple-300",
    bracket: "text-purple-400/60",
    shadow: "shadow-[2px_2px_0_#2e1065]",
    glow: "hover:shadow-[0_0_8px_rgba(168,85,247,0.4)]"
  },
  amber: {
    border: "border-amber-500/60",
    bg: "bg-amber-950/80",
    text: "text-amber-300",
    bracket: "text-amber-400/60",
    shadow: "shadow-[2px_2px_0_#451a03]",
    glow: "hover:shadow-[0_0_8px_rgba(245,158,11,0.4)]"
  },
  rose: {
    border: "border-rose-500/60",
    bg: "bg-rose-950/80",
    text: "text-rose-300",
    bracket: "text-rose-400/60",
    shadow: "shadow-[2px_2px_0_#4c0519]",
    glow: "hover:shadow-[0_0_8px_rgba(244,63,94,0.4)]"
  },
  blue: {
    border: "border-sky-500/60",
    bg: "bg-sky-950/80",
    text: "text-sky-300",
    bracket: "text-sky-400/60",
    shadow: "shadow-[2px_2px_0_#082f49]",
    glow: "hover:shadow-[0_0_8px_rgba(56,189,248,0.4)]"
  },
  neutral: {
    border: "border-ink-700",
    bg: "bg-ink-900/90",
    text: "text-mist-200",
    bracket: "text-mist-500",
    shadow: "shadow-[2px_2px_0_#000000]",
    glow: "hover:shadow-[0_0_8px_rgba(148,163,184,0.3)]"
  }
};

/**
 * Creative Pixel-Art School / Academy Guild Tag.
 * Renders an authentic 8-bit RPG guild badge with a custom pixel graduation
 * mortarboard, deterministic school color themes, tactile micro-interactions,
 * and crisp pixel typography.
 */
export default function SchoolTag({ school, className = "", variant, size = "sm", showIcon = true }: SchoolTagProps) {
  const name = school?.trim();
  if (!name) return null;

  const resolvedVariant = variant ?? getSchoolVariant(name);
  const theme = THEMES[resolvedVariant];
  const capVariant = resolvedVariant === "neutral" ? "teal" : resolvedVariant;

  const sizeStyles = size === "md" ? "px-2 py-0.5 text-[10px] gap-1.5 h-6" : "px-1.5 py-0.5 text-[9px] gap-1 h-[19px]";

  const iconSize = size === "md" ? 14 : 12;

  return (
    <span
      title={`School / Academy: ${name}`}
      className={`group/school inline-flex min-w-0 max-w-full shrink-0 items-center border-2 leading-none font-pixel uppercase tracking-wider ${theme.border} ${theme.bg} ${theme.text} ${theme.shadow} ${theme.glow} ${sizeStyles} transition-all duration-150 hover:brightness-110 active:translate-x-[1px] active:translate-y-[1px] select-none ${className}`}
    >
      <span
        aria-hidden="true"
        className={`select-none font-pixel text-[8px] opacity-40 transition-opacity group-hover/school:opacity-80 ${theme.bracket}`}
      >
        [
      </span>

      {showIcon && (
        <PixelGraduationCap
          size={iconSize}
          variant={capVariant}
          className="shrink-0 transition-transform duration-150 group-hover/school:rotate-[-6deg] group-hover/school:scale-110"
        />
      )}

      <span className="truncate font-pixel font-bold">{name}</span>

      <span
        aria-hidden="true"
        className={`select-none font-pixel text-[8px] opacity-40 transition-opacity group-hover/school:opacity-80 ${theme.bracket}`}
      >
        ]
      </span>
    </span>
  );
}
