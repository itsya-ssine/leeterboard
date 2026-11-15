import React, { createContext, useContext, useEffect, useMemo } from "react";

export type Theme = "dark";

const STORAGE_KEY = "leeterboard:theme";
const META_COLOR = "#0a0d12";

function applyTheme() {
  document.documentElement.setAttribute("data-theme", "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR);
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable
    }
    applyTheme();
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: "dark",
      setTheme: () => {},
      toggle: () => {}
    }),
    []
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

// Recharts takes colours as plain values rather than CSS classes, so the
// chart palette lives here, next to the theme. Dark mode is the only site theme.
const DARK_CHART_COLORS = {
  accent: "#2dd4bf",
  accentB: "#fbbf24",
  grid: "rgba(255,255,255,0.06)",
  tick: "#7d8799",
  cursor: "rgba(255,255,255,0.18)",
  tooltipBg: "#171c25",
  tooltipBorder: "rgba(255,255,255,0.18)",
  tooltipText: "#e8ebf1",
  tooltipLabel: "#a3acbb"
};

export function chartColors(_theme?: Theme) {
  return DARK_CHART_COLORS;
}
