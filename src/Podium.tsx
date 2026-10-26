import React from "react";
import { Crown } from "lucide-react";
import type { User } from "./types.js";
import type { Movement, RankingKey } from "./movement.js";
import RankMovement from "./RankMovement.js";
import SchoolTag from "./SchoolTag.js";
import TierAvatar from "./TierAvatar.js";

// Faux "accepted solution" that scrolls behind the podium, like an editor
// open next to the standings. Purely decorative.
const CODE_LEFT = [
  "#include <bits/stdc++.h>",
  "using namespace std;",
  "",
  "int main() {",
  "  int n; cin >> n;",
  "  vector<long long> dp(n + 1);",
  "  for (int i = 2; i <= n; i++)",
  "    dp[i] = max(dp[i-1], dp[i-2] + a[i]);",
  "  // O(n) time, O(n) memory",
  "  cout << dp[n] << '\\n';",
  "  return 0;",
  "}",
  "",
  "// verdict: Accepted"
];
const CODE_RIGHT = [
  "def solve(lo, hi):",
  "    while lo < hi:",
  "        mid = (lo + hi) // 2",
  "        if ok(mid):",
  "            hi = mid",
  "        else:",
  "            lo = mid + 1",
  "    return lo",
  "",
  "# O(log n) per query",
  "for _ in range(int(input())):",
  "    print(solve(0, 10**9))",
  "",
  "# time 31 ms  memory 3.2 MB"
];

const KEYWORDS = /\b(int|long|for|while|if|else|return|def|in|range|using|namespace|vector|auto|const)\b/g;

// Tiny tokenizer: comments, keywords and numbers get a theme-aware tint.
function highlight(line: string): React.ReactNode {
  const comment = line.search(/(\/\/|#(?!include))/);
  const code = comment === -1 ? line : line.slice(0, comment);
  const note = comment === -1 ? "" : line.slice(comment);
  const parts = code.split(new RegExp(`${KEYWORDS.source}|(\\b\\d+\\b)`, "g")).filter((p) => p !== undefined && p !== "");
  return (
    <>
      {parts.map((part, i) =>
        /^(int|long|for|while|if|else|return|def|in|range|using|namespace|vector|auto|const)$/.test(part) ? (
          <span key={i} style={{ color: "var(--color-aurora-c)" }}>{part}</span>
        ) : /^\d+$/.test(part) ? (
          <span key={i} style={{ color: "var(--color-amber-300)" }}>{part}</span>
        ) : (
          part
        )
      )}
      {note && <span className={note.includes("Accepted") ? "text-emerald-400" : "text-mist-500"}>{note}</span>}
    </>
  );
}

function CodePane({ lines, className = "" }: { lines: string[]; className?: string }) {
  return (
    <pre className={`m-0 flex gap-3 font-mono text-[11px] leading-[1.35rem] text-mist-400 ${className}`}>
      <code className="select-none text-right text-mist-500/60">{lines.map((_, i) => i + 1).join("\n")}</code>
      <code className="whitespace-pre">
        {lines.map((l, i) => (
          <React.Fragment key={i}>
            {highlight(l)}
            {"\n"}
          </React.Fragment>
        ))}
      </code>
    </pre>
  );
}

// Everything behind the podium: code wallpaper, rising ICPC balloons and a
// perspective grid floor.
function PodiumBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      <div className="podium-code absolute inset-0 flex justify-between px-4 pt-4 opacity-[0.28] sm:px-8">
        <CodePane lines={CODE_LEFT} />
        <CodePane lines={CODE_RIGHT} className="hidden sm:flex" />
      </div>
      <div className="podium-floor absolute inset-x-0 bottom-0 h-32 opacity-70" />
      <span className="animate-float absolute left-[7%] top-[22%] scale-[2.4] text-amber-300 opacity-50" style={{ animationDelay: "0s" }}>
        <span className="balloon" />
      </span>
      <span className="animate-float absolute right-[9%] top-[34%] scale-[2.8] text-sky-400 opacity-45" style={{ animationDelay: "1.4s", animationDuration: "7.5s" }}>
        <span className="balloon" />
      </span>
      <span className="animate-float absolute left-[20%] top-[58%] scale-[1.8] text-rose-400 opacity-40" style={{ animationDelay: "0.7s", animationDuration: "5.5s" }}>
        <span className="balloon" />
      </span>
      <span className="animate-float absolute right-[24%] top-[14%] scale-[1.6] text-emerald-400 opacity-40" style={{ animationDelay: "2.1s", animationDuration: "6.5s" }}>
        <span className="balloon" />
      </span>
    </div>
  );
}

