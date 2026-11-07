import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, ListPlus, Square } from "lucide-react";
import type { AttachmentPolicy, AttachmentUpload } from "@kratos/core";
import { AttachButton, DraftList, DropOverlay, FileNotes } from "@/components/attachments";
import { Hint, Shortcut } from "@/components/shortcut";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDraftFiles } from "@/hooks/use-draft-files";
import { PROMPT_KEYS } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/**
 * The prompt box (owner's design A, 3d1): a short placeholder, 16px text that grows as you type,
 * a soft accent glow while focused, the agent and permission chips and a round send button.
 * Enter sends, Shift+Enter = newline. The key-cap hints were dropped to make room for the mode
 * chip (owner, 3q2 design option A). Files (3s2, design 1 + B): "+" first in the row, drop them on
 * the card, or paste; shown above the text, checked before sending (`useDraftFiles`). While the
 * agent works (3t3, the steering design): Enter queues — the send button becomes "Queue" — and
 * ⌘↵ / Ctrl↵ sends now, stopping the current step. With nothing to send, ⌘↵ is left to the page
 * (it allows a waiting ask, 3k3). Empty and unfocused, a faint / says how to get here.
 */
export function PromptCard(props: {
  /** The chips on the left of the bottom row: AgentPicker and PermissionPicker. */
  chips: ReactNode;
  onSend: (text: string, attachments: AttachmentUpload[], options: { now: boolean }) => void;
  /** What the harness accepts (D55); without it, no "+" and no dropping files. */
  attachments?: AttachmentPolicy;
  placeholder: string;
  /** "large" on Home (room for a first description), "compact" for replies. */
  size?: "large" | "compact";
  disabled?: boolean;
  /** The agent is working: with an empty box, the send button becomes Stop (3c2b); with text, it
   * queues (D56). */
  onStop?: () => void;
  /** Text to add to the box (a queued prompt being edited, or what Stop gave back); a new `key`
   * adds it again. */
  insert?: { text: string; key: number };
}) {
  const [text, setText] = useState("");
  const files = useDraftFiles(props.attachments);
  const canSend = text.trim().length > 0 && !props.disabled && !files.failed;
  const working = props.onStop !== undefined;

  // Text handed back (Edit on a queued prompt, or Stop): add it to what's already in the box.
  useEffect(() => {
    if (props.insert) setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${props.insert!.text}` : props.insert!.text));
  }, [props.insert]);

  const submit = (event?: FormEvent, now = false) => {
    event?.preventDefault();
    if (!canSend) return;
    props.onSend(text.trim(), files.take(), { now: now && working });
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    const now = event.metaKey || event.ctrlKey;
    if (now && !canSend) return; // not ours: the page's ⌘↵ (allow) sees it unhandled
    submit(event, now);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <form
        {...files.rootProps({ onSubmit: submit })}
        role={undefined} // react-dropzone marks its root "presentation"; this is a real form
        className={cn(
          "group/prompt relative flex flex-col gap-3.5 rounded-3xl bg-card py-3 pr-3 pl-4.5 ring-1 ring-border outline-4 outline-transparent transition-[box-shadow,outline-color] focus-within:ring-primary/55 focus-within:outline-primary/8",
          files.failed && "ring-destructive/60 focus-within:ring-destructive/60",
        )}
      >
        {files.dragging && props.attachments && <DropOverlay policy={props.attachments} />}
        <input {...files.inputProps()} />
        <DraftList drafts={files.drafts} onRemove={files.remove} />
        <label htmlFor="prompt" className="sr-only">
          Describe what you want to build
        </label>
        {!text && files.drafts.length === 0 && (
          <Shortcut id="prompt.focus" variant="faint" className="absolute top-4 right-3.5 group-focus-within/prompt:hidden" />
        )}
        <Textarea
          id="prompt"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={props.placeholder}
          className={cn(
            // Grows with its content up to max-h, then scrolls (CSS field-sizing).
            "field-sizing-content max-h-60 resize-none border-0 bg-transparent px-0 py-1 text-base shadow-none placeholder:text-faint focus-visible:ring-0 md:text-base dark:bg-transparent",
            props.size === "compact" ? "min-h-8" : "min-h-14",
          )}
        />
        <div className="flex items-center gap-2">
          {props.attachments && <AttachButton onClick={files.openPicker} disabled={props.disabled || files.full} />}
          {/* min-w-0: in a very narrow window the chips' text truncates and send stays in the card
              (no phone layout: mobile will be its own app — owner). */}
          <div className="flex min-w-0 flex-1 items-center gap-2">{props.chips}</div>
          <SendButton
            stop={working && text.trim().length === 0 ? props.onStop : undefined}
            queue={working}
            canSend={canSend}
            disabled={props.disabled}
          />
        </div>
      </form>
      <FileNotes error={files.failed?.error} note={files.note} />
    </div>
  );
}

/** Send — or, while the agent works, Stop with an empty box (3c2b) and Queue with text (D56): the
 * button changes so you see what Enter will do before you press it (the design). */
function SendButton(props: { stop?: () => void; queue: boolean; canSend: boolean; disabled?: boolean }) {
  const { stop, canSend, disabled } = props;
  if (stop) {
    return (
      <Hint label="Stop the agent's turn" id="agent.stop" side="top">
        <Button
          type="button"
          size="icon"
          onClick={stop}
          disabled={disabled}
          aria-label="Stop"
          className="size-9 rounded-full bg-foreground text-background hover:bg-foreground/90"
        >
          <Square className="size-3.5" fill="currentColor" />
        </Button>
      </Hint>
    );
  }
  if (props.queue) {
    return (
      <Hint
        side="top"
        label={
          <>
            Queue <Shortcut hotkey={PROMPT_KEYS.send} variant="tooltip" /> · send now <Shortcut hotkey={PROMPT_KEYS.sendNow} variant="tooltip" />
          </>
        }
      >
        <Button type="submit" size="icon" disabled={!canSend} aria-label="Queue" className="size-9 rounded-full">
          <ListPlus className="size-4.5" />
        </Button>
      </Hint>
    );
  }
  return (
    <Button type="submit" size="icon" disabled={!canSend} aria-label="Send" className="size-9 rounded-full disabled:bg-secondary disabled:text-faint disabled:opacity-100">
      <ArrowUp className="size-4.5" strokeWidth={2.4} />
    </Button>
  );
}
