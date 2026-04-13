import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";

const darkTheme = {
  isDark: true,
  bg: {
    base:    "#080c12",
    card:    "#0d1117",
    sidebar: "#090d14",
    input:   "rgba(255,255,255,0.04)",
    overlay: "rgba(0,0,0,0.80)",
    nav:     "rgba(8,12,18,0.97)",
    hover:   "rgba(255,255,255,0.04)",
    modal:   "#0d1117",
  },
  text: {
    primary:   "#f9fafb",
    secondary: "#9ca3af",
    muted:     "#4b5563",
  },
  accent: {
    primary:      "#06b6d4",
    primaryLight: "#67e8f9",
    cyan:         "#06b6d4",
    gold:         "#eab308",
    green:        "#34d399",
    red:          "#f87171",
  },
  border: {
    default: "rgba(255,255,255,0.07)",
    subtle:  "rgba(255,255,255,0.04)",
    focus:   "rgba(6,182,212,0.5)",
    accent:  "rgba(6,182,212,0.3)",
    nav:     "rgba(6,182,212,0.18)",
  },
  font: {
    display: "'Syne', sans-serif",
    body:    "'DM Sans', sans-serif",
    mono:    "'DM Mono', monospace",
  },
  radius: { sm: 10, md: 12, lg: 14, xl: 18 },
  // CSS string for .ki input class — injected into <style> tags
  kiCss: `
    .ki { background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:11px 13px;color:#f9fafb;font-size:14px;font-family:'DM Mono',monospace;width:100%;box-sizing:border-box; }
    .ki:focus { outline:none;border-color:rgba(6,182,212,0.5); }
    .ki::placeholder { color:#374151; }
  `,
};

const lightTheme = {
  isDark: false,
  bg: {
    base:    "#f0f4f8",
    card:    "#ffffff",
    sidebar: "#e8edf3",
    input:   "rgba(0,0,0,0.04)",
    overlay: "rgba(0,0,0,0.55)",
    nav:     "rgba(255,255,255,0.97)",
    hover:   "rgba(0,0,0,0.03)",
    modal:   "#ffffff",
  },
  text: {
    primary:   "#0f172a",
    secondary: "#475569",
    muted:     "#94a3b8",
  },
  accent: {
    primary:      "#0284c7",
    primaryLight: "#0ea5e9",
    cyan:         "#0284c7",
    gold:         "#d97706",
    green:        "#059669",
    red:          "#dc2626",
  },
  border: {
    default: "rgba(0,0,0,0.09)",
    subtle:  "rgba(0,0,0,0.04)",
    focus:   "rgba(2,132,199,0.5)",
    accent:  "rgba(2,132,199,0.3)",
    nav:     "rgba(2,132,199,0.15)",
  },
  font: {
    display: "'Syne', sans-serif",
    body:    "'DM Sans', sans-serif",
    mono:    "'DM Mono', monospace",
  },
  radius: { sm: 10, md: 12, lg: 14, xl: 18 },
  kiCss: `
    .ki { background:rgba(0,0,0,0.04);border:1px solid rgba(0,0,0,0.12);border-radius:10px;padding:11px 13px;color:#0f172a;font-size:14px;font-family:'DM Mono',monospace;width:100%;box-sizing:border-box; }
    .ki:focus { outline:none;border-color:rgba(2,132,199,0.5); }
    .ki::placeholder { color:#94a3b8; }
  `,
};

export type Theme = typeof darkTheme;

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>(null!);

const STORAGE_KEY = "pos_theme_mode";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== "light"; } catch { return true; }
  });

  const theme = isDark ? darkTheme : lightTheme;

  useEffect(() => {
    document.body.style.background = theme.bg.base;
    document.body.style.color      = theme.text.primary;
  }, [isDark, theme.bg.base, theme.text.primary]);

  const toggleTheme = () => {
    setIsDark(d => {
      const next = !d;
      try { localStorage.setItem(STORAGE_KEY, next ? "dark" : "light"); } catch {}
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
