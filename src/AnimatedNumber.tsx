import React, { useEffect, useRef, useState } from "react";

const DURATION_MS = 700;

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Counts a whole number up from zero (and between values on later changes).
// Takes the already-formatted text the page was going to show, e.g. "1,234" or
// "+12". Anything that isn't a plain integer in that form (names, "N/A",
// decimals) is shown as is, so it is safe to wrap any stat value.
export default function AnimatedNumber({ value }: { value: string | number }) {
  const text = String(value);
  const match = /^([+-]?)(\d[\d.,\s\u00a0\u202f]*)$/.exec(text);
  const sign = match?.[1] ?? "";
  const target = match ? Number(match[2].replace(/\D/g, "")) : NaN;
  // Only animate when re-formatting the number gives back the exact same text.
  const animatable = match !== null && Number.isFinite(target) && text === `${sign}${target.toLocaleString()}`;

  const [shown, setShown] = useState(() => (animatable && !reducedMotion() ? 0 : target));
  const from = useRef(shown);

  useEffect(() => {
    if (!animatable) return;
    if (reducedMotion()) {
      setShown(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(origin + (target - origin) * eased);
      setShown(current);
      from.current = current;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animatable, target]);

  if (!animatable) return <>{text}</>;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{`${sign}${shown.toLocaleString()}`}</span>
    </>
  );
}
