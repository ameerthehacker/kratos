import { createCodePlugin } from "@streamdown/code";
import { useKratos } from "@/lib/kratos-store";
import { isDarkTheme } from "@/lib/themes";

/**
 * How code looks everywhere in the UI: reply code blocks (Streamdown), raw commands (react-shiki)
 * and the diff (Shiki tokens). One place on purpose — it becomes a user setting later (owner, PLAN
 * "Settings"). Any Shiki bundled theme names work; light themes get the light one (3x1).
 */
export const CODE_THEMES = { light: "github-light", dark: "github-dark" } as const;

/** Streamdown's code plugin: both themes, switched by the page's `dark` class. */
export const codePlugin = createCodePlugin({ themes: [CODE_THEMES.light, CODE_THEMES.dark] });

/** The code theme for the app's current theme, for code we colour ourselves (commands, the diff). */
export function useCodeTheme(): (typeof CODE_THEMES)[keyof typeof CODE_THEMES] {
  const theme = useKratos((s) => s.settings?.theme);
  // Before settings arrive, index.html has already applied the cached theme's `dark` class.
  const dark = theme ? isDarkTheme(theme) : document.documentElement.classList.contains("dark");
  return dark ? CODE_THEMES.dark : CODE_THEMES.light;
}
