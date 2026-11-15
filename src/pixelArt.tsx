import React from "react";

export interface PixelSvgProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
}

/**
 * 16x16 Pixel Trophy
 * Ideal for podiums, leaderboard headers and rankings.
 */
export function PixelTrophy({
  size = 20,
  variant = "gold",
  className = "",
  ...props
}: PixelSvgProps & { variant?: "gold" | "silver" | "bronze" | "teal" | "purple" }) {
  const colors = {
    gold: { main: "#ffb800", dark: "#b45309", light: "#fef08a", rim: "#1a1300" },
    silver: { main: "#94a3b8", dark: "#475569", light: "#f1f5f9", rim: "#0f172a" },
    bronze: { main: "#f97316", dark: "#9a3412", light: "#fed7aa", rim: "#1a0800" },
    teal: { main: "#10b981", dark: "#047857", light: "#6ee7b7", rim: "#022c22" },
    purple: { main: "#a855f7", dark: "#6b21a8", light: "#e9d5ff", rim: "#3b0764" }
  }[variant];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      {/* Top cup rim */}
      <rect x="3" y="1" width="10" height="2" fill={colors.rim} />
      <rect x="4" y="2" width="8" height="1" fill={colors.light} />
      {/* Cup bowl */}
      <rect x="4" y="3" width="8" height="4" fill={colors.main} />
      <rect x="4" y="3" width="2" height="3" fill={colors.light} />
      <rect x="10" y="3" width="2" height="4" fill={colors.dark} />
      {/* Handles */}
      <rect x="2" y="2" width="2" height="1" fill={colors.rim} />
      <rect x="1" y="3" width="2" height="3" fill={colors.main} />
      <rect x="2" y="6" width="2" height="1" fill={colors.rim} />
      <rect x="12" y="2" width="2" height="1" fill={colors.rim} />
      <rect x="13" y="3" width="2" height="3" fill={colors.dark} />
      <rect x="12" y="6" width="2" height="1" fill={colors.rim} />
      {/* Tapered bottom */}
      <rect x="5" y="7" width="6" height="2" fill={colors.main} />
      <rect x="6" y="8" width="4" height="1" fill={colors.dark} />
      {/* Stem */}
      <rect x="7" y="9" width="2" height="3" fill={colors.rim} />
      <rect x="7" y="9" width="1" height="3" fill={colors.main} />
      {/* Base */}
      <rect x="4" y="12" width="8" height="1" fill={colors.rim} />
      <rect x="3" y="13" width="10" height="2" fill={colors.main} />
      <rect x="3" y="13" width="2" height="2" fill={colors.light} />
      <rect x="11" y="13" width="2" height="2" fill={colors.dark} />
      <rect x="2" y="15" width="12" height="1" fill={colors.rim} />
    </svg>
  );
}

/**
 * 16x16 Pixel Crown
 * For #1 Leaderboard spot and top achievements.
 */
export function PixelCrown({ size = 18, className = "", ...props }: PixelSvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      {/* Jewels on peaks */}
      <rect x="1" y="2" width="2" height="2" fill="#f43f5e" />
      <rect x="7" y="0" width="2" height="2" fill="#10b981" />
      <rect x="13" y="2" width="2" height="2" fill="#f43f5e" />
      {/* Crown body */}
      <rect x="1" y="4" width="2" height="6" fill="#fbbf24" />
      <rect x="3" y="6" width="2" height="4" fill="#fbbf24" />
      <rect x="5" y="4" width="2" height="6" fill="#fbbf24" />
      <rect x="7" y="2" width="2" height="8" fill="#fbbf24" />
      <rect x="9" y="4" width="2" height="6" fill="#fbbf24" />
      <rect x="11" y="6" width="2" height="4" fill="#fbbf24" />
      <rect x="13" y="4" width="2" height="6" fill="#fbbf24" />
      {/* Highlights & Shadows */}
      <rect x="7" y="2" width="1" height="8" fill="#fef08a" />
      <rect x="1" y="4" width="1" height="6" fill="#fef08a" />
      <rect x="14" y="4" width="1" height="6" fill="#b45309" />
      <rect x="12" y="6" width="1" height="4" fill="#b45309" />
      {/* Base band */}
      <rect x="1" y="10" width="14" height="4" fill="#b45309" />
      <rect x="2" y="11" width="12" height="2" fill="#fbbf24" />
      {/* Base gems */}
      <rect x="4" y="11" width="2" height="2" fill="#10b981" />
      <rect x="7" y="11" width="2" height="2" fill="#f43f5e" />
      <rect x="10" y="11" width="2" height="2" fill="#06b6d4" />
      {/* Outline bottom */}
      <rect x="1" y="14" width="14" height="1" fill="#78350f" />
    </svg>
  );
}

