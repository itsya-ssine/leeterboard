import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { motion } from "motion/react";
import { ArrowRight, Star } from "lucide-react";
import { FaGithub } from "react-icons/fa";

// The landing page is always dark, whatever theme the app uses, so it uses
// fixed colours instead of the theme tokens.
const AURORA = "from-[#2dd4bf] via-[#38bdf8] to-[#a78bfa]";
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Background: a graph that runs BFS, and code drifting by ---------- */

const TOKENS: { t: string; c?: string }[] = [
  { t: "O(n log n)" }, { t: "dp[i][j]" }, { t: "while (l < r)" }, { t: "#include <bits/stdc++.h>" },
  { t: "gcd(a, b)" }, { t: "mod 1e9+7" }, { t: "seg_tree.update()" }, { t: "n ≤ 2·10⁵" },
  { t: "std::sort" }, { t: "return -1;" }, { t: "visited[v] = true" }, { t: "lower_bound" },
  { t: "AC", c: "52,211,153" }, { t: "AC", c: "52,211,153" }, { t: "WA", c: "248,113,113" }, { t: "TLE", c: "251,191,36" }
];

function CodeField({ pointer }: { pointer: RefObject<{ x: number; y: number }> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const still = reducedMotion();
    let w = 0, h = 0, raf = 0, last = 0, nextPulse = 0;
    type Node = { x: number; y: number; ph: number; lit: number; adj: number[] };
    let nodes: Node[] = [];
    let queue: { i: number; at: number }[] = []; // BFS wave: node i lights up at time `at`
    let words: { x: number; y: number; vy: number; i: number }[] = [];

    const build = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nodes = Array.from({ length: Math.round(Math.min(80, (w * h) / 16000)) }, () => ({
        x: Math.random() * w, y: Math.random() * h, ph: Math.random() * 6.283, lit: 0, adj: []
      }));
      nodes.forEach((a, i) => {
        // connect to the (at most 3) nearest nodes: it reads as a graph, not a mesh
        nodes
          .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
          .filter((o) => o.j !== i && o.d < 170)
          .sort((x, y) => x.d - y.d)
          .slice(0, 3)
          .forEach((o) => { if (!a.adj.includes(o.j)) a.adj.push(o.j); if (!nodes[o.j].adj.includes(i)) nodes[o.j].adj.push(i); });
      });
      words = Array.from({ length: Math.round(Math.min(18, w / 70)) }, (_, k) => ({
        x: Math.random() * w, y: Math.random() * h, vy: 0.12 + Math.random() * 0.28, i: k % TOKENS.length
      }));
    };

    // Breadth-first search from `src`: each layer lights up 130 ms after the last.
    const pulse = (src: number, now: number) => {
      const depth = new Map<number, number>([[src, 0]]);
      const q = [src];
      for (let k = 0; k < q.length; k++) {
        for (const n of nodes[q[k]].adj) if (!depth.has(n)) { depth.set(n, depth.get(q[k])! + 1); q.push(n); }
      }
      depth.forEach((d, i) => queue.push({ i, at: now + d * 130 }));
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      const p = pointer.current;
      if (!still && now > nextPulse && nodes.length) { pulse(Math.floor(Math.random() * nodes.length), now); nextPulse = now + 2800; }
      queue = queue.filter((e) => (now >= e.at ? ((nodes[e.i].lit = 1), false) : true));
      const pos = nodes.map((n) => ({ x: n.x + Math.sin(now / 1800 + n.ph) * 4, y: n.y + Math.cos(now / 2100 + n.ph) * 4 }));
      nodes.forEach((n, i) => {
        if (Math.hypot(pos[i].x - p.x, pos[i].y - p.y) < 110) n.lit = Math.max(n.lit, 0.7); // pointer lights nodes up
        n.lit *= 0.965;
      });
      // edges
      ctx.lineWidth = 1;
      nodes.forEach((a, i) => a.adj.forEach((j) => {
        if (j < i) return;
        const glow = Math.max(a.lit, nodes[j].lit);
        ctx.strokeStyle = glow > 0.05 ? `rgba(45,212,191,${0.12 + glow * 0.6})` : "rgba(148,163,184,0.12)";
        ctx.beginPath(); ctx.moveTo(pos[i].x, pos[i].y); ctx.lineTo(pos[j].x, pos[j].y); ctx.stroke();
      }));
      // nodes
      nodes.forEach((n, i) => {
        ctx.fillStyle = n.lit > 0.05 ? `rgba(94,234,212,${0.4 + n.lit * 0.6})` : "rgba(148,163,184,0.45)";
        ctx.beginPath(); ctx.arc(pos[i].x, pos[i].y, 2.2 + n.lit * 3.2, 0, 6.283); ctx.fill();
      });
      // code and verdicts drifting upward
      for (const wd of words) {
        const tk = TOKENS[wd.i];
        if (!still) { wd.y -= wd.vy; if (wd.y < -20) { wd.y = h + 20; wd.x = Math.random() * w; } }
        ctx.font = `${tk.c ? "bold 15px" : "13px"} ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillStyle = tk.c ? `rgba(${tk.c},0.3)` : "rgba(148,163,184,0.2)";
        ctx.fillText(tk.t, wd.x, wd.y);
      }
    };

    const loop = (t: number) => { last = t; draw(t); raf = requestAnimationFrame(loop); };
    build();
    if (still) draw(0); else raf = requestAnimationFrame(loop);
    const onResize = () => { build(); if (still) draw(last); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [pointer]);
  return <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" />;
}

/* ---------- Typewriter ---------- */

const PHRASES = ["solve()", "climb()", "repeat()", "rank_up()"];

function useTypewriter() {
  const [text, setText] = useState(reducedMotion() ? PHRASES[0] : "");
  useEffect(() => {
    if (reducedMotion()) return;
    let word = 0, len = 0, deleting = false, timer = 0;
    const tick = () => {
      const target = PHRASES[word];
      len += deleting ? -1 : 1;
      setText(target.slice(0, len));
      let wait = deleting ? 35 : 80;
      if (!deleting && len === target.length) { deleting = true; wait = 1300; }
      else if (deleting && len === 0) { deleting = false; word = (word + 1) % PHRASES.length; wait = 300; }
      timer = window.setTimeout(tick, wait);
    };
    timer = window.setTimeout(tick, 500);
    return () => window.clearTimeout(timer);
  }, []);
  return text;
}

/* ---------- The page ---------- */

const JUDGE: { at: number; text: string }[] = [
  { at: 0, text: "Compiling…" },
  { at: 380, text: "Case 1/3  ✓" },
  { at: 680, text: "Case 2/3  ✓" },
  { at: 980, text: "Case 3/3  ✓" },
  { at: 1350, text: "Accepted  ·  0 ms  ·  beats 100%" }
];
const WIPE_AT = 1900;

const MARQUEE = ["Solve", "Climb", "Repeat", "LeetCode", "Codeforces", "CodinGame", "Weekly ranks", "Live"];
const CONFETTI_COLORS = ["#2dd4bf", "#38bdf8", "#a78bfa", "#fbbf24", "#34d399"];

type Phase = "idle" | "judging" | "wipe";

export default function Landing({ onEnter }: { onEnter: (animated: boolean) => void }) {
  const root = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: -9999, y: -9999 });
  const timers = useRef<number[]>([]);
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [accepted, setAccepted] = useState(false);
  const typed = useTypewriter();
  const confetti = useRef(
    Array.from({ length: 36 }, (_, i) => {
      const angle = (i / 36) * 6.283 + Math.random() * 0.4;
      const dist = 90 + Math.random() * 170;
      return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, c: CONFETTI_COLORS[i % 5], s: 5 + Math.random() * 6 };
    })
  );

  const enter = () => {
    if (started.current) return;
    started.current = true;
    if (reducedMotion()) return onEnter(false);
    const r = button.current?.getBoundingClientRect();
    setOrigin({ x: r ? r.left + r.width / 2 : innerWidth / 2, y: r ? r.top + r.height / 2 : innerHeight / 2 });
    setPhase("judging");
    root.current?.style.setProperty("--bx", "0px");
    root.current?.style.setProperty("--by", "0px");
    for (const step of JUDGE) timers.current.push(window.setTimeout(() => setLines((l) => [...l, step.text]), step.at));
    timers.current.push(window.setTimeout(() => setAccepted(true), JUDGE[JUDGE.length - 1].at));
    timers.current.push(window.setTimeout(() => setPhase("wipe"), WIPE_AT));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if ((e.key === "Enter" || e.key === " ") && !(el instanceof HTMLAnchorElement) && !(el instanceof HTMLButtonElement)) {
        e.preventDefault();
        enter();
      }
    };
    window.addEventListener("keydown", onKey);
    const pending = timers.current;
    return () => { window.removeEventListener("keydown", onKey); pending.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rise = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });
  const set = (k: string, v: string) => root.current?.style.setProperty(k, v);

  const onPointerMove = (e: React.PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    set("--mx", `${e.clientX}px`);
    set("--my", `${e.clientY}px`);
    set("--nx", String((e.clientX / innerWidth) * 2 - 1)); // -1..1, drives the parallax
    set("--ny", String((e.clientY / innerHeight) * 2 - 1));
    const r = button.current?.getBoundingClientRect(); // the button leans toward the cursor
    if (r && phase === "idle") {
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const near = Math.hypot(dx, dy) < 220;
      set("--bx", `${near ? Math.max(-14, Math.min(14, dx * 0.12)) : 0}px`);
      set("--by", `${near ? Math.max(-10, Math.min(10, dy * 0.12)) : 0}px`);
    }
  };

  return (
    <main
      ref={root}
      onPointerMove={onPointerMove}
      className="landing-root fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-[#0a0d12] text-[#e8ebf1] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      style={{ "--mx": "50%", "--my": "35%", "--nx": "0", "--ny": "0", "--bx": "0px", "--by": "0px" } as CSSProperties}
    >
      <CodeField pointer={pointer} />
      {/* editor-style line numbers down the left edge */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 hidden w-14 select-none overflow-hidden border-r border-white/[0.06] py-3 text-right font-mono text-[11px] leading-6 text-white/[0.14] [mask-image:linear-gradient(180deg,black,transparent_96%)] sm:block">
        {Array.from({ length: 80 }, (_, i) => (
          <div key={i} className="pr-3">{i + 1}</div>
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      {/* a slowly turning aurora behind the headline, and a spotlight that follows the pointer */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[46rem] w-[46rem] max-w-[140vw] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl [background:conic-gradient(from_0deg,#2dd4bf,#38bdf8,#a78bfa,#2dd4bf)] [animation:spin_30s_linear_infinite] motion-reduce:[animation:none]" />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 [background:radial-gradient(520px_circle_at_var(--mx)_var(--my),rgb(56_189_248/0.14),transparent_70%)]" />

      <div className="relative mx-auto flex min-h-dvh max-w-6xl flex-col overflow-y-clip px-6 py-8 sm:px-10">
        <header className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 font-mono text-xs text-[#a3acbb] animate-rise">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#2dd4bf] animate-glow" /> live weekly leaderboard
          </span>
          <span className="hidden sm:inline">LeetCode · Codeforces · CodinGame</span>
        </header>

        <div className="flex flex-1 items-center justify-center py-10">
          <section className="flex flex-col items-center text-center">
            <p className="mb-5 h-6 font-mono text-sm text-[#2dd4bf] animate-rise" style={rise(80)}>
              <span className="text-[#7d8799]">&gt;</span> {typed}
              <span className="ml-0.5 inline-block h-4 w-[7px] translate-y-0.5 bg-[#2dd4bf] animate-blink" />
            </p>

            <div
              className="relative animate-rise transition-transform duration-300 ease-out"
              style={{ ...rise(160), transform: "translate(calc(var(--nx) * -10px), calc(var(--ny) * -8px))" }}
            >
              {/* the same wordmark, blurred, as a neon glow underneath */}
              <span aria-hidden className={`absolute inset-0 select-none font-logo text-6xl font-bold leading-[0.95] tracking-tight sm:text-8xl bg-gradient-to-r ${AURORA} bg-clip-text text-transparent blur-2xl opacity-70`}>
                Leeter<br className="sm:hidden" />board
              </span>
              <h1 className={`relative select-none font-logo text-6xl font-bold leading-[0.95] tracking-tight sm:text-8xl bg-gradient-to-r ${AURORA} bg-[length:200%_auto] bg-clip-text text-transparent animate-shimmer`}>
                Leeter<br className="sm:hidden" />board
              </h1>
            </div>

            <div className="mt-12 flex flex-col items-center animate-rise" style={rise(300)}>
              <div className="relative transition-transform duration-200 ease-out" style={{ transform: "translate(var(--bx), var(--by))" }}>
                {phase === "idle" && (
                  <span aria-hidden className="absolute inset-0 rounded-full bg-[#38bdf8]/35 animate-ping [animation-duration:2.6s] motion-reduce:hidden" />
                )}
                <button
                  ref={button}
                  onClick={enter}
                  disabled={phase !== "idle"}
                  className={`group relative inline-flex h-14 cursor-pointer items-center gap-3 overflow-hidden rounded-full bg-gradient-to-r ${AURORA} px-9 text-base font-semibold text-[#0a0d12] shadow-[0_0_0_1px_rgb(255_255_255/0.18)_inset,0_10px_50px_-6px_rgb(45_212_191/0.75)] transition active:scale-[0.97] disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5eead4]`}
                >
                  <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  <span className="relative">{phase === "idle" ? "Enter the board" : "Judging…"}</span>
                  <ArrowRight className="relative transition-transform group-hover:translate-x-1.5" size={20} />
                </button>
              </div>
              {phase === "idle" && (
                <span className="mt-4 hidden font-mono text-xs text-[#7d8799] sm:block">
                  or press <kbd className="rounded border border-white/20 px-1.5 py-0.5">↵</kbd>
                </span>
              )}

              <div aria-live="polite" className="mt-5 min-h-[7.5rem] text-center font-mono text-sm">
                {lines.map((l, i) => (
                  <p key={i} className={`animate-rise ${i === JUDGE.length - 1 ? "font-semibold text-[#34d399]" : "text-[#a3acbb]"}`}>
                    {l}
                  </p>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 pb-7 text-sm text-[#a3acbb] animate-rise" style={rise(500)}>
          <span>
            Made with <span aria-label="love" className="text-[#f472b6]">♥</span> by{" "}
            <a
              href="https://github.com/itsya-ssine"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-white underline decoration-[#2dd4bf]/60 underline-offset-4 transition hover:decoration-[#2dd4bf] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5eead4]"
            >
              itsya-ssine
            </a>
          </span>
          <a
            href="https://github.com/itsya-ssine/leeterboard"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 font-medium text-white ring-1 ring-white/15 transition hover:bg-white/10 hover:ring-[#fbbf24]/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5eead4]"
          >
            <FaGithub size={16} aria-hidden="true" />
            Star me on GitHub
            <Star size={15} className="text-[#fbbf24] transition-transform group-hover:rotate-[72deg] group-hover:scale-125" fill="currentColor" aria-hidden="true" />
          </a>
        </div>

        <footer
          aria-hidden
          className="-mx-6 overflow-hidden border-y border-white/10 py-3 font-mono text-xs uppercase tracking-[0.3em] text-[#7d8799] animate-rise [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)] sm:-mx-10"
          style={rise(600)}
        >
          <div className="flex w-max animate-marquee motion-reduce:animate-none">
            {[0, 1].map((half) => (
              <div key={half} className="flex shrink-0 gap-10 pr-10">
                {[...MARQUEE, ...MARQUEE].map((w, i) => (
                  <span key={i} className="whitespace-nowrap">
                    {w} <span className="ml-10 text-[#2dd4bf]">✦</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </footer>
      </div>

      {/* confetti when the judge says Accepted */}
      {accepted &&
        confetti.current.map((p, i) => (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none fixed z-[55] rounded-[2px] [animation:burst_1s_ease-out_forwards]"
            style={{ left: origin.x, top: origin.y, width: p.s, height: p.s * 0.6, background: p.c, "--dx": `${p.dx}px`, "--dy": `${p.dy}px` } as CSSProperties}
          />
        ))}

      {phase === "wipe" && (
        <motion.div
          aria-hidden
          className={`fixed inset-0 z-[60] bg-gradient-to-br ${AURORA}`}
          initial={{ clipPath: `circle(0px at ${origin.x}px ${origin.y}px)` }}
          animate={{ clipPath: `circle(${Math.hypot(innerWidth, innerHeight)}px at ${origin.x}px ${origin.y}px)` }}
          transition={{ duration: 0.7, ease: [0.76, 0, 0.24, 1] }}
          onAnimationComplete={() => onEnter(true)}
        />
      )}
    </main>
  );
}
