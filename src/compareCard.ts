// Draws a head-to-head compare card (two members, side by side) onto a <canvas>
// and returns it as a PNG. Same approach as shareCard.ts: drawn by hand so it
// needs no dependency and looks the same on every device and site theme. The
// drawing helpers and palettes are shared with the member share card.

import { barShare, type CompareRow } from "./compare.js";
import {
  CARD_SIZES,
  LOGO_FONT,
  PALETTES,
  drawText,
  loadAvatar,
  roundedRect,
  type CardFormat,
  type CardTheme,
  type Palette
} from "./shareCard.js";

export interface CompareCardMember {
  displayName: string;
  leetcodeUsername: string;
  avatarUrl: string;
}

export interface CompareCardData {
  a: CompareCardMember;
  b: CompareCardMember;
  // Every compared stat; the card picks the ones that fit its shape.
  rows: CompareRow[];
  // How many stats each member is ahead in (over all rows, not just the drawn ones).
  leadsA: number;
  leadsB: number;
  // Shown in the footer, e.g. "leeterboard.vercel.app".
  host: string;
}

// Which stats each shape has room for, in drawing order.
const ROW_IDS: Record<CardFormat, string[]> = {
  wide: ["solved", "weekly", "streak", "rating", "hard"],
  square: ["solved", "easy", "medium", "hard", "weekly", "monthly", "rating", "streak"]
};

function formatValue(v: number | null, format: CompareRow["format"]): string {
  if (v == null) return "–";
  if (format === "plus") return `+${v.toLocaleString("en-US")}`;
  if (format === "days") return `${v.toLocaleString("en-US")} ${v === 1 ? "day" : "days"}`;
  return v.toLocaleString("en-US");
}

function drawRingAvatar(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  initial: string,
  cx: number,
  cy: number,
  r: number,
  ring: string,
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
    ctx.fillStyle = ring;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    drawText(ctx, initial, cx, cy + r * 0.34, { size: r, weight: 700, color: p.bg, align: "center" });
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = ring;
  ctx.stroke();
}

