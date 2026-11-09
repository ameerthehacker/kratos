import { ListTodo } from "lucide-react";
import { Streamdown } from "streamdown";
import type { PermissionDecision, PlanSave } from "@kratos/core";
import { Shortcut } from "@/components/shortcut";
import type { Step } from "@/lib/timeline";

/** Where the session is, for what approving a plan makes (4p6a). */
export type PlanWhere = { inFeature: boolean; featureHasPlan: boolean; featureTitle?: string };

/** Keep planning's answer: your note, or why the plan goes back. */
export const keepPlanning = (note: string, empty: boolean): PermissionDecision => ({
  decision: "deny",
  message: note.trim() || (empty ? "Your plan came without its text. Present the whole plan, in the plan format, for approval." : "Keep planning: the owner wants changes before approving."),
});

/**
 * A plan the agent proposes (4p6a; the design's Plans board §2, §8), in the ask dock: the plan
 * itself, what approving makes — and the one switch there is — then Keep planning (your note goes
 * back), Approve, build later, or Approve and build here (⌘↵).
 */
export function PlanReview(props: {
  step: Step;
  agent: string;
  where: PlanWhere;
  busy: boolean;
  /** Why the server didn't take your last answer (the ask is open again). */
  refused?: string;
  /** Presented without its text: only Keep planning. */
  empty: boolean;
  /** Your note for Keep planning (kept by the dock, so ⌘⌫ sends it too). */
  note: string;
  onNote: (note: string) => void;
  /** Where it'll be saved now, and the other place it could go, if any. */
  saveAs: PlanSave;
  other?: PlanSave;
  onSwitch: () => void;
  decide: (decision: PermissionDecision, savePlanAs?: PlanSave) => void;
}) {
  const { where, saveAs, other, empty, note } = props;
  const plan = props.step.plan ?? "";
  const title = /^#\s+(.+)$/m.exec(plan)?.[1]?.trim();
  const feature = where.featureTitle ? `“${where.featureTitle}”` : "its feature";
  const makes =
    saveAs === "session"
      ? where.inFeature
        ? `this session's plan for its part of ${feature}`
        : "this session's plan"
      : where.inFeature
        ? `the plan of ${feature}`
        : "a new feature, with this as its plan";
  // `approvedPlan` offers "feature" only to a one-off, "session" only in a feature without a plan.
  const switchTo = other === "feature" ? "Make it a feature" : other === "session" ? "Just this session" : undefined;
  const sendBack = () => props.decide(keepPlanning(note, empty));
  return (
    <div role="group" aria-label={`${props.agent} has a plan`} className="mb-2 flex flex-col gap-2.5 rounded-2xl bg-card p-3.5 ring-1 ring-border">
      <div className="flex items-center gap-2.5">
        <span className="flex size-6.5 flex-none items-center justify-center rounded-full bg-wait/10 text-wait" aria-hidden="true">
          <ListTodo className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 text-secondary-foreground">
          {props.agent} has a plan{title && <>: <span className="text-foreground">{title}</span></>}
        </span>
        <span className="rounded-full bg-wait/10 px-2 py-0.5 text-xs text-wait">Waiting for you</span>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-xl bg-well px-4 py-3">
        {empty ? (
          <p className="text-sm text-wait">The plan came without its text, so there's nothing to approve yet. Keep planning asks for the whole plan.</p>
        ) : (
          <Streamdown mode="static" className="min-w-0 text-sm">
            {plan}
          </Streamdown>
        )}
      </div>
      {props.refused && (
        <p role="alert" className="rounded-xl bg-wait/10 px-3.5 py-2 text-sm text-wait">
          {props.refused}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Approving saves it as {makes}.
        {switchTo && (
          <>
            {" "}
            <button type="button" disabled={props.busy} onClick={props.onSwitch} className="text-foreground underline underline-offset-4 hover:text-primary disabled:opacity-50">
              {switchTo}
            </button>
          </>
        )}
      </p>
      {/* The note on its own row, the three answers under it: in the chat's width they don't fit on one. */}
      <input
          value={note}
          onChange={(e) => props.onNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && note.trim() && !props.busy) sendBack();
          }}
          aria-label="What should change? Goes back with Keep planning"
          placeholder="What should change? (Keep planning)"
          className="h-8 w-full rounded-full bg-secondary px-3.5 text-sm outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
        />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={props.busy}
          onClick={sendBack}
          className="inline-flex h-8 items-center gap-2 rounded-full bg-secondary pr-1.5 pl-3.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Keep planning
          <Shortcut id="ask.deny" variant="secondary" />
        </button>
        <button
          type="button"
          disabled={props.busy || empty}
          onClick={() => props.decide({ decision: "deny", message: "build later" }, saveAs)}
          className="inline-flex h-8 items-center rounded-full bg-secondary px-3.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Approve, build later
        </button>
        <button
          type="button"
          disabled={props.busy || empty}
          onClick={() => props.decide({ decision: "allow" }, saveAs)}
          className="inline-flex h-8 items-center gap-2 rounded-full bg-foreground pr-1.5 pl-4 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Approve and build here
          <Shortcut id="ask.allow" variant="inverse" />
        </button>
      </div>
    </div>
  );
}
