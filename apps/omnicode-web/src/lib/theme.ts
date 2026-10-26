import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS } from "#/lib/config";

export type Theme = "dark" | "light";

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.theme);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Storage can throw in private-mode browsers; fall through to the OS.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  } catch {
    // A failed write only costs persistence, not the current session's theme.
  }
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(current => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