/**
 * 16x16 Pixel Flame (Hot Streak)
 */
export function PixelFlame({ size = 18, className = "", ...props }: PixelSvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      {/* Outer red flame */}
      <rect x="7" y="1" width="2" height="2" fill="#f43f5e" />
      <rect x="5" y="3" width="5" height="2" fill="#f43f5e" />
      <rect x="4" y="5" width="7" height="3" fill="#f43f5e" />
      <rect x="3" y="8" width="9" height="4" fill="#f43f5e" />
      <rect x="4" y="12" width="7" height="2" fill="#f43f5e" />
      <rect x="6" y="14" width="4" height="1" fill="#f43f5e" />
      {/* Orange core */}
      <rect x="7" y="3" width="2" height="2" fill="#f97316" />
      <rect x="5" y="5" width="5" height="3" fill="#f97316" />
      <rect x="5" y="8" width="5" height="4" fill="#f97316" />
      <rect x="6" y="12" width="3" height="1" fill="#f97316" />
      {/* Yellow inner spark */}
      <rect x="7" y="6" width="2" height="2" fill="#fef08a" />
      <rect x="6" y="8" width="3" height="3" fill="#fef08a" />
      <rect x="7" y="11" width="1" height="1" fill="#ffffff" />
    </svg>
  );
}

/**
 * 16x16 Pixel Crossed Swords (Compare / Head-to-Head Battle)
 */
export function PixelSwords({ size = 18, className = "", ...props }: PixelSvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      {/* Blade 1 (top-left to bottom-right) */}
      <rect x="13" y="1" width="2" height="2" fill="#f8fafc" />
      <rect x="11" y="3" width="2" height="2" fill="#94a3b8" />
      <rect x="9" y="5" width="2" height="2" fill="#94a3b8" />
      <rect x="7" y="7" width="2" height="2" fill="#cbd5e1" />
      <rect x="5" y="9" width="2" height="2" fill="#64748b" />
      {/* Guard 1 */}
      <rect x="3" y="9" width="2" height="2" fill="#fbbf24" />
      <rect x="5" y="11" width="2" height="2" fill="#fbbf24" />
      {/* Hilt 1 */}
      <rect x="3" y="11" width="2" height="2" fill="#b45309" />
      {/* Pommel 1 */}
      <rect x="1" y="13" width="2" height="2" fill="#fbbf24" />

      {/* Blade 2 (top-right to bottom-left) */}
      <rect x="1" y="1" width="2" height="2" fill="#f8fafc" />
      <rect x="3" y="3" width="2" height="2" fill="#94a3b8" />
      <rect x="5" y="5" width="2" height="2" fill="#94a3b8" />
      <rect x="9" y="9" width="2" height="2" fill="#64748b" />
      {/* Guard 2 */}
      <rect x="11" y="9" width="2" height="2" fill="#fbbf24" />
      <rect x="9" y="11" width="2" height="2" fill="#fbbf24" />
      {/* Hilt 2 */}
      <rect x="11" y="11" width="2" height="2" fill="#b45309" />
      {/* Pommel 2 */}
      <rect x="13" y="13" width="2" height="2" fill="#fbbf24" />
    </svg>
  );
}

/**
 * 16x16 Pixel Star
 */
export function PixelStar({
  size = 16,
  color = "#fbbf24",
  className = "",
  ...props
}: PixelSvgProps & { color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      <rect x="7" y="1" width="2" height="2" fill={color} />
      <rect x="6" y="3" width="4" height="2" fill={color} />
      <rect x="1" y="5" width="14" height="2" fill={color} />
      <rect x="3" y="7" width="10" height="2" fill={color} />
      <rect x="4" y="9" width="8" height="2" fill={color} />
      <rect x="3" y="11" width="3" height="2" fill={color} />
      <rect x="10" y="11" width="3" height="2" fill={color} />
      <rect x="2" y="13" width="2" height="2" fill={color} />
      <rect x="12" y="13" width="2" height="2" fill={color} />
      {/* Center highlight */}
      <rect x="7" y="6" width="2" height="2" fill="#ffffff" opacity="0.8" />
    </svg>
  );
}

