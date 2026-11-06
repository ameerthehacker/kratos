import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The design's prompt card: text box, agent chip, round send button. Enter sends, Shift+Enter = newline. */
export function PromptCard(props: {
  agent: string;
  onSend: (text: string) => void;
  placeholder: string;
  rows?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !props.disabled;

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
        className="field-sizing-fixed min-h-0 resize-none border-0 bg-transparent px-2 py-1.5 text-[17px] leading-relaxed shadow-none focus-visible:ring-0 md:text-[17px] dark:bg-transparent"
      />
      <div className="flex items-center gap-2">
        <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] text-secondary-foreground">
          <span className="size-[7px] rounded-full bg-primary" aria-hidden="true" />
          {props.agent}
        </span>
        <span className="flex-1" />
        <Button
          type="submit"
          size="icon"
          disabled={!canSend}
          aria-label="Send"
          className="size-11 rounded-full disabled:bg-secondary disabled:text-faint disabled:opacity-100"
        >
          <ArrowUp className="size-[18px]" strokeWidth={2.4} />
        </Button>
      </div>
    </form>
  );
}
