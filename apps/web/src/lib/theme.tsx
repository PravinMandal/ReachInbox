import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";

interface TogglePoint {
  clientX: number;
  clientY: number;
}

const Ctx = createContext<{ theme: Theme; toggle: (at?: TogglePoint) => void }>({
  theme: "light",
  toggle: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("ri-theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("ri-theme", theme);
  }, [theme]);

  /**
   * Cinematic theme wipe: a circle expands from the click point (View Transitions
   * API, `::view-transition-new(root)` + `theme-wipe` keyframes in index.css).
   * Falls back to an instant swap where unsupported; disabled entirely under
   * `prefers-reduced-motion`.
   */
  const toggle = useCallback((at?: TogglePoint) => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduce) {
      setTheme((t) => (t === "dark" ? "light" : "dark"));
      return;
    }
    const root = document.documentElement;
    root.style.setProperty("--tx", `${at?.clientX ?? window.innerWidth - 44}px`);
    root.style.setProperty("--ty", `${at?.clientY ?? 44}px`);
    document.startViewTransition(() => {
      // Flush synchronously so the transition captures the new theme frame.
      flushSync(() => setTheme((t) => (t === "dark" ? "light" : "dark")));
    });
  }, []);

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme(): { theme: Theme; toggle: (at?: TogglePoint) => void } {
  return useContext(Ctx);
}
