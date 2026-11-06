import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The design's prompt card: text box, agent chip, round send button. Enter sends, Shift+Enter = newline. */
export function PromptCard(props: {
  /** The agent chip (an AgentPicker). */
  agent: ReactNode;
  onSend: (text: string) => void;
  placeholder: string;
  rows?: number;
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
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-3xl bg-card p-4 ring-1 ring-border">
      <label htmlFor="prompt" className="sr-only">
        Describe what you want to build
      </label>
      <Textarea
        id="prompt"
        rows={props.rows ?? 4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={props.placeholder}
        className="field-sizing-fixed min-h-0 resize-none border-0 bg-transparent px-2 py-1.5 text-lg shadow-none focus-visible:ring-0 md:text-lg dark:bg-transparent"
      />
      <div className="flex items-center gap-2">
        {props.agent}
        <span className="flex-1" />
        {showStop ? (
          <Button
            type="button"
            size="icon"
            onClick={props.onStop}
            disabled={props.disabled}
            aria-label="Stop"
            title="Stop the agent's turn"
            className="size-11 rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            <Square className="size-3.5" fill="currentColor" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            aria-label="Send"
            className="size-11 rounded-full disabled:bg-secondary disabled:text-faint disabled:opacity-100"
          >
            <ArrowUp className="size-4.5" strokeWidth={2.4} />
          </Button>
        )}
      </div>
    </form>
  );
}