/**
 * 16x16 Pixel Shield (Admin, Security, Verification)
 */
export function PixelShield({
  size = 18,
  color = "#10b981",
  className = "",
  ...props
}: PixelSvgProps & { color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="2" width="12" height="2" fill={color} />
      <rect x="1" y="4" width="14" height="5" fill={color} />
      <rect x="2" y="9" width="12" height="2" fill={color} />
      <rect x="3" y="11" width="10" height="2" fill={color} />
      <rect x="5" y="13" width="6" height="1" fill={color} />
      <rect x="7" y="14" width="2" height="1" fill={color} />
      {/* Inner emblem */}
      <rect x="7" y="5" width="2" height="4" fill="#ffffff" />
      <rect x="5" y="6" width="6" height="2" fill="#ffffff" />
    </svg>
  );
}

/**
 * 16x16 Pixel Coin
 */
export function PixelCoin({ size = 16, className = "", ...props }: PixelSvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      <rect x="5" y="1" width="6" height="14" fill="#fbbf24" />
      <rect x="3" y="2" width="10" height="12" fill="#fbbf24" />
      <rect x="2" y="3" width="12" height="10" fill="#fbbf24" />
      <rect x="1" y="5" width="14" height="6" fill="#fbbf24" />
      {/* Rim highlight & shadow */}
      <rect x="5" y="2" width="5" height="1" fill="#fef08a" />
      <rect x="2" y="5" width="1" height="5" fill="#fef08a" />
      <rect x="13" y="5" width="1" height="5" fill="#b45309" />
      <rect x="5" y="13" width="5" height="1" fill="#b45309" />
      {/* Center inner mark */}
      <rect x="7" y="5" width="2" height="6" fill="#b45309" />
      <rect x="6" y="5" width="4" height="1" fill="#b45309" />
      <rect x="6" y="10" width="4" height="1" fill="#b45309" />
    </svg>
  );
}

/**
 * 16x16 Pixel Gamepad
 */
export function PixelGamepad({
  size = 18,
  color = "#a855f7",
  className = "",
  ...props
}: PixelSvgProps & { color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="4" width="12" height="8" fill={color} />
      <rect x="1" y="6" width="14" height="6" fill={color} />
      {/* D-pad (left) */}
      <rect x="3" y="7" width="3" height="1" fill="#0f172a" />
      <rect x="4" y="6" width="1" height="3" fill="#0f172a" />
      {/* Buttons (right) */}
      <rect x="10" y="8" width="1" height="1" fill="#f43f5e" />
      <rect x="12" y="8" width="1" height="1" fill="#06b6d4" />
      <rect x="11" y="7" width="1" height="1" fill="#fbbf24" />
      <rect x="11" y="9" width="1" height="1" fill="#10b981" />
      {/* Middle select/start */}
      <rect x="7" y="8" width="2" height="1" fill="#1e293b" />
    </svg>
  );
}

/**
 * 12x12 Pixel Checkmark
 */
export function PixelCheck({ size = 14, className = "", ...props }: PixelSvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      className={`shrink-0 text-emerald-400 ${className}`}
      aria-hidden="true"
      {...props}
    >
      <rect x="1" y="5" width="2" height="2" fill="currentColor" />
      <rect x="3" y="7" width="2" height="2" fill="currentColor" />
      <rect x="5" y="9" width="2" height="2" fill="currentColor" />
      <rect x="7" y="7" width="2" height="2" fill="currentColor" />
      <rect x="9" y="5" width="2" height="2" fill="currentColor" />
      <rect x="10" y="3" width="2" height="2" fill="currentColor" />
    </svg>
  );
}

/**
 * 12x12 Pixel Close / Cross
 */
export function PixelClose({ size = 14, className = "", ...props }: PixelSvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      <rect x="1" y="1" width="2" height="2" fill="currentColor" />
      <rect x="3" y="3" width="2" height="2" fill="currentColor" />
      <rect x="5" y="5" width="2" height="2" fill="currentColor" />
      <rect x="7" y="3" width="2" height="2" fill="currentColor" />
      <rect x="9" y="1" width="2" height="2" fill="currentColor" />
      <rect x="3" y="7" width="2" height="2" fill="currentColor" />
      <rect x="1" y="9" width="2" height="2" fill="currentColor" />
      <rect x="7" y="7" width="2" height="2" fill="currentColor" />
      <rect x="9" y="9" width="2" height="2" fill="currentColor" />
    </svg>
  );
}

