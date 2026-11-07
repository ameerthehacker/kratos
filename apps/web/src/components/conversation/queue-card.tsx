import { Clock, Pencil, X, Zap } from "lucide-react";

export type QueuedPrompt = { id: string; text: string };

/**
 * Prompts sent while the agent works that it hasn't read yet (3t3, the steering design): one card
 * right above the composer, in the order the agent will read them. No "read after the current
 * step" line: that's already known (owner). Per row: Send now (stops the
 * current step and sends this one; the rest stay queued), Edit (back into the box), Remove.
 */
export function QueueCard(props: {
  queue: QueuedPrompt[];
  onSendNow: (id: string) => void;
  onEdit: (prompt: QueuedPrompt) => void;
  onRemove: (id: string) => void;
}) {
  if (props.queue.length === 0) return null;
  return (
    <section aria-label="Queued prompts" className="mb-2 flex flex-col gap-1 rounded-2xl bg-card p-2.5 ring-1 ring-border">
      <div className="flex items-center gap-2 px-1 pb-1 text-xs">
        <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-secondary-foreground">{props.queue.length} queued</span>
      </div>
      <ol className="flex flex-col">
        {props.queue.map((prompt, i) => (
          <li key={prompt.id} className="group flex items-start gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-accent/50">
            <span className="w-4 pt-0.5 text-right font-mono text-xs text-faint">{i + 1}</span>
            <span className="line-clamp-2 min-w-0 flex-1 text-sm whitespace-pre-wrap">{prompt.text}</span>
            <button
              type="button"
              onClick={() => props.onSendNow(prompt.id)}
              aria-label="Send now"
              title="Stops the current step and sends this right away"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 text-xs text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Zap className="size-3.5" aria-hidden="true" />
              Send now
            </button>
            <RowButton label="Edit" onClick={() => props.onEdit(prompt)}>
              <Pencil className="size-3.5" />
            </RowButton>
            <RowButton label="Remove" onClick={() => props.onRemove(prompt.id)}>
              <X className="size-3.5" />
            </RowButton>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RowButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  );
}
