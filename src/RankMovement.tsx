import React from "react";
import type { Movement } from "./movement.js";

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
        className="shrink-0 rounded bg-teal-400/10 px-1 py-px text-[9px] font-semibold uppercase leading-tight tracking-wide text-teal-300"
      >
        New
      </span>
    );
  }

  const up = movement.kind === "up";
  return (
    <span
      title={`${up ? "Up" : "Down"} ${places(movement.places)} compared with a week ago`}
      className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold leading-none tabular-nums ${
        up ? "text-emerald-400" : "text-rose-400"
      }`}
    >
      <span aria-hidden="true" className="text-[8px]">
        {up ? "\u25B2" : "\u25BC"}
      </span>
      <span aria-hidden="true">{movement.places}</span>
      <span className="sr-only">
        {up ? "Up" : "Down"} {places(movement.places)} since last week
      </span>
    </span>
  );
}