/**
 * 12x12 Pixel Arrow (Up, Down, Right, Flat)
 */
export function PixelArrow({
  direction = "up",
  size = 12,
  className = "",
  ...props
}: PixelSvgProps & { direction?: "up" | "down" | "right" | "flat" }) {
  if (direction === "flat") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 12 12"
        shapeRendering="crispEdges"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
        {...props}
      >
        <rect x="2" y="5" width="8" height="2" fill="currentColor" />
      </svg>
    );
  }

  const rotation = direction === "up" ? 0 : direction === "down" ? 180 : 90;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      style={{ transform: `rotate(${rotation}deg)` }}
      aria-hidden="true"
      {...props}
    >
      <rect x="5" y="1" width="2" height="2" fill="currentColor" />
      <rect x="4" y="3" width="4" height="2" fill="currentColor" />
      <rect x="3" y="5" width="6" height="2" fill="currentColor" />
      <rect x="5" y="7" width="2" height="4" fill="currentColor" />
    </svg>
  );
}

/**
 * 16x16 Pixel Skull (for Hard difficulty or Game Over)
 */
export function PixelSkull({
  size = 16,
  color = "#f43f5e",
  className = "",
  ...props
}: PixelSvgProps & { color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      <rect x="5" y="1" width="6" height="2" fill={color} />
      <rect x="3" y="3" width="10" height="6" fill={color} />
      <rect x="2" y="5" width="12" height="4" fill={color} />
      {/* Eye sockets */}
      <rect x="4" y="6" width="2" height="3" fill="#000000" />
      <rect x="10" y="6" width="2" height="3" fill="#000000" />
      {/* Nose */}
      <rect x="7" y="9" width="2" height="1" fill="#000000" />
      {/* Teeth / jaw */}
      <rect x="4" y="11" width="8" height="3" fill={color} />
      <rect x="5" y="12" width="1" height="2" fill="#000000" />
      <rect x="7" y="12" width="2" height="2" fill="#000000" />
      <rect x="10" y="12" width="1" height="2" fill="#000000" />
    </svg>
  );
}

/**
 * Segmented Pixel Progress Bar
 * Renders distinct stepped pixel blocks
 */
export function PixelProgressBar({
  value,
  max,
  segments = 16,
  barColor = "bg-emerald-400",
  emptyColor = "bg-ink-800",
  height = "h-2.5",
  className = "",
  label
}: {
  value: number;
  max: number;
  segments?: number;
  barColor?: string;
  emptyColor?: string;
  height?: string;
  className?: string;
  label?: string;
}) {
  const filled = max > 0 ? Math.min(segments, Math.max(0, Math.round((value / max) * segments))) : 0;

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label ?? `${value} of ${max}`}
      className={`flex w-full gap-[2px] p-[2px] bg-ink-950 border-2 border-ink-700 ${className}`}
    >
      {Array.from({ length: segments }).map((_, i) => (
        <span key={i} className={`flex-1 transition-none ${height} ${i < filled ? barColor : emptyColor}`} />
      ))}
    </div>
  );
}

/**
 * Pixel Difficulty Bar (Easy / Medium / Hard)
 */
