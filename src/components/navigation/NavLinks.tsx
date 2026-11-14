import { Activity, Gamepad2, ListOrdered, ShieldCheck, Swords, Trophy } from "lucide-react";
import { useI18n } from "../../i18n.js";

export type Page = "leaderboard" | "codeforces" | "codingame" | "stats" | "compare" | "profile" | "account" | "admin";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

export const NAV_ITEMS = [
  { page: "leaderboard", href: "#/", label: "Leaderboard", Icon: ListOrdered },
  { page: "codeforces", href: "#/codeforces", label: "Codeforces", Icon: Trophy },
  { page: "codingame", href: "#/codingame", label: "CodinGame", Icon: Gamepad2 },
  { page: "stats", href: "#/stats", label: "Stats", Icon: Activity },
  { page: "compare", href: "#/compare", label: "Compare", Icon: Swords }
] as const;

export const ADMIN_NAV_ITEM = { page: "admin", href: "#/admin", label: "Sync health", Icon: ShieldCheck } as const;

export const NAV_LABEL_CLASS = { sm: "hidden sm:inline", xl: "hidden xl:inline", never: "hidden" } as const;
export const NAV_PADDING_CLASS = { sm: "px-2.5 sm:px-3", xl: "px-2.5 xl:px-3", never: "px-2.5" } as const;

export default function NavLinks({
  page,
  isAdmin = false,
  className = "",
  labelFrom = "xl",
  fill = false
}: {
  page: Page;
  isAdmin?: boolean;
  className?: string;
  labelFrom?: keyof typeof NAV_LABEL_CLASS;
  fill?: boolean;
}) {
  const { t } = useI18n();
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  const getNavLabel = (p: string, defaultLabel: string) => {
    switch (p) {
      case "leaderboard": return t.leaderboard;
      case "codeforces": return t.codeforces;
      case "codingame": return t.codingame;
      case "stats": return t.stats;
      case "compare": return t.compare;
      case "admin": return t.syncHealth;
      default: return defaultLabel;
    }
  };

  return (
    <nav aria-label="Main" className={`items-center gap-1 ${className}`}>
      {items.map(({ page: p, href, label, Icon }) => {
        const navLabel = getNavLabel(p, label);
        return (
          <a
            key={p}
            href={href}
            aria-current={page === p ? "page" : undefined}
            aria-label={navLabel}
            title={navLabel}
            className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${focusRing} ${
              NAV_PADDING_CLASS[labelFrom]
            } ${fill ? "min-w-0 flex-1" : "shrink-0"} ${
              page === p
                ? "bg-ink-800 text-strong shadow-[inset_0_-2px_0_0_var(--color-teal-400)] ring-1 ring-line"
                : "text-mist-400 hover:bg-tint hover:text-strong"
            }`}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className={NAV_LABEL_CLASS[labelFrom]}>{navLabel}</span>
          </a>
        );
      })}
    </nav>
  );
}
