import { useState, useRef, useEffect } from "react";
import { Globe, Check } from "lucide-react";
import { useI18n, type Locale } from "../../i18n.js";

const LANGUAGES: { code: Locale; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "fr", label: "French", native: "Français" },
  { code: "ar", label: "Arabic", native: "العربية" }
];

export default function LanguageSelector({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t.language}
        title={t.language}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-ink-900/60 px-2.5 text-xs font-medium text-mist-300 transition-colors hover:bg-tint hover:text-strong focus:outline-none focus:ring-2 focus:ring-teal-400"
      >
        <Globe className="size-3.5 text-teal-400" aria-hidden="true" />
        <span className="uppercase">{locale}</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t.language}
          className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-xl border border-line bg-ink-900 p-1 shadow-xl animate-in fade-in zoom-in-95"
        >
          {LANGUAGES.map((lang) => {
            const isSelected = locale === lang.code;
            return (
              <button
                key={lang.code}
                role="option"
                aria-selected={isSelected}
                type="button"
                onClick={() => {
                  setLocale(lang.code);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs font-medium transition-colors ${
                  isSelected
                    ? "bg-teal-500/15 text-teal-300"
                    : "text-mist-300 hover:bg-tint hover:text-strong"
                }`}
              >
                <span>{lang.native}</span>
                {isSelected && <Check className="size-3.5 text-teal-400" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
