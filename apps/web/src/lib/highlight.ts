import { useEffect, useState } from "react";
import { bundledLanguages, codeToTokens, type BundledLanguage, type ThemedToken } from "shiki";

/** Shiki's language for a file, by extension (`ts`, `py`, `yml`…) or name (`Dockerfile`,
 * `Makefile`); null = not one it knows, shown as plain text. */
export function languageFor(path: string): BundledLanguage | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  return ext in bundledLanguages ? (ext as BundledLanguage) : null;
}

/**
 * A whole text's syntax tokens, line by line (3v2), from Shiki on `theme` (`useCodeTheme`). The text
 * is highlighted as a whole so multi-line strings and comments come out right. Undefined until
 * ready (the language loads on demand), and for plain text.
 */
export function useLineTokens(text: string | undefined, lang: BundledLanguage | null, theme: string): ThemedToken[][] | undefined {
  const [result, setResult] = useState<{ text: string; theme: string; tokens: ThemedToken[][] }>();
  useEffect(() => {
    if (text === undefined || text === "" || !lang) return;
    let current = true;
    codeToTokens(text, { lang, theme }).then(
      ({ tokens }) => current && setResult({ text, theme, tokens }),
      () => {}, // a language that fails to load: the plain text stays
    );
    return () => {
      current = false;
    };
  }, [text, lang, theme]);
  return result && result.text === text && result.theme === theme ? result.tokens : undefined;
}