// Medal styling for places 1–3. `glow` is the soft halo behind the avatar,
// `block` the gradient pedestal, `delay` staggers the entrance animation.
const PLACES = [
  {
    text: "text-amber-300",
    avatarRing: "ring-amber-300/70",
    glow: "bg-amber-300/30",
    block: "bg-gradient-to-t from-amber-300/5 via-amber-300/15 to-amber-300/30 ring-amber-300/30",
    blockHeight: "h-24",
    avatar: "size-18 sm:size-24",
    order: "order-2",
    delay: "0.15s"
  },
  {
    text: "text-slate-300",
    avatarRing: "ring-slate-300/60",
    glow: "bg-slate-300/20",
    block: "bg-gradient-to-t from-slate-300/5 via-slate-300/10 to-slate-300/20 ring-slate-300/25",
    blockHeight: "h-16",
    avatar: "size-14 sm:size-18",
    order: "order-1",
    delay: "0.3s"
  },
  {
    text: "text-orange-300",
    avatarRing: "ring-orange-300/60",
    glow: "bg-orange-300/20",
    block: "bg-gradient-to-t from-orange-300/5 via-orange-300/10 to-orange-300/20 ring-orange-300/25",
    blockHeight: "h-12",
    avatar: "size-14 sm:size-18",
    order: "order-3",
    delay: "0.45s"
  }
] as const;

function metric(user: User, sortBy: RankingKey): { value: string; label: string } {
  if (sortBy === "weekly") return { value: `+${user.weeklyProgress}`, label: "this week" };
  if (sortBy === "rating") return { value: String(user.contestRating ?? 0), label: "rating" };
  return { value: user.allTimeSolved.toLocaleString(), label: "solved" };
}

// The top three for the ranking currently selected. `leaders` is [1st, 2nd,
// 3rd]; the list stays in that order for screen readers while CSS `order`
// lays it out as the classic 2nd–1st–3rd podium.
export default function Podium({
  leaders,
  sortBy,
  movements,
  onSelect
}: {
  leaders: User[];
  sortBy: RankingKey;
  movements?: Record<string, Movement>;
  onSelect: (user: User) => void;
}) {
  return (
    <ol
      aria-label="Top three"
      className="relative grid grid-cols-3 items-end gap-2 overflow-hidden border-b border-line bg-gradient-to-b from-transparent to-ink-950/50 px-3 pt-8 sm:gap-4 sm:px-8"
    >
      <PodiumBackdrop />
      {/* Spotlight cone above the winner */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-full w-2/3 -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--color-amber-300)_16%,transparent),transparent_65%)]"
      />
      {leaders.slice(0, 3).map((user, i) => {
        const style = PLACES[i];
        const { value, label } = metric(user, sortBy);
        return (
          <li
            key={user.id}
            className={`relative flex min-w-0 animate-rise flex-col items-center ${style.order}`}
            style={{ animationDelay: style.delay }}
          >
            <button
              type="button"
              onClick={() => onSelect(user)}
              title="View full profile"
              className="group/podium flex w-full min-w-0 cursor-pointer flex-col items-center gap-1 rounded-lg px-1 pb-3 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            >
              {i === 0 && (
                <Crown
                  className="animate-float size-5 fill-amber-300/30 text-amber-300 drop-shadow-[0_0_8px_rgb(252_211_77/0.6)]"
                  aria-hidden="true"
                />
              )}
              <span className="relative mt-1 grid place-items-center">
                <span
                  aria-hidden="true"
                  className={`animate-glow absolute inset-0 -z-0 scale-125 rounded-full blur-xl ${style.glow}`}
                />
                <TierAvatar
                  user={user}
                  showGem
                  gemSize="sm"
                  className={`${style.avatar} transition duration-300 group-hover/podium:-translate-y-1 group-hover/podium:scale-105`}
                />
                <span
                  aria-hidden="true"
                  className={`absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-ink-900 text-xs font-bold tabular-nums ring-2 ring-current ${style.text}`}
                >
                  {i + 1}
                </span>
              </span>
              <span className="mt-2 flex w-full min-w-0 items-center justify-center gap-1">
                <span className="truncate text-xs font-semibold text-strong transition-colors group-hover/podium:text-teal-300 sm:text-sm">
                  {user.displayName}
                </span>
                <RankMovement movement={movements?.[user.id]} />
              </span>
              <span className="w-full truncate font-mono text-xs text-mist-500">@{user.leetcodeUsername}</span>
              <SchoolTag school={user.school} />
              <span className={`mt-0.5 font-mono text-base font-bold tabular-nums sm:text-lg ${style.text}`}>
                {value} <span className="text-xs font-normal text-mist-500">{label}</span>
              </span>
            </button>
            <div
              className={`relative grid w-full place-items-center overflow-hidden rounded-t-xl ring-1 ${style.block} ${style.blockHeight}`}
              aria-hidden="true"
            >
              {i === 0 && <div className="gold-sheen absolute inset-0" />}
              <span className={`relative font-mono text-4xl font-bold tabular-nums opacity-80 ${style.text}`}>
                {i + 1}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