export async function renderCompareCard(data: CompareCardData, format: CardFormat, theme: CardTheme): Promise<Blob> {
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

  const [imgA, imgB] = await Promise.all([loadAvatar(data.a.avatarUrl), loadAvatar(data.b.avatarUrl)]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't draw the card.");

  // Member A is teal and member B amber, like on the compare page.
  const colorA = p.accent;
  const colorB = p.gold;

  const padX = square ? 72 : 64;
  const innerW = W - padX * 2;

  // Background: flat colour with a soft glow behind each member.
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(W * 0.22, H * 0.14, W * 0.55, p.glowA);
  glow(W * 0.78, H * 0.14, W * 0.55, p.glowB);

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

  /* The two members */
  const cxA = W * (square ? 0.26 : 0.25);
  const cxB = W - cxA;
  const cy = square ? 250 : 178;
  const r = square ? 80 : 50;
  const nameMax = square ? 440 : 420;

  const initial = (m: CompareCardMember) => (m.displayName || m.leetcodeUsername).trim().charAt(0).toUpperCase() || "?";
  drawRingAvatar(ctx, imgA, initial(data.a), cxA, cy, r, colorA, p);
  drawRingAvatar(ctx, imgB, initial(data.b), cxB, cy, r, colorB, p);

  const nameY = cy + r + (square ? 58 : 46);
  for (const [m, cx] of [
    [data.a, cxA],
    [data.b, cxB]
  ] as const) {
    drawText(ctx, m.displayName, cx, nameY, {
      size: square ? 40 : 32,
      weight: 700,
      color: p.strong,
      align: "center",
      maxWidth: nameMax
    });
    drawText(ctx, `@${m.leetcodeUsername}`, cx, nameY + (square ? 36 : 30), {
      size: square ? 24 : 20,
      weight: 500,
      color: p.muted,
      align: "center",
      maxWidth: nameMax
    });
  }

  /* Centre: VS and the score (how many stats each is ahead in) */
  const mid = W / 2;
  drawText(ctx, "VS", mid, cy - (square ? 36 : 34), {
    size: square ? 24 : 20,
    weight: 700,
    color: p.muted,
    align: "center"
  });
  const scoreSize = square ? 64 : 46;
  const scoreY = cy + (square ? 32 : 14);
  const scoreGap = square ? 30 : 22;
  drawText(ctx, String(data.leadsA), mid - scoreGap, scoreY, { size: scoreSize, weight: 700, color: colorA, align: "right" });
  drawText(ctx, "–", mid, scoreY - scoreSize * 0.1, { size: scoreSize * 0.6, weight: 500, color: p.muted, align: "center" });
  drawText(ctx, String(data.leadsB), mid + scoreGap, scoreY, { size: scoreSize, weight: 700, color: colorB, align: "left" });
  drawText(ctx, "stats ahead", mid, scoreY + (square ? 36 : 26), {
    size: square ? 20 : 16,
    weight: 500,
    color: p.muted,
    align: "center"
  });

  /* Footer position (the stat rows fill the space above it) */
  const footerY = square ? 1032 : 590;

  /* Stat rows */
  const ids = ROW_IDS[format];
  const rows = ids.flatMap((id) => data.rows.filter((row) => row.id === id));
  const rowsTop = nameY + (square ? 64 : 48);
  const rowsBottom = footerY - 50;
  const rowH = (rowsBottom - rowsTop) / Math.max(1, rows.length);
  const valueSize = square ? 34 : 28;
  const labelSize = square ? 22 : 19;
  const barW = square ? 340 : 280;
  const barH = square ? 8 : 6;

  rows.forEach((row, i) => {
    const y = rowsTop + i * rowH;
    const base = y + rowH * 0.6;

    drawText(ctx, row.label, mid, base, { size: labelSize, weight: 500, color: p.muted, align: "center" });

    for (const [side, cx, color] of [
      ["a", cxA, colorA],
      ["b", cxB, colorB]
    ] as const) {
      const leads = row.leader === side;
      drawText(ctx, formatValue(row[side], row.format), cx, base, {
        size: valueSize,
        weight: leads ? 700 : 600,
        color: leads ? color : row.leader ? p.muted : p.text,
        align: "center",
        maxWidth: nameMax
      });
    }

    // Share bar between the two, like the compare page.
    const bx = mid - barW / 2;
    const by = y + rowH * 0.76;
    roundedRect(ctx, bx, by, barW, barH, barH / 2);
    ctx.fillStyle = p.track;
    ctx.fill();
    const share = barShare(row);
    if (share != null) {
      ctx.save();
      roundedRect(ctx, bx, by, barW, barH, barH / 2);
      ctx.clip();
      ctx.fillStyle = colorA;
      ctx.globalAlpha = row.leader === "a" ? 1 : 0.45;
      ctx.fillRect(bx, by, barW * share, barH);
      ctx.fillStyle = colorB;
      ctx.globalAlpha = row.leader === "b" ? 1 : 0.45;
      ctx.fillRect(bx + barW * share, by, barW * (1 - share), barH);
      ctx.restore();
    }
  });

  /* Footer */
  ctx.fillStyle = p.line;
  ctx.fillRect(padX, footerY - 38, innerW, 2);
  drawText(ctx, data.host, padX, footerY, { size: 24, weight: 500, color: p.muted, maxWidth: innerW * 0.4 });

  const hi = Math.max(data.leadsA, data.leadsB);
  const lo = Math.min(data.leadsA, data.leadsB);
  const leaderName = (data.leadsA > data.leadsB ? data.a : data.b).displayName;
  const shortName = leaderName.length > 18 ? `${leaderName.slice(0, 17).trimEnd()}…` : leaderName;
  const verdict = data.leadsA === data.leadsB ? "Dead even" : `${shortName} leads ${hi}–${lo}`;
  drawText(ctx, verdict, W - padX, footerY, {
    size: 24,
    weight: 600,
    color: data.leadsA === data.leadsB ? p.muted : data.leadsA > data.leadsB ? colorA : colorB,
    align: "right",
    maxWidth: innerW * 0.55
  });

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't create the image."))),
      "image/png"
    );
  });
}