export function PixelDifficultyBar({
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
  const totalSolved = easy + medium + hard;

  return (
    <div className="flex w-full flex-col gap-1" role="img" aria-label={`${easy} easy, ${medium} medium, ${hard} hard`}>
      <div
        className={`flex w-full overflow-hidden border-2 border-ink-700 bg-ink-950 p-[1px] shadow-[1px_1px_0_#000] ${size === "lg" ? "h-3.5" : "h-2"}`}
      >
        {totalSolved > 0 ? (
          <div className="flex h-full w-full">
            {easy > 0 && (
              <div
                className="h-full bg-emerald-400 border-r border-ink-950 last:border-r-0 transition-[width] duration-300"
                style={{ width: `${(easy / totalSolved) * 100}%` }}
                title={`${easy} Easy`}
              />
            )}
            {medium > 0 && (
              <div
                className="h-full bg-amber-400 border-r border-ink-950 last:border-r-0 transition-[width] duration-300"
                style={{ width: `${(medium / totalSolved) * 100}%` }}
                title={`${medium} Medium`}
              />
            )}
            {hard > 0 && (
              <div
                className="h-full bg-rose-500 border-r border-ink-950 last:border-r-0 transition-[width] duration-300"
                style={{ width: `${(hard / totalSolved) * 100}%` }}
                title={`${hard} Hard`}
              />
            )}
          </div>
        ) : (
          <div className="h-full w-full bg-ink-800/40" />
        )}
      </div>
      <div
        className={`flex items-center justify-between font-mono font-bold ${size === "lg" ? "text-xs" : "text-[11px]"}`}
      >
        <span className="inline-flex items-center gap-1 text-emerald-400">
          <span className="text-[10px] text-mist-500 font-pixel">E</span> {easy}
        </span>
        <span className="inline-flex items-center gap-1 text-amber-400">
          <span className="text-[10px] text-mist-500 font-pixel">M</span> {medium}
        </span>
        <span className="inline-flex items-center gap-1 text-rose-400">
          <span className="text-[10px] text-mist-500 font-pixel">H</span> {hard}
        </span>
      </div>
    </div>
  );
}

/**
 * Pixel Rank Badge for Leaderboard & Podiums
 * Displays #01, #02, #03, #04+ with distinctive pixel badge treatments
 */
export function PixelRankBadge({ rank, size = "md" }: { rank: number; size?: "sm" | "md" | "lg" }) {
  const formatted = rank < 10 ? `#0${rank}` : `#${rank}`;

  if (rank === 1) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 font-pixel font-bold bg-amber-400/15 text-amber-300 border-2 border-amber-400/80 shadow-[2px_2px_0_#000] ${
          size === "lg" ? "px-3 py-1 text-sm" : size === "md" ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[10px]"
        }`}
      >
        <PixelCrown size={size === "lg" ? 16 : 13} />
        <span>{formatted}</span>
      </div>
    );
  }

  if (rank === 2) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 font-pixel font-bold bg-slate-400/15 text-slate-200 border-2 border-slate-300/70 shadow-[2px_2px_0_#000] ${
          size === "lg" ? "px-3 py-1 text-sm" : size === "md" ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[10px]"
        }`}
      >
        <PixelTrophy variant="silver" size={size === "lg" ? 16 : 13} />
        <span>{formatted}</span>
      </div>
    );
  }

  if (rank === 3) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 font-pixel font-bold bg-orange-400/15 text-orange-300 border-2 border-orange-400/70 shadow-[2px_2px_0_#000] ${
          size === "lg" ? "px-3 py-1 text-sm" : size === "md" ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[10px]"
        }`}
      >
        <PixelTrophy variant="bronze" size={size === "lg" ? 16 : 13} />
        <span>{formatted}</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center font-pixel text-mist-400 bg-ink-800/80 border-2 border-ink-700 ${
        size === "lg" ? "px-2.5 py-1 text-xs" : size === "md" ? "px-1.5 py-0.5 text-[10px]" : "px-1 py-0.5 text-[9px]"
      }`}
    >
      <span>{formatted}</span>
    </div>
  );
}

/**
 * Pixel LED Status Indicator
 */
export function PixelLed({
  status = "online",
  size = 8
}: {
  status?: "online" | "warning" | "error" | "offline";
  size?: number;
}) {
  const bg = {
    online: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]",
    warning: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]",
    error: "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]",
    offline: "bg-mist-500"
  }[status];

  return <span className={`inline-block shrink-0 ${bg}`} style={{ width: size, height: size }} aria-label={status} />;
}

/**
 * 16x16 Pixel Graduation Cap (Academy Mortarboard)
 * Authentic retro RPG guild / academy icon with golden tassel.
 */
