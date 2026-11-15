import { useEffect, useRef } from "react";
import { ArrowRight, Flame, Trophy, Users } from "lucide-react";
import SiteFooter from "./SiteFooter.js";

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
        <header className="animate-rise font-pixel text-base font-bold tracking-wider text-white">
          <span className="text-emerald-400">&gt; </span>LEETERBOARD<span className="animate-blink text-emerald-400">_</span>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-12 text-center">
          <h1 className="animate-rise font-pixel text-2xl font-bold leading-normal tracking-tight text-white sm:text-4xl" style={{ animationDelay: "80ms" }}>
            Compete, learn and{" "}
            <span className="text-emerald-400 underline decoration-4 decoration-emerald-500/60">climb together</span>
          </h1>
          <p className="mt-5 max-w-xl animate-rise font-mono text-sm leading-relaxed text-[#a3acbb] sm:text-base" style={{ animationDelay: "160ms" }}>
            A live weekly leaderboard. Track progress across LeetCode, Codeforces and CodinGame.
          </p>

          <div className="mt-8 flex animate-rise flex-col items-center gap-3" style={{ animationDelay: "240ms" }}>
            <button
              onClick={enter}
              className={`group pixel-btn pixel-btn-primary inline-flex h-12 cursor-pointer items-center gap-3 px-8 font-pixel text-xs uppercase tracking-wider text-ink-950 shadow-[3px_3px_0_#000] active:translate-x-[1px] active:translate-y-[1px] ${focusRing}`}
            >
              <span>PRESS START</span>
              <ArrowRight size={16} aria-hidden="true" className="transition-transform group-hover:translate-x-1" />
            </button>
            <span className="hidden font-mono text-xs text-[#7d8799] sm:block">
              or press <kbd className="border border-white/20 bg-ink-950 px-2 py-0.5 font-pixel text-[9px] text-emerald-400 shadow-[1px_1px_0_#000]">ENTER ↵</kbd>
            </span>
          </div>

          <div className="mt-12 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
            {HIGHLIGHTS.map((h, i) => {
              const Icon = h.icon;
              return (
                <div
                  key={h.title}
                  className="pixel-card p-4 text-left"
                  style={{ animationDelay: `${320 + i * 80}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center border border-ink-700 bg-ink-950 text-emerald-400">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <h3 className="font-pixel text-[9px] font-bold uppercase tracking-wide text-strong">{h.title}</h3>
                  </div>
                  <p className="mt-2 font-mono text-xs leading-relaxed text-[#a3acbb]">{h.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        <SiteFooter
          tone="dark"
          className="animate-rise"
          lead={
            <>
              Made by{" "}
              <a
                href="https://github.com/itsya-ssine"
                target="_blank"
                rel="noopener noreferrer"
                className={`font-medium text-white underline decoration-white/30 underline-offset-4 transition hover:decoration-[#2dd4bf] ${focusRing}`}
              >
                itsya-ssine
              </a>
            </>
          }
        />
      </div>
    </main>
  );
}
