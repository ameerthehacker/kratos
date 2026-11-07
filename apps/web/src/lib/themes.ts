import { useEffect } from "react";
import { THEMES, type ThemeId } from "@kratos/core";
import { useKratos } from "@/lib/kratos-store";

/** How each theme is named in quick settings (3w1, the design's names); colours live in index.css. */
const NAMES: Record<ThemeId, { label: string; short: string; dark: boolean }> = {
  "kratos-dark": { label: "Kratos Dark", short: "Kratos", dark: true },
  "kratos-light": { label: "Kratos Light", short: "Light", dark: false },
  graphite: { label: "Graphite", short: "Graphite", dark: true },
  midnight: { label: "Midnight", short: "Midnight", dark: true },
  forest: { label: "Forest", short: "Forest", dark: true },
  paper: { label: "Paper", short: "Paper", dark: false },
  mist: { label: "Mist", short: "Mist", dark: false },
  contrast: { label: "High contrast", short: "Contrast", dark: true },
};

/** The themes in the design's order. */
export const THEME_LIST = THEMES.map((id) => ({ id, ...NAMES[id] }));

/** Where this browser remembers the last theme it showed; index.html applies it before the first
 * paint, so a reload doesn't flash the default while the WebSocket connects. */
const CACHE_KEY = "kratos-theme";

/** Show `id` on the page: `data-theme` for the colours, `dark` for shadcn's dark variants. */
export function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  root.dataset.theme = id;
  root.classList.toggle("dark", NAMES[id].dark);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ id, dark: NAMES[id].dark }));
  } catch {
    // private window or blocked storage: only the reload flash comes back
  }
}

/** Keeps the page on the theme Kratos has saved (mount once, in the layout). */
export function useTheme(): void {
  const theme = useKratos((s) => s.settings?.theme);
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
}
