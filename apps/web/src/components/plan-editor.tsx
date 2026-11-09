import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import MarkdownCode from "@/components/markdown-code";
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
      <MarkdownCode
        value={text}
        onChange={setText}
        label="The plan's Markdown"
        autoFocus
        keys={{ "Mod-s": save, [PLAN_EDIT_KEYS.cancel]: onDone }}
        minHeight="24rem" // matches the textarea it replaced (min-h-96)
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
