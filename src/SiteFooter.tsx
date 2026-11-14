import type { ReactNode } from "react";
import { FaGithub } from "react-icons/fa";
import { LEGAL, LEGAL_PATHS } from "./legal.js";
import { FAQ_PATH } from "./faq.js";

// The footer every page shares: the app, the landing page and the legal pages.
//
//   tone="theme"  uses the app's theme tokens (light and dark).
//   tone="dark"   uses fixed colours, for the landing page, which is always dark.
//
// `lead` replaces the default "© Leeterboard" text on the left. `newTab` opens
// the legal links in a new tab, which the app uses so a leaderboard someone is
// looking at isn't thrown away. The Status link only appears once
// LEGAL.statusUrl is set.
const TONES = {
  theme: {
    wrap: "border-line text-mist-500",
    link: "hover:text-strong",
    ring: "focus-visible:outline-teal-300"
  },
  dark: {
    wrap: "border-white/10 text-[#a3acbb]",
    link: "hover:text-white",
    ring: "focus-visible:outline-[#5eead4]"
  }
} as const;

export default function SiteFooter({
  tone = "theme",
  lead,
  newTab = false,
  statusUrl = LEGAL.statusUrl,
  className = ""
}: {
  tone?: keyof typeof TONES;
  lead?: ReactNode;
  newTab?: boolean;
  statusUrl?: string;
  className?: string;
}) {
  const t = TONES[tone];
  const link = `inline-flex items-center gap-1.5 transition ${t.link} focus-visible:outline-2 focus-visible:outline-offset-4 ${t.ring}`;
  const external = { target: "_blank", rel: "noopener noreferrer" } as const;
  const legalTarget = newTab ? external : {};

  return (
    <footer className={`border-t pt-5 text-sm ${t.wrap} ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <span>{lead ?? `© ${new Date().getFullYear()} ${LEGAL.serviceName}`}</span>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a href={LEGAL_PATHS.privacy} className={link} {...legalTarget}>
            Privacy
          </a>
          <a href={LEGAL_PATHS.terms} className={link} {...legalTarget}>
            Terms
          </a>
          <a href={FAQ_PATH} className={link} {...legalTarget}>
            FAQ
          </a>
          <a href={`mailto:${LEGAL.contactEmail}`} className={link}>
            Contact
          </a>
          <a href={LEGAL.sourceUrl} className={link} {...external} title="Star on GitHub">
            <FaGithub size={15} aria-hidden="true" />
            Star on GitHub
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          {statusUrl && (
            <a href={statusUrl} className={link} {...external}>
              Status
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
