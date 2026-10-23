// Draws a member's share card onto a <canvas> and returns it as a PNG.
//
// It is drawn by hand (rather than screenshotting the page) so it needs no
// extra dependency, looks the same on every device, and does not depend on the
// current site theme. The one thing that can go wrong is the avatar: LeetCode's
// image host may not allow cross-origin use, and a canvas that has drawn such an
// image can't be exported. So the avatar is only drawn if it loaded with CORS
// approval; otherwise the member's initial is drawn instead.

export type CardFormat = "wide" | "square";
export type CardTheme = "dark" | "light";

export interface CardData {
  displayName: string;
  leetcodeUsername: string;
  avatarUrl: string;
  school: string;
  rank: number | null;
  rankOf: number;
  topPercent: number | null;
  allTimeSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  weeklyProgress: number;
  currentStreak: number | null;
  contestRating: number | null;
  badgesEarned: number;
  // Shown in the footer, e.g. "leeterboard.vercel.app".
  host: string;
}

export const CARD_SIZES: Record<CardFormat, { w: number; h: number }> = {
  wide: { w: 1200, h: 630 }, // LinkedIn / link-preview shape
  square: { w: 1080, h: 1080 } // feeds and chats
};

interface Palette {
  bg: string;
  glowA: string;
  glowB: string;
  panel: string;
  line: string;
  strong: string;
  text: string;
  muted: string;
  accent: string;
  gold: string;
  silver: string;
  bronze: string;
  easy: string;
  medium: string;
  hard: string;
  track: string;
}

const PALETTES: Record<CardTheme, Palette> = {
  dark: {
    bg: "#0a0d12",
    glowA: "rgba(45, 212, 191, 0.22)",
    glowB: "rgba(251, 191, 36, 0.12)",
    panel: "#10141b",
    line: "rgba(255, 255, 255, 0.10)",
    strong: "#ffffff",
    text: "#e8ebf1",
    muted: "#8a94a6",
    accent: "#2dd4bf",
    gold: "#fcd34d",
    silver: "#cbd5e1",
    bronze: "#fdba74",
    easy: "#10b981",
    medium: "#f59e0b",
    hard: "#ef4444",
    track: "rgba(255, 255, 255, 0.08)"
  },
  light: {
    bg: "#f4f6f9",
    glowA: "rgba(15, 118, 110, 0.16)",
    glowB: "rgba(217, 119, 6, 0.10)",
    panel: "#ffffff",
    line: "rgba(15, 23, 42, 0.12)",
    strong: "#0b1220",
    text: "#0f172a",
    muted: "#596275",
    accent: "#0f766e",
    gold: "#b45309",
    silver: "#475569",
    bronze: "#c2410c",
    easy: "#047857",
    medium: "#d97706",
    hard: "#be123c",
    track: "rgba(15, 23, 42, 0.08)"
  }
};

