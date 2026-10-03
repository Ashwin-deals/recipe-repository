import { useCallback, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "cartchef:theme";

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light/dark theme. Follows the system until the user picks one, then remembers it. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    setTheme(next);
  }, []);
  return [theme, toggle];
}
