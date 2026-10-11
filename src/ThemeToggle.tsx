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
      className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-ink-800 text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