export function PixelGraduationCap({
  size = 14,
  variant = "teal",
  className = "",
  ...props
}: PixelSvgProps & { variant?: "teal" | "cyan" | "purple" | "amber" | "rose" | "blue" | "gold" }) {
  const palette = {
    teal: { main: "#10b981", dark: "#047857", light: "#6ee7b7", rim: "#022c22" },
    cyan: { main: "#06b6d4", dark: "#0e7490", light: "#67e8f9", rim: "#083344" },
    purple: { main: "#a855f7", dark: "#6b21a8", light: "#e9d5ff", rim: "#3b0764" },
    amber: { main: "#f59e0b", dark: "#b45309", light: "#fef08a", rim: "#451a03" },
    rose: { main: "#f43f5e", dark: "#be123c", light: "#fda4af", rim: "#4c0519" },
    blue: { main: "#3b82f6", dark: "#1d4ed8", light: "#93c5fd", rim: "#172554" },
    gold: { main: "#fbbf24", dark: "#b45309", light: "#fef08a", rim: "#1a1300" }
  }[variant] ?? { main: "#10b981", dark: "#047857", light: "#6ee7b7", rim: "#022c22" };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      {/* Skullcap (base on head) */}
      <rect x="5" y="7" width="6" height="3" fill={palette.rim} />
      <rect x="6" y="8" width="4" height="2" fill={palette.dark} />
      <rect x="6" y="10" width="4" height="1" fill={palette.rim} />

      {/* Mortarboard board outer rim */}
      <rect x="7" y="1" width="2" height="1" fill={palette.rim} />
      <rect x="5" y="2" width="6" height="1" fill={palette.rim} />
      <rect x="3" y="3" width="10" height="1" fill={palette.rim} />
      <rect x="1" y="4" width="14" height="2" fill={palette.rim} />
      <rect x="3" y="6" width="10" height="1" fill={palette.rim} />
      <rect x="5" y="7" width="6" height="1" fill={palette.rim} />

      {/* Mortarboard board body & highlights */}
      <rect x="7" y="2" width="2" height="1" fill={palette.light} />
      <rect x="5" y="3" width="3" height="1" fill={palette.light} />
      <rect x="3" y="4" width="4" height="1" fill={palette.light} />
      <rect x="2" y="5" width="4" height="1" fill={palette.light} />

      <rect x="8" y="3" width="3" height="1" fill={palette.main} />
      <rect x="7" y="4" width="4" height="1" fill={palette.main} />
      <rect x="6" y="5" width="4" height="1" fill={palette.main} />

      {/* Mortarboard shadow facets */}
      <rect x="11" y="4" width="2" height="1" fill={palette.dark} />
      <rect x="10" y="5" width="3" height="1" fill={palette.dark} />
      <rect x="5" y="6" width="5" height="1" fill={palette.dark} />

      {/* Center button */}
      <rect x="7" y="3" width="2" height="1" fill="#fef08a" />
      <rect x="7" y="4" width="2" height="1" fill="#f59e0b" />

      {/* Tassel cord (running to left) */}
      <rect x="6" y="3" width="1" height="1" fill="#fbbf24" />
      <rect x="5" y="4" width="1" height="1" fill="#fbbf24" />
      <rect x="4" y="5" width="1" height="1" fill="#f59e0b" />
      <rect x="3" y="6" width="1" height="1" fill="#f59e0b" />
      <rect x="2" y="7" width="1" height="1" fill="#f59e0b" />

      {/* Dangling tassel bobble & fringe */}
      <rect x="1" y="8" width="2" height="3" fill="#fbbf24" />
      <rect x="1" y="8" width="1" height="2" fill="#fef08a" />
      <rect x="2" y="9" width="1" height="2" fill="#b45309" />
      <rect x="1" y="11" width="2" height="1" fill="#d97706" />
    </svg>
  );
}

/**
 * Pixel Badge (HUD pill / chip)
 */
export function PixelBadge({
  children,
  variant = "neutral",
  size = "sm",
  className = ""
}: {
  children: React.ReactNode;
  variant?: "neutral" | "green" | "purple" | "amber" | "blue" | "red";
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const styles = {
    neutral: "bg-ink-800 text-mist-100 border-ink-700",
    green: "bg-emerald-950/60 text-emerald-300 border-emerald-500/50",
    purple: "bg-purple-950/60 text-purple-300 border-purple-500/50",
    amber: "bg-amber-950/60 text-amber-300 border-amber-500/50",
    blue: "bg-sky-950/60 text-sky-300 border-sky-500/50",
    red: "bg-rose-950/60 text-rose-300 border-rose-500/50"
  }[variant];

  const sizeCls = {
    xs: "px-1.5 py-0.5 text-[10px]",
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-xs"
  }[size];

  return (
    <span
      className={`inline-flex items-center gap-1 font-pixel uppercase tracking-wider border-2 ${styles} ${sizeCls} ${className}`}
    >
      {children}
    </span>
  );
}