const FONT = `"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;
const LOGO_FONT = `"Space Grotesk", ${FONT}`;

/* ---------- Small canvas helpers ---------- */

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

interface TextOpts {
  size: number;
  weight?: number;
  color: string;
  align?: CanvasTextAlign;
  maxWidth?: number;
  font?: string;
}

// Draws one line of text, trimming it with an ellipsis if it is wider than
// maxWidth. Returns the width actually drawn.
function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOpts): number {
  ctx.font = `${o.weight ?? 500} ${o.size}px ${o.font ?? FONT}`;
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  let out = text;
  if (o.maxWidth != null && ctx.measureText(out).width > o.maxWidth) {
    while (out.length > 1 && ctx.measureText(`${out}…`).width > o.maxWidth) out = out.slice(0, -1);
    out = `${out.trimEnd()}…`;
  }
  ctx.fillText(out, x, y);
  return ctx.measureText(out).width;
}

function measure(ctx: CanvasRenderingContext2D, text: string, size: number, weight = 500, font = FONT): number {
  ctx.font = `${weight} ${size}px ${font}`;
  return ctx.measureText(text).width;
}

function loadAvatar(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    // Without CORS approval the canvas could not be exported, so ask for it
    // and fall back to the initial if the host says no.
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    const timer = window.setTimeout(() => resolve(null), 6000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  initial: string,
  cx: number,
  cy: number,
  r: number,
  p: Palette
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = p.accent;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    drawText(ctx, initial, cx, cy + r * 0.34, {
      size: r * 1.0,
      weight: 700,
      color: p.bg,
      align: "center"
    });
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = p.accent;
  ctx.stroke();
}

function rankColor(rank: number | null, p: Palette): string {
  if (rank === 1) return p.gold;
  if (rank === 2) return p.silver;
  if (rank === 3) return p.bronze;
  return p.strong;
}

// A rounded pill with text; returns its width so pills can be placed in a row.
function drawPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number, // top
  size: number,
  fill: string,
  stroke: string,
  color: string,
  maxWidth: number
): number {
  const padX = size * 0.8;
  const h = size * 1.9;
  const textMax = maxWidth - padX * 2;
  ctx.font = `600 ${size}px ${FONT}`;
  let label = text;
  if (ctx.measureText(label).width > textMax) {
    while (label.length > 1 && ctx.measureText(`${label}…`).width > textMax) label = label.slice(0, -1);
    label = `${label.trimEnd()}…`;
  }
  const w = ctx.measureText(label).width + padX * 2;
  roundedRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  drawText(ctx, label, x + padX, y + h / 2 + size * 0.35, { size, weight: 600, color });
  return w;
}

/* ---------- The card ---------- */

export async function renderShareCard(data: CardData, format: CardFormat, theme: CardTheme): Promise<Blob> {
  const p = PALETTES[theme];
  const { w: W, h: H } = CARD_SIZES[format];
  const square = format === "square";

  // Best effort: make sure the site fonts are ready so the card matches the app.
  try {
    await Promise.all([
      document.fonts.load(`600 40px "Geist"`),
      document.fonts.load(`700 40px "Geist"`),
      document.fonts.load(`700 40px "Space Grotesk"`)
    ]);
  } catch {
    // System fonts are fine.
  }

  const avatar = await loadAvatar(data.avatarUrl);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't draw the card.");

  const padX = square ? 72 : 64;
  const innerW = W - padX * 2;

  // Background: flat colour with two soft glows.
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(W * 0.12, H * 0.05, W * 0.6, p.glowA);
  glow(W * 0.95, H * 0.95, W * 0.55, p.glowB);

  // Frame
  roundedRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.lineWidth = 2;
  ctx.strokeStyle = p.line;
  ctx.stroke();

  /* Header: wordmark + date */
  const headerY = square ? 96 : 92;
  drawText(ctx, "Leeterboard", padX, headerY, { size: 34, weight: 700, color: p.accent, font: LOGO_FONT });
  drawText(
    ctx,
    new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    W - padX,
    headerY,
    { size: 24, weight: 500, color: p.muted, align: "right" }
  );

  const initial = (data.displayName || data.leetcodeUsername).trim().charAt(0).toUpperCase() || "?";
  const rankText = data.rank != null ? `#${data.rank}` : "–";
  const rankFill = rankColor(data.rank, p);

  let tilesY: number;
  let tileH: number;
  let barY: number;
  let legendY: number;
  let footerY: number;

  if (!square) {
    /* Wide: identity on the left, rank on the right */
    const cy = 190;
    drawAvatar(ctx, avatar, initial, padX + 64, cy, 62, p);

    const textX = padX + 64 + 62 + 30;
    const rankBlockW = 250;
    const nameMax = W - padX - rankBlockW - 24 - textX;
    drawText(ctx, data.displayName, textX, cy - 8, { size: 46, weight: 700, color: p.strong, maxWidth: nameMax });
    drawText(ctx, `@${data.leetcodeUsername}`, textX, cy + 30, {
      size: 26,
      weight: 500,
      color: p.muted,
      maxWidth: nameMax
    });
    if (data.school) {
      drawPill(ctx, data.school, textX, cy + 48, 21, "rgba(45, 212, 191, 0.12)", "rgba(45, 212, 191, 0.35)", p.accent, nameMax);
    }

    // Rank (right-aligned)
    const rx = W - padX;
    drawText(ctx, rankText, rx, cy + 14, { size: 112, weight: 700, color: rankFill, align: "right" });
    const sub =
      data.rank != null
        ? `of ${data.rankOf} members${data.topPercent != null && data.rankOf > 1 ? ` · Top ${data.topPercent}%` : ""}`
        : "Not ranked yet";
    drawText(ctx, sub, rx, cy + 52, { size: 24, weight: 500, color: p.muted, align: "right" });

    tilesY = 318;
    tileH = 128;
    barY = 488;
    legendY = 538;
    footerY = 588;
  } else {
    /* Square: everything centred */
    const cx = W / 2;
    drawAvatar(ctx, avatar, initial, cx, 250, 100, p);
    drawText(ctx, data.displayName, cx, 424, { size: 60, weight: 700, color: p.strong, align: "center", maxWidth: innerW });
    drawText(ctx, `@${data.leetcodeUsername}`, cx, 470, {
      size: 30,
      weight: 500,
      color: p.muted,
      align: "center",
      maxWidth: innerW
    });
    if (data.school) {
      // Centre the pill: measure first.
      const size = 24;
      const natural = measure(ctx, data.school, size, 600) + size * 1.6;
      const pillW = Math.min(natural, innerW);
      drawPill(
        ctx,
        data.school,
        cx - pillW / 2,
        492,
        size,
        "rgba(45, 212, 191, 0.12)",
        "rgba(45, 212, 191, 0.35)",
        p.accent,
        innerW
      );
    }

    drawText(ctx, rankText, cx, 668, { size: 132, weight: 700, color: rankFill, align: "center" });
    const sub =
      data.rank != null
        ? `of ${data.rankOf} members${data.topPercent != null && data.rankOf > 1 ? ` · Top ${data.topPercent}%` : ""}`
        : "Not ranked yet";
    drawText(ctx, sub, cx, 716, { size: 28, weight: 500, color: p.muted, align: "center" });

    tilesY = 760;
    tileH = 124;
    barY = 922;
    legendY = 976;
    footerY = 1032;
  }

  /* Stat tiles */
  const tiles: { value: string; label: string; color: string }[] = [
    { value: data.allTimeSolved.toLocaleString("en-US"), label: "Solved", color: p.strong },
    { value: `+${data.weeklyProgress}`, label: "This week", color: p.accent },
    {
      value: data.currentStreak != null ? String(data.currentStreak) : "–",
      label: "Day streak",
      color: (data.currentStreak ?? 0) > 0 ? p.medium : p.strong
    },
    {
      value: data.contestRating != null ? data.contestRating.toLocaleString("en-US") : "Unrated",
      label: "Contest rating",
      color: p.strong
    }
  ];
  const gap = square ? 16 : 22;
  const tileW = (innerW - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = padX + i * (tileW + gap);
    roundedRect(ctx, x, tilesY, tileW, tileH, 20);
    ctx.fillStyle = p.panel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.line;
    ctx.stroke();
    const valueSize = t.value.length > 7 ? (square ? 30 : 36) : square ? 44 : 54;
    drawText(ctx, t.value, x + tileW / 2, tilesY + tileH * 0.52, {
      size: valueSize,
      weight: 700,
      color: t.color,
      align: "center",
      maxWidth: tileW - 20
    });
    drawText(ctx, t.label, x + tileW / 2, tilesY + tileH * 0.84, {
      size: square ? 20 : 22,
      weight: 500,
      color: p.muted,
      align: "center"
    });
  });

  /* Difficulty bar */
  const barH = 16;
  const total = data.easySolved + data.mediumSolved + data.hardSolved;
  roundedRect(ctx, padX, barY, innerW, barH, barH / 2);
  ctx.fillStyle = p.track;
  ctx.fill();
  if (total > 0) {
    ctx.save();
    roundedRect(ctx, padX, barY, innerW, barH, barH / 2);
    ctx.clip();
    let x = padX;
    for (const [n, color] of [
      [data.easySolved, p.easy],
      [data.mediumSolved, p.medium],
      [data.hardSolved, p.hard]
    ] as const) {
      const segW = (n / total) * innerW;
      ctx.fillStyle = color;
      ctx.fillRect(x, barY, segW, barH);
      x += segW;
    }
    ctx.restore();
  }

  // Legend: three evenly spaced entries
  const legend: [string, number, string][] = [
    ["Easy", data.easySolved, p.easy],
    ["Medium", data.mediumSolved, p.medium],
    ["Hard", data.hardSolved, p.hard]
  ];
  const colW = innerW / 3;
  legend.forEach(([label, n, color], i) => {
    const x = padX + i * colW;
    ctx.beginPath();
    ctx.arc(x + 8, legendY - 8, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    const used = drawText(ctx, String(n), x + 26, legendY, { size: 28, weight: 700, color: p.strong });
    drawText(ctx, label, x + 26 + used + 10, legendY, { size: 22, weight: 500, color: p.muted });
  });

  /* Footer */
  ctx.fillStyle = p.line;
  ctx.fillRect(padX, footerY - 38, innerW, 2);
  drawText(ctx, data.host, padX, footerY, { size: 24, weight: 500, color: p.muted, maxWidth: innerW * 0.6 });
  if (data.badgesEarned > 0) {
    drawText(ctx, `${data.badgesEarned} ${data.badgesEarned === 1 ? "badge" : "badges"} earned`, W - padX, footerY, {
      size: 24,
      weight: 600,
      color: p.accent,
      align: "right"
    });
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't create the image."))),
      "image/png"
    );
  });
}
