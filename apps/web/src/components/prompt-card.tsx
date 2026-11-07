import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { AttachmentPolicy, AttachmentUpload } from "@kratos/core";
import { AttachButton, DraftList, DropOverlay, FileNotes } from "@/components/attachments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDraftFiles } from "@/hooks/use-draft-files";
import { cn } from "@/lib/utils";

/**
 * The prompt box (owner's design A, 3d1): a short placeholder, 16px text that grows as you type,
 * a soft accent glow while focused, the agent and permission chips and a round send button.
 * Enter sends, Shift+Enter = newline. The key-cap hints were dropped to make room for the mode
 * chip (owner, 3q2 design option A). Files (3s2, design 1 + B): "+" first in the row, drop them on
 * the card, or paste; shown above the text, checked before sending (`useDraftFiles`).
 */
export function PromptCard(props: {
  /** The chips on the left of the bottom row: AgentPicker and PermissionPicker. */
  chips: ReactNode;
  onSend: (text: string, attachments: AttachmentUpload[]) => void;
  /** What the harness accepts (D55); without it, no "+" and no dropping files. */
  attachments?: AttachmentPolicy;
  placeholder: string;
  /** "large" on Home (room for a first description), "compact" for replies. */
  size?: "large" | "compact";
  disabled?: boolean;
  /** The agent is working: with an empty box, the send button becomes Stop (3c2b). */
  onStop?: () => void;
}) {
  const [text, setText] = useState("");
  const files = useDraftFiles(props.attachments);
  const canSend = text.trim().length > 0 && !props.disabled && !files.failed;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    props.onSend(text.trim(), files.take());
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <form
        {...files.rootProps({ onSubmit: submit })}
        role={undefined} // react-dropzone marks its root "presentation"; this is a real form
        className={cn(
          "relative flex flex-col gap-3.5 rounded-3xl bg-card py-3 pr-3 pl-4.5 ring-1 ring-border outline-4 outline-transparent transition-[box-shadow,outline-color] focus-within:ring-primary/55 focus-within:outline-primary/8",
          files.failed && "ring-destructive/60 focus-within:ring-destructive/60",
        )}
      >
        {files.dragging && props.attachments && <DropOverlay policy={props.attachments} />}
        <input {...files.inputProps()} />
        <DraftList drafts={files.drafts} onRemove={files.remove} />
        <label htmlFor="prompt" className="sr-only">
          Describe what you want to build
        </label>
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
          <SendButton stop={props.onStop !== undefined && text.trim().length === 0 ? props.onStop : undefined} canSend={canSend} disabled={props.disabled} />
        </div>
      </form>
      <FileNotes error={files.failed?.error} note={files.note} />
    </div>
  );
}

/** Send — or, while the agent works and the box is empty, Stop (3c2b). */
function SendButton({ stop, canSend, disabled }: { stop?: () => void; canSend: boolean; disabled?: boolean }) {
  if (stop) {
    return (
      <Button
        type="button"
        size="icon"
        onClick={stop}
        disabled={disabled}
        aria-label="Stop"
        title="Stop the agent's turn"
        className="size-9 rounded-full bg-foreground text-background hover:bg-foreground/90"
      >
        <Square className="size-3.5" fill="currentColor" />
      </Button>
    );
  }
  return (
    <Button type="submit" size="icon" disabled={!canSend} aria-label="Send" className="size-9 rounded-full disabled:bg-secondary disabled:text-faint disabled:opacity-100">
      <ArrowUp className="size-4.5" strokeWidth={2.4} />
    </Button>
  );
}
