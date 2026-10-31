import { useEffect, useRef } from "react";
import { ArrowRight, Flame, Trophy, Users } from "lucide-react";
import { FaGithub } from "react-icons/fa";

// The landing page is always dark, whatever theme the app uses, so it uses
// fixed colours instead of the theme tokens.
const ACCENT = "from-[#2dd4bf] via-[#38bdf8] to-[#a78bfa]";

const HIGHLIGHTS = [
  { icon: Trophy, title: "Weekly rankings", text: "A fresh round every Monday, with a podium and a hall of fame." },
  { icon: Flame, title: "Streaks and badges", text: "Track consistency, contest ratings and milestones over time." },
  { icon: Users, title: "Head-to-head", text: "Compare any two members across LeetCode, Codeforces and CodinGame." }
];

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5eead4]";

export default function Landing({ onEnter }: { onEnter: (animated: boolean) => void }) {
  const entered = useRef(false);

  const enter = () => {
    if (entered.current) return;
    entered.current = true;
    onEnter(false);
  };

  // Enter or Space also opens the board, unless a link or button has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if ((e.key === "Enter" || e.key === " ") && !(el instanceof HTMLAnchorElement) && !(el instanceof HTMLButtonElement)) {
        e.preventDefault();
        enter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="landing-root fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-[#0a0d12] text-[#e8ebf1] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {/* a faint grid and a soft glow: the only decoration */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgb(255_255_255/0.03)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.03)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] [background:radial-gradient(ellipse_at_top,rgb(56_189_248/0.12),transparent_70%)]" />

      <div className="relative mx-auto flex min-h-dvh max-w-4xl flex-col px-6 py-8 sm:px-10">
        <header className="animate-rise font-logo text-lg font-semibold tracking-tight text-white">Leeterboard</header>

        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <h1 className="animate-rise font-logo text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-6xl" style={{ animationDelay: "80ms" }}>
            Compete, learn and{" "}
            <span className={`bg-gradient-to-r ${ACCENT} bg-clip-text text-transparent`}>climb together</span>
          </h1>
          <p className="mt-5 max-w-xl animate-rise text-base leading-relaxed text-[#a3acbb] sm:text-lg" style={{ animationDelay: "160ms" }}>
            A live weekly leaderboard. Track progress across LeetCode, Codeforces and CodinGame.
          </p>

          <div className="mt-9 flex animate-rise flex-col items-center gap-3" style={{ animationDelay: "240ms" }}>
            <button
              onClick={enter}
              className={`group inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-gradient-to-r ${ACCENT} px-8 text-base font-semibold text-[#0a0d12] transition hover:brightness-110 active:scale-[0.98] ${focusRing}`}
            >
              Enter the board
              <ArrowRight size={18} aria-hidden="true" className="transition-transform group-hover:translate-x-1" />
            </button>
            <span className="hidden text-xs text-[#7d8799] sm:block">
              or press <kbd className="rounded border border-white/20 px-1.5 py-0.5 font-mono">↵</kbd>
            </span>
          </div>
        </section>

        <footer className="flex animate-rise flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-sm text-[#a3acbb]" style={{ animationDelay: "400ms" }}>
          <span>
            Made by{" "}
            <a
              href="https://github.com/itsya-ssine"
              target="_blank"
              rel="noopener noreferrer"
              className={`font-medium text-white underline decoration-white/30 underline-offset-4 transition hover:decoration-[#2dd4bf] ${focusRing}`}
            >
              itsya-ssine
            </a>
          </span>
          <a
            href="https://github.com/itsya-ssine/leeterboard"
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 transition hover:text-white ${focusRing}`}
          >
            <FaGithub size={16} aria-hidden="true" />
            View on GitHub
          </a>
        </footer>
      </div>
    </main>
  );
}
