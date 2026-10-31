import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import Landing from "./Landing.js";
import { hasEntered, markEntered, sessionStore } from "./gate.js";

// Shows ONLY the landing page until the visitor enters; the app isn't even
// rendered before that. After the landing page's wipe, a curtain of the same
// colour fades out so the hand-over to the app isn't a hard cut.
export default function Gate({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(() => hasEntered(sessionStore()));
  const [curtain, setCurtain] = useState(false);

  if (!entered) {
    return (
      <Landing
        onEnter={(animated) => {
          markEntered(sessionStore());
          setCurtain(animated);
          setEntered(true);
        }}
      />
    );
  }

  return (
    <>
      {children}
      {curtain && (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[60] bg-gradient-to-br from-[#2dd4bf] via-[#38bdf8] to-[#a78bfa]"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          onAnimationComplete={() => setCurtain(false)}
        />
      )}
    </>
  );
}
