import { useRef, useState } from "react";
import CodeMirror, { EditorView, Prec, keymap } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * A plan's Markdown in CodeMirror (4p4c, D79), in the app's own colors: the plan page's editor and
 * the plan card's Edit (4p6b). `keys`: CodeMirror key names (`Mod-s`, `Escape`) to what they do,
 * before its own keys and default-prevented, so the page's Esc (back) and the browser's ⌘S leave
 * them alone. Imported lazily by both, so neither the chat nor the plan page carries it.
 */
export default function MarkdownCode(props: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  keys?: Record<string, () => void>;
  minHeight?: string;
  maxHeight?: string;
  /** Fills its box (full screen): `height` 100%, the wrapper too. */
  fill?: boolean;
  autoFocus?: boolean;
}) {
  // CodeMirror keeps the keymap it was made with: it calls whatever these are now.
  const keys = useRef(props.keys ?? {});
  keys.current = props.keys ?? {};
  const [extensions] = useState(() => [
    markdown({ base: markdownLanguage }), // GFM: the `[ ]` boxes are task markers
    EditorView.lineWrapping,
    syntaxHighlighting(PLAN_HIGHLIGHT),
    EditorView.contentAttributes.of({ "aria-label": props.label, spellcheck: "false" }),
    Prec.highest(
      keymap.of(
        Object.keys(props.keys ?? {}).map((key) => ({
          key,
          preventDefault: true,
          run: () => {
            keys.current[key]?.();
            return true;
          },
        })),
      ),
    ),
  ]);
  return (
    <CodeMirror
      value={props.value}
      onChange={props.onChange}
      autoFocus={props.autoFocus}
      theme={PLAN_THEME}
      extensions={extensions}
      basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false, closeBrackets: false }}
      // CodeMirror sizes itself in CSS lengths, not classes.
      minHeight={props.minHeight}
      maxHeight={props.maxHeight}
      height={props.fill ? "100%" : undefined}
      className={props.fill ? "h-full" : undefined}
    />
  );
}

/** The editor in the app's own colors: its theme variables, so it follows every theme (3w1),
 * light or dark, with no CodeMirror theme of its own. (CodeMirror's theme is plain CSS-in-JS, so
 * these are its values, not Tailwind classes.) */
const PLAN_THEME = EditorView.theme({
  "&": { backgroundColor: "var(--well)", color: "var(--foreground)", borderRadius: "1rem" },
  "&.cm-focused": { outline: "2px solid var(--ring)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "0.875rem", lineHeight: "1.65" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 16px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--run) 30%, transparent)",
  },
  ".cm-searchMatch": { backgroundColor: "color-mix(in oklab, var(--wait) 30%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)", borderRadius: "0 0 1rem 1rem" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-textfield": { backgroundColor: "var(--well)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: "0.5rem" },
  ".cm-button": { backgroundImage: "none", backgroundColor: "var(--secondary)", color: "var(--foreground)", border: "none", borderRadius: "0.5rem" },
});

/** Markdown the way the plan page reads it: headings strong, the `[ ]` boxes and ids standing out,
 * the punctuation of the syntax quiet. */
const PLAN_HIGHLIGHT = HighlightStyle.define([
  { tag: t.heading, fontWeight: "600", color: "var(--foreground)" },
  { tag: t.heading1, fontSize: "1.15em" },
  { tag: t.strong, fontWeight: "600", color: "var(--foreground)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.atom, color: "var(--wait)", fontWeight: "600" }, // task markers: [ ] [x]
  { tag: t.monospace, color: "var(--run)" },
  { tag: [t.link, t.url], color: "var(--run)" },
  { tag: t.quote, color: "var(--muted-foreground)", fontStyle: "italic" },
  // #, -, **, ---: the marks, not what they mark (`list` would be a whole list's text).
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--faint)" },
]);
