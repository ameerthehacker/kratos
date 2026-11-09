import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { PlanAction, PlanStep, StepMark } from "@kratos/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A plan's parts shared by its page (4p1b, 4p4a) and the plans island (4p5a). */

/** Your change to a plan, sent as `plan_action` (4p4a). */
export type Act = (action: PlanAction) => void;

const MARK_LABEL: Record<StepMark, string> = { todo: "To do", doing: "In hand", claimed: "Done, waiting for your tick", ticked: "Ticked" };

/** A step's state as the design draws it: an empty ring, a blue dot in hand, a yellow one waiting
 * for your tick, a green check ticked. */
export function MarkDot({ mark }: { mark: StepMark }) {
  return (
    <span
      role="img"
      aria-label={MARK_LABEL[mark]}
      className={cn(
        "mt-0.5 flex size-4.5 flex-none items-center justify-center rounded-full border-2",
        mark === "todo" && "border-input",
        mark === "doing" && "border-run",
        mark === "claimed" && "border-wait",
        mark === "ticked" && "border-add bg-add text-primary-foreground",
      )}
    >
      {mark === "ticked" && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
      {mark === "doing" && <span className="size-2 rounded-full bg-run" />}
      {mark === "claimed" && <span className="size-2 rounded-full bg-wait" />}
    </span>
  );
}

/** A plan step: its mark, id, title and fields; on a `[?]` step, Tick / Not yet (4p4a). `compact`
 * (the plans island, 4p5a): the title and what it waits on, without its Scope / Accept / Proof. */
export function StepRow({ step, act, compact }: { step: PlanStep; act: Act; compact?: boolean }) {
  const [sendingBack, setSendingBack] = useState(false);
  const id = step.id;
  return (
    <div className={cn("-mx-2.5 flex gap-2.5 rounded-xl px-2.5 py-2", step.mark === "claimed" && "bg-card ring-1 ring-wait/35")}>
      <MarkDot mark={step.mark} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={cn("text-sm", step.mark === "ticked" && "text-muted-foreground")}>
          {step.id && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{step.id}</span>}
          {step.title}
        </p>
        {step.goal && !compact && <p className="text-xs text-muted-foreground">{step.goal}</p>}
        {step.scope.length > 0 && !compact && (
          <div className="flex flex-wrap gap-1.5">
            {step.scope.map((path) => (
              <span key={path} className="rounded-full bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
                {path}
              </span>
            ))}
          </div>
        )}
        {step.accept && !compact && <Field label="Accept">{step.accept}</Field>}
        {step.proof && !compact && <Field label="Proof">{step.proof}</Field>}
        {step.notYet && <Field label="Not yet" tone="wait">{step.notYet}</Field>}
        {/* The agent says it's done: yours to tick, or to send back with why (4p4a). */}
        {id && step.mark === "claimed" &&
          (sendingBack ? (
            <NoteField
              placeholder="What's missing? The agent reads it in the plan"
              submit="Send back"
              onDone={(note) => {
                setSendingBack(false);
                if (note) act({ kind: "not_yet", stepId: id, note });
              }}
            />
          ) : (
            <Actions>
              <Button size="sm" className="rounded-full px-3" onClick={() => act({ kind: "tick", stepId: id })}>
                Tick {id}
              </Button>
              <Button size="sm" variant="ghost" className="rounded-full px-3" onClick={() => setSendingBack(true)}>
                Not yet
              </Button>
            </Actions>
          ))}
      </div>
    </div>
  );
}

export const Actions = ({ children }: { children: ReactNode }) => <div className="flex items-center gap-1.5 pt-1">{children}</div>;

/** A note in place (4p4a): Enter sends it (`optional`: also empty), Esc drops it — not also the
 * page's Esc (back). */
export function NoteField(props: { placeholder: string; submit: string; initial?: string; optional?: boolean; onDone: (note: string | null) => void }) {
  const [note, setNote] = useState(props.initial ?? "");
  return (
    <form
      className="flex items-center gap-1.5 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim() || props.optional) props.onDone(note.trim());
      }}
    >
      <input
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault(); // the page's Esc skips a handled one
          props.onDone(null);
        }}
        aria-label={props.placeholder}
        placeholder={props.placeholder}
        className="h-7 min-w-0 flex-1 rounded-full bg-secondary px-3 text-sm outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button type="submit" size="sm" className="rounded-full px-3" disabled={!note.trim() && !props.optional}>
        {props.submit}
      </Button>
    </form>
  );
}

export const Field = ({ label, tone, children }: { label: string; tone?: "wait"; children: ReactNode }) => (
  <p className={cn("text-xs", tone === "wait" ? "text-wait" : "text-muted-foreground")}>
    <span className={cn("font-medium", tone !== "wait" && "text-secondary-foreground")}>{label}:</span> {children}
  </p>
);
