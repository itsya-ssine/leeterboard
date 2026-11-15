import React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme.js";

// Header button that flips between the light and dark theme. The icon shows
// the theme you'll switch to.
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "light" ? "dark" : "light";
  const Icon = next === "light" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={toggle}
      id="theme-toggle-btn"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center border-2 border-ink-700 bg-ink-900 text-mist-100 shadow-[2px_2px_0_#000] transition-transform duration-75 hover:border-mist-400 hover:bg-ink-800 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
