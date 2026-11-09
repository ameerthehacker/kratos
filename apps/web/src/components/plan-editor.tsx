import { useEffect, useRef, useState } from "react";
import CodeMirror, { EditorView, Prec, keymap } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { CircleAlert } from "lucide-react";
import { Shortcut } from "@/components/shortcut";
import { Button } from "@/components/ui/button";
import { PLAN_EDIT_KEYS } from "@/lib/shortcuts";

/**
 * The plan's own text, to edit (4p4b), in CodeMirror (4p4c, D79): saved with ⌘S, dropped with
 * Esc. Saved only over the text you started from; if the plan changes under you (the agent, an
 * editor), it says so: take theirs, or save over it. It closes once the plan comes back as you
 * saved it, so a refused save keeps your text. Loaded only when you press Edit (its own chunk).
 */
export default function PlanEditor({ markdown: current, onSave, onDone }: { markdown: string; onSave: (markdown: string, base: string) => void; onDone: () => void }) {
  const [base, setBase] = useState(current);
  const [text, setText] = useState(current);
  const [saving, setSaving] = useState<string>();
  useEffect(() => {
    if (saving !== undefined && current === saving) onDone(); // saved: back to the plan
  }, [current, saving, onDone]);
  const moved = current !== base && current !== saving;
  const save = () => {
    if (text === base && !moved) return onDone();
    setSaving(text);
    onSave(text, moved ? current : base); // over theirs, when you chose to
    if (moved) setBase(current);
  };
  // CodeMirror keeps the keymap it was made with: it calls whatever these are now.
  const keys = useRef({ save, cancel: onDone });
  keys.current = { save, cancel: onDone };
  const [extensions] = useState(() => [
    markdown({ base: markdownLanguage }), // GFM: the `[ ]` boxes are task markers
    EditorView.lineWrapping,
    syntaxHighlighting(PLAN_HIGHLIGHT),
    EditorView.contentAttributes.of({ "aria-label": "The plan's Markdown", spellcheck: "false" }),
    // Before CodeMirror's own keys. Handled keys are default-prevented, so the page's Esc (back)
    // and the browser's ⌘S (save page) leave them alone.
    Prec.highest(
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (keys.current.save(), true) },
        { key: PLAN_EDIT_KEYS.cancel, run: () => (keys.current.cancel(), true) },
      ]),
    ),
  ]);

  return (
    <div className="flex flex-col gap-3">
      {moved && (
        <div role="status" className="flex items-center gap-3 rounded-2xl bg-wait/10 px-4 py-2.5 ring-1 ring-wait/25">
          <CircleAlert className="size-4 flex-none text-wait" aria-hidden="true" />
          <p className="flex-1 text-sm">The plan changed while you were editing.</p>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full px-3"
            onClick={() => {
              setText(current);
              setBase(current);
            }}
          >
            Load theirs
          </Button>
        </div>
      )}
      <CodeMirror
        value={text}
        onChange={setText}
        autoFocus
        theme={PLAN_THEME}
        extensions={extensions}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false, closeBrackets: false }}
        minHeight="24rem" // CodeMirror sizes itself in CSS lengths; matches the textarea it replaced (min-h-96)
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" className="rounded-full px-3" onClick={onDone}>
          Cancel
          <Shortcut hotkey={PLAN_EDIT_KEYS.cancel} variant="secondary" />
        </Button>
        <Button className="rounded-full px-3.5" onClick={save}>
          {moved ? "Save over it" : "Save"}
          <Shortcut hotkey={PLAN_EDIT_KEYS.save} variant="secondary" />
        </Button>
      </div>
    </div>
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
