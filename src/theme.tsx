import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type Theme = "dark" | "light";

// Keep in sync with the inline script in index.html, which applies the saved
// theme before first paint.
const STORAGE_KEY = "leeterboard:theme";
const META_COLOR: Record<Theme, string> = { dark: "#0a0d12", light: "#f4f6f9" };

const isTheme = (v: unknown): v is Theme => v === "light" || v === "dark";

function readStored(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null; // storage unavailable — the choice just lasts this session
  }
}

const systemTheme = (): Theme =>
  window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[theme]);
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Saved choice first, otherwise the system setting (and follow it live until
// the person picks one).
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const fromDom = document.documentElement.getAttribute("data-theme");
    return isTheme(fromDom) ? fromDom : readStored() ?? systemTheme();
  });
  const hasChoice = useRef(readStored() !== null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const onChange = () => {
      if (!hasChoice.current) setThemeState(mq.matches ? "light" : "dark");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    hasChoice.current = true;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable — theme still switches for this session.
    }
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => setTheme(theme === "light" ? "dark" : "light"), [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

// Recharts takes colours as plain values rather than CSS classes, so the
// chart palette lives here, next to the theme.
export function chartColors(theme: Theme) {
  return theme === "light"
    ? {
        accent: "#0f766e",
        grid: "rgba(15,23,42,0.08)",
        tick: "#596275",
        cursor: "rgba(15,23,42,0.2)",
        tooltipBg: "#ffffff",
        tooltipBorder: "rgba(15,23,42,0.15)",
        tooltipText: "#0f172a",
        tooltipLabel: "#475569"
      }
    : {
        accent: "#2dd4bf",
        grid: "rgba(255,255,255,0.06)",
        tick: "#7d8799",
        cursor: "rgba(255,255,255,0.18)",
        tooltipBg: "#171c25",
        tooltipBorder: "rgba(255,255,255,0.18)",
        tooltipText: "#e8ebf1",
        tooltipLabel: "#a3acbb"
      };
}
