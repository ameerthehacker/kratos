import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The prompt box (owner's design A, 3d1): a short placeholder, 16px text that grows as you type,
 * a soft accent glow while focused, the agent chip, keyboard hints and a round send button.
 * Enter sends, Shift+Enter = newline.
 */
export function PromptCard(props: {
  /** The agent chip (an AgentPicker). */
  agent: ReactNode;
  onSend: (text: string) => void;
  placeholder: string;
  /** "large" on Home (room for a first description), "compact" for replies. */
  size?: "large" | "compact";
  disabled?: boolean;
  /** The agent is working: with an empty box, the send button becomes Stop (3c2b). */
  onStop?: () => void;
}) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !props.disabled;
  const showStop = props.onStop !== undefined && text.trim().length === 0;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    props.onSend(text.trim());
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3.5 rounded-3xl bg-card py-3 pr-3 pl-4.5 ring-1 ring-border outline-4 outline-transparent transition-[box-shadow,outline-color] focus-within:ring-primary/55 focus-within:outline-primary/8"
    >
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
        {props.agent}
        <span className="flex-1" />
        <span className="hidden font-mono text-xs text-faint sm:inline" aria-hidden="true">
          ↵ send · ⇧↵ new line
        </span>
        {showStop ? (
          <Button
            type="button"
            size="icon"
            onClick={props.onStop}
            disabled={props.disabled}
            aria-label="Stop"
            title="Stop the agent's turn"
            className="size-9 rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            <Square className="size-3.5" fill="currentColor" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            aria-label="Send"
            className="size-9 rounded-full disabled:bg-secondary disabled:text-faint disabled:opacity-100"
          >
            <ArrowUp className="size-4.5" strokeWidth={2.4} />
          </Button>
        )}
      </div>
    </form>
  );
}
