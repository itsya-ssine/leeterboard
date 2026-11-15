import type { ReactNode } from "react";
import { FaGithub } from "react-icons/fa";
import { LEGAL, LEGAL_PATHS } from "../../legal.js";
import { FAQ_PATH } from "../../faq.js";

const TONES = {
  theme: {
    wrap: "border-ink-700 text-mist-500",
    link: "hover:text-mist-100",
    ring: "focus-visible:outline-teal-400"
  },
  dark: {
    wrap: "border-ink-700 text-mist-400",
    link: "hover:text-mist-100",
    ring: "focus-visible:outline-teal-400"
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
  const link = `inline-flex items-center gap-1.5 transition-colors font-mono text-xs ${t.link} focus-visible:outline-2 focus-visible:outline-offset-4 ${t.ring}`;
  const external = { target: "_blank", rel: "noopener noreferrer" } as const;
  const legalTarget = newTab ? external : {};

  return (
    <footer className={`border-t-2 pt-6 text-xs ${t.wrap} ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 font-mono">
        <span className="text-mist-500">{lead ?? `© ${new Date().getFullYear()} ${LEGAL.serviceName}`}</span>
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
            <FaGithub size={14} aria-hidden="true" />
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
