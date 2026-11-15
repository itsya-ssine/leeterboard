import React from "react";
import type { User } from "../../../types.js";
import type { Movement, RankingKey } from "../utils/movement.js";
import RankMovement from "./RankMovement.js";
import SchoolTag from "../../../components/common/SchoolTag.js";
import TierAvatar from "../../../components/ui/TierAvatar.js";
import { PixelCrown, PixelTrophy, PixelStar } from "../../../pixelArt.js";

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

function highlight(line: string): React.ReactNode {
  const comment = line.search(/(\/\/|#(?!include))/);
  const code = comment === -1 ? line : line.slice(0, comment);
  const note = comment === -1 ? "" : line.slice(comment);
  const parts = code.split(new RegExp(`${KEYWORDS.source}|(\\b\\d+\\b)`, "g")).filter((p) => p !== undefined && p !== "");
  return (
    <>
      {parts.map((part, i) =>
        /^(int|long|for|while|if|else|return|def|in|range|using|namespace|vector|auto|const)$/.test(part) ? (
          <span key={i} className="text-purple-400">{part}</span>
        ) : /^\d+$/.test(part) ? (
          <span key={i} className="text-amber-300">{part}</span>
        ) : (
          part
        )
      )}
      {note && <span className={note.includes("Accepted") ? "text-emerald-400 font-bold" : "text-mist-500"}>{note}</span>}
    </>
  );
}

function CodePane({ lines, className = "" }: { lines: string[]; className?: string }) {
  return (
    <pre className={`m-0 flex gap-3 font-mono text-[11px] leading-[1.35rem] text-mist-400 ${className}`}>
      <code className="select-none text-right text-mist-500/50">{lines.map((_, i) => i + 1).join("\n")}</code>
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

function PodiumBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      <div className="podium-code absolute inset-0 flex justify-between px-4 pt-4 opacity-[0.22] sm:px-8">
        <CodePane lines={CODE_LEFT} />
        <CodePane lines={CODE_RIGHT} className="hidden sm:flex" />
      </div>
      <div className="podium-floor absolute inset-x-0 bottom-0 h-32 opacity-70" />
      {/* Floating pixel stars */}
      <span className="animate-float absolute left-[7%] top-[18%] opacity-60" style={{ animationDelay: "0s" }}>
        <PixelStar size={16} color="#fbbf24" />
      </span>
      <span className="animate-float absolute right-[8%] top-[24%] opacity-50" style={{ animationDelay: "1.2s", animationDuration: "5s" }}>
        <PixelStar size={14} color="#06b6d4" />
      </span>
      <span className="animate-float absolute left-[18%] top-[54%] opacity-45" style={{ animationDelay: "0.6s", animationDuration: "4.5s" }}>
        <PixelStar size={12} color="#a855f7" />
      </span>
      <span className="animate-float absolute right-[22%] top-[12%] opacity-50" style={{ animationDelay: "1.8s", animationDuration: "6s" }}>
        <PixelStar size={14} color="#10b981" />
      </span>
    </div>
  );
}

const PLACES = [
  {
    text: "text-amber-300",
    avatarRing: "border-amber-400",
    glow: "bg-amber-400/25",
    block: "border-2 border-b-0 border-amber-400/80 bg-ink-900 shadow-[3px_0_0_#78350f,-3px_0_0_#78350f,0_0_20px_rgba(251,191,36,0.15)]",
    blockHeight: "h-26 sm:h-28",
    avatar: "size-18 sm:size-24",
    order: "order-2",
    delay: "0.15s"
  },
  {
    text: "text-slate-200",
    avatarRing: "border-slate-300",
    glow: "bg-slate-300/15",
    block: "border-2 border-b-0 border-slate-300/70 bg-ink-900 shadow-[3px_0_0_#334155,-3px_0_0_#334155]",
    blockHeight: "h-18 sm:h-20",
    avatar: "size-14 sm:size-18",
    order: "order-1",
    delay: "0.3s"
  },
  {
    text: "text-orange-300",
    avatarRing: "border-orange-400",
    glow: "bg-orange-300/15",
    block: "border-2 border-b-0 border-orange-400/70 bg-ink-900 shadow-[3px_0_0_#7c2d12,-3px_0_0_#7c2d12]",
    blockHeight: "h-14 sm:h-15",
    avatar: "size-14 sm:size-18",
    order: "order-3",
    delay: "0.45s"
  }
] as const;

export interface PodiumEntry {
  id: string;
  name: string;
  handle: string;
  handleClassName?: string;
  school?: string;
  value: string;
  label: string;
  avatar: (className: string) => React.ReactNode;
  movement?: Movement;
  href?: string;
  onSelect?: () => void;
}

const PLACE_BUTTON_CLASS =
  "group/podium flex w-full min-w-0 cursor-pointer flex-col items-center gap-1 px-1 pb-3 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400";

export function PodiumBoard({ entries }: { entries: PodiumEntry[] }) {
  return (
    <ol
      aria-label="Top three"
      className="relative grid grid-cols-3 items-end gap-2 overflow-hidden border-b-2 border-ink-700 bg-ink-950/70 px-3 pt-8 sm:gap-4 sm:px-8"
    >
      <PodiumBackdrop />
      {/* Retro spotlight cone */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-full w-2/3 -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.14),transparent_65%)]"
      />
      {entries.slice(0, 3).map((entry, i) => {
        const style = PLACES[i];
        const body = (
          <>
            {i === 0 && (
              <div className="animate-float mb-0.5">
                <PixelCrown size={22} />
              </div>
            )}
            {i === 1 && (
              <div className="mb-0.5">
                <PixelTrophy variant="silver" size={18} />
              </div>
            )}
            {i === 2 && (
              <div className="mb-0.5">
                <PixelTrophy variant="bronze" size={18} />
              </div>
            )}
            <span className="relative mt-1 grid place-items-center">
              <span
                aria-hidden="true"
                className={`animate-glow absolute inset-0 -z-0 scale-125 blur-xl ${style.glow}`}
              />
              {entry.avatar(
                `${style.avatar} transition-transform duration-200 group-hover/podium:-translate-y-1`
              )}
              <span
                aria-hidden="true"
                className={`absolute -bottom-1 -right-1 grid size-6 place-items-center border-2 border-ink-950 bg-ink-900 font-pixel text-[10px] font-bold tabular-nums shadow-[1px_1px_0_#000] ${style.text}`}
              >
                #{i + 1}
              </span>
            </span>
            <span className="mt-2 flex w-full min-w-0 items-center justify-center gap-1">
              <span className="truncate font-sans text-xs font-bold text-mist-100 transition-colors group-hover/podium:text-teal-300 sm:text-sm">
                {entry.name}
              </span>
              <RankMovement movement={entry.movement} />
            </span>
            <span className={`w-full truncate font-mono text-xs ${entry.handleClassName ?? "text-mist-500"}`}>
              {entry.handle}
            </span>
            <SchoolTag school={entry.school} />
            <span className={`mt-1 font-pixel text-sm font-bold tabular-nums sm:text-base ${style.text}`}>
              {entry.value} <span className="font-mono text-xs font-normal text-mist-500">{entry.label}</span>
            </span>
          </>
        );
        return (
          <li
            key={entry.id}
            className={`relative flex min-w-0 animate-rise flex-col items-center ${style.order}`}
            style={{ animationDelay: style.delay }}
          >
            {entry.href ? (
              <a href={entry.href} title="View full profile" className={PLACE_BUTTON_CLASS}>
                {body}
              </a>
            ) : (
              <button type="button" onClick={entry.onSelect} title="View full profile" className={PLACE_BUTTON_CLASS}>
                {body}
              </button>
            )}
            {/* Stepped Pixel Pedestal */}
            <div
              className={`relative grid w-full place-items-center overflow-hidden ${style.block} ${style.blockHeight}`}
              aria-hidden="true"
            >
              {i === 0 && <div className="gold-sheen absolute inset-0" />}
              <span className={`relative font-pixel text-3xl sm:text-4xl font-bold tabular-nums opacity-90 ${style.text}`}>
                {i + 1}
              </span>
              {/* Stepped base lines */}
              <div className="absolute inset-x-0 bottom-0 h-1 bg-ink-950" />
            </div>
          </li>
        );
      })}
      {Array.from({ length: Math.max(0, 3 - entries.length) }, (_, k) => {
        const i = entries.length + k;
        const style = PLACES[i];
        return (
          <li key={`empty-${i}`} aria-hidden="true" className={`relative flex min-w-0 flex-col items-center ${style.order}`}>
            <div
              className={`relative grid w-full place-items-center overflow-hidden opacity-30 ${style.block} ${style.blockHeight}`}
            >
              <span className={`font-pixel text-3xl font-bold tabular-nums opacity-80 ${style.text}`}>{i + 1}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function metric(user: User, sortBy: RankingKey): { value: string; label: string } {
  if (sortBy === "weekly") return { value: `+${user.weeklyProgress}`, label: "this week" };
  if (sortBy === "rating") return { value: String(user.contestRating ?? 0), label: "rating" };
  return { value: user.allTimeSolved.toLocaleString(), label: "solved" };
}

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
    <PodiumBoard
      entries={leaders.slice(0, 3).map((user) => ({
        id: user.id,
        name: user.displayName,
        handle: `@${user.loginUsername}`,
        school: user.school,
        ...metric(user, sortBy),
        movement: movements?.[user.id],
        onSelect: () => onSelect(user),
        avatar: (className) => <TierAvatar user={user} showGem gemSize="sm" className={className} />
      }))}
    />
  );
}
