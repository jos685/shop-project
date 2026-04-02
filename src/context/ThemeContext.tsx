import { createContext, useContext } from "react";
import type { ReactNode } from "react";
const theme = {
  bg: {
    base:    "#080c12",
    card:    "#0d1117",
    sidebar: "#090d14",
    input:   "rgba(255,255,255,0.04)",
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
    focus:   "rgba(6,182,212,0.5)",
    accent:  "rgba(6,182,212,0.3)",
  },
  font: {
    display: "'Syne', sans-serif",
    body:    "'DM Sans', sans-serif",
    mono:    "'DM Mono', monospace",
  },
  radius: {
    sm: 10,
    md: 12,
    lg: 14,
    xl: 18,
  },
};

type Theme = typeof theme;
const ThemeContext = createContext<{ theme: Theme }>(null!);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={{ theme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
