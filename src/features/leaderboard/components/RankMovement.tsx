import React from "react";
import type { Movement } from "../utils/movement.js";
import { PixelArrow } from "../../../pixelArt.js";

const places = (n: number) => `${n} ${n === 1 ? "place" : "places"}`;

// Small indicator shown next to a member's name: ▲/▼ with how many places they
// moved since a week ago, or a NEW tag for this week's joiners. Members whose
// position hasn't changed show nothing, so the board stays quiet.
export default function RankMovement({ movement }: { movement?: Movement }) {
  if (!movement || movement.kind === "same") return null;

  if (movement.kind === "new") {
    return (
      <span
        title="Joined in the last 7 days"
        className="shrink-0 font-pixel text-[8px] uppercase tracking-wider bg-emerald-950/70 text-emerald-300 border border-emerald-500/60 px-1.5 py-0.5 shadow-[1px_1px_0_#000]"
      >
        New
      </span>
    );
  }

  const up = movement.kind === "up";
  return (
    <span
      title={`${up ? "Up" : "Down"} ${places(movement.places)} compared with a week ago`}
      className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-mono font-bold leading-none tabular-nums px-1 py-0.5 border ${
        up
          ? "text-emerald-400 bg-emerald-950/40 border-emerald-500/30"
          : "text-rose-400 bg-rose-950/40 border-rose-500/30"
      }`}
    >
      <PixelArrow direction={up ? "up" : "down"} size={10} className={up ? "text-emerald-400" : "text-rose-400"} />
      <span aria-hidden="true">{movement.places}</span>
      <span className="sr-only">
        {up ? "Up" : "Down"} {places(movement.places)} since last week
      </span>
    </span>
  );
}
