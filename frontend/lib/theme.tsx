"use client";
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

export const THEME_KEY = "tresrz-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialise from the <html data-theme> attribute that the inline boot script
  // in layout.tsx sets before paint — keeps SSR markup and client in sync.
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document !== "undefined") {
      const t = document.documentElement.dataset.theme;
      if (t === "light" || t === "dark") return t;
    }
    return "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
