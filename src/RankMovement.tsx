import React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { Movement } from "./movement.js";

const places = (n: number) => `${n} ${n === 1 ? "place" : "places"}`;

// Tiny indicator shown under a member's rank number: up/down arrows with how
// many places, a dash for "unchanged", or a NEW tag for this week's joiners.
export default function RankMovement({ movement }: { movement?: Movement }) {
  if (!movement) return null;

  if (movement.kind === "new") {
    return (
      <span
        title="Joined in the last 7 days"
        className="rounded bg-teal-400/10 px-1 py-px text-[9px] font-semibold uppercase leading-tight tracking-wide text-teal-300"
      >
        New
      </span>
    );
  }

  if (movement.kind === "same") {
    return (
      <span title="Same position as a week ago" className="text-mist-500">
        <Minus className="size-3" aria-hidden="true" />
        <span className="sr-only">No change since last week</span>
      </span>
    );
  }

  const up = movement.kind === "up";
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      title={`${up ? "Up" : "Down"} ${places(movement.places)} compared with a week ago`}
      className={`inline-flex items-center text-[11px] font-semibold leading-none tabular-nums ${
        up ? "text-emerald-400" : "text-rose-400"
      }`}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span aria-hidden="true">{movement.places}</span>
      <span className="sr-only">
        {up ? "Up" : "Down"} {places(movement.places)} since last week
      </span>
    </span>
  );
}
