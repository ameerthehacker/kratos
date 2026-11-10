import { lazy, Suspense, useState } from "react";
import { ListTodo, Maximize2 } from "lucide-react";
import { Streamdown } from "streamdown";
import type { PermissionDecision, PlanSave } from "@kratos/core";
import { Shortcut } from "@/components/shortcut";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { codePlugin } from "@/lib/appearance";
import type { Step } from "@/lib/timeline";

/** Where the session is, for what approving a plan makes (4p6a). `sessionHasPlan`: approving it as
 * this session's plan replaces that one. */
export type PlanWhere = { inFeature: boolean; featureHasPlan: boolean; featureTitle?: string; sessionHasPlan?: boolean };

/** CodeMirror for Edit (4p6b): the plan page's editor's part, loaded only when you press Edit. */
const MarkdownCode = lazy(() => import("@/components/markdown-code"));

/** Keep planning's answer: your note, or why the plan goes back; with your edits (4p6b), the
 * version to start from. */
export const keepPlanning = (note: string, empty: boolean, edited?: string): PermissionDecision => {
  const why = note.trim() || (empty ? "Your plan came without its text. Present the whole plan, in the plan format, for approval." : "Keep planning: the owner wants changes before approving.");
  return { decision: "deny", message: edited === undefined ? why : `${why}\n\nThe owner edited your plan; start from this version:\n\n${edited}` };
};

/** The card's answers, built once by the dock (its ⌘↵ / ⌘⌫ send the same ones). */
export interface PlanAnswers {
  approve: () => void;
  buildLater: () => void;
  keepPlanning: () => void;
  /** Something to approve: it came with its text, and wasn't edited down to nothing. */
  canApprove: boolean;
}

/**
 * A plan the agent proposes (4p6a; the design's Plans board §2, §8), in the ask dock: the plan
 * itself, what approving makes — and the one switch there is — then Keep planning (your note goes
 * back), Approve, build later, or Approve and build here (⌘↵). Read / Edit (4p6b): approving saves
 * your version, and the agent builds from it. ⤢ reads it full screen, answers and all.
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
  /** Your version of the plan, when it differs from the agent's (kept by the dock, so ⌘↵ sends it too). */
  edited?: string;
  onDraft: (text: string) => void;
  /** Where it'll be saved now, and the other place it could go, if any. */
  saveAs: PlanSave;
  other?: PlanSave;
  onSwitch: () => void;
  answers: PlanAnswers;
}) {
  const { where, saveAs, other, empty, edited } = props;
  const plan = edited ?? props.step.plan ?? "";
  const [editing, setEditing] = useState(false);
  const [full, setFull] = useState(false);
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
  // The other place: a one-off's own plan ↔ a new feature; in a feature without a plan, its plan ↔
  // just this session's.
  const switchTo = other === "session" ? "Just this session" : other === "feature" ? (where.inFeature ? `Make it ${feature}'s plan` : "Make it a feature") : undefined;
  const header = (
    <div className="flex items-center gap-2.5">
      <span className="flex size-6.5 flex-none items-center justify-center rounded-full bg-wait/10 text-wait" aria-hidden="true">
        <ListTodo className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-secondary-foreground">
        {props.agent} has a plan{title && <>: <span className="text-foreground">{title}</span></>}
      </span>
      {edited !== undefined && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">You edited it</span>}
      {!empty && <ReadEdit editing={editing} onChange={setEditing} />}
      {!full && !empty && (
        <button
          type="button"
          onClick={() => setFull(true)}
          aria-label="Read the plan full screen"
          title="Full screen"
          className="flex size-7 flex-none items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Maximize2 className="size-3.5" />
        </button>
      )}
      <span className="rounded-full bg-wait/10 px-2 py-0.5 text-xs text-wait">Waiting for you</span>
    </div>
  );
  const body = (size: "card" | "full") => (
    <PlanBody
      plan={plan}
      empty={empty}
      editing={editing}
      size={size}
      onDraft={props.onDraft}
      // Handled in the editor (default-prevented), so Esc leaves it instead of stopping the agent
      // or closing full screen, and ⌘↵ approves instead of CodeMirror's "insert blank line".
      onEscape={() => setEditing(false)}
      onApprove={() => !props.busy && props.answers.canApprove && props.answers.approve()}
    />
  );
  const answers = (
    <>
      {props.refused && (
        <p role="alert" className="rounded-xl bg-wait/10 px-3.5 py-2 text-sm text-wait">
          {props.refused}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Approving saves it as {makes}
        {saveAs === "session" && where.sessionHasPlan ? ", in place of the one it has" : ""}.
        {switchTo && (
          <>
            {" "}
            <button type="button" disabled={props.busy} onClick={props.onSwitch} className="text-foreground underline underline-offset-4 hover:text-primary disabled:opacity-50">
              {switchTo}
            </button>
          </>
        )}
      </p>
      <Answers busy={props.busy} note={props.note} onNote={props.onNote} answers={props.answers} />
    </>
  );
  return (
    <div role="group" aria-label={`${props.agent} has a plan`} className="mb-2 flex flex-col gap-2.5 rounded-2xl bg-card p-3.5 ring-1 ring-border">
      {header}
      {body("card")}
      {answers}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent
          showCloseButton={false}
          // Full screen, the island's width for reading; Esc closes it (only it: not the agent's Stop).
          className="flex h-11/12 flex-col gap-3 rounded-3xl bg-card p-5 sm:max-w-4xl"
          onKeyDown={(e) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            e.preventDefault();
            setFull(false);
          }}
        >
          <DialogTitle className="sr-only">{title ?? "The plan"}</DialogTitle>
          {header}
          {body("full")}
          {answers}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReadEdit({ editing, onChange }: { editing: boolean; onChange: (editing: boolean) => void }) {
  return (
    <div className="flex rounded-full bg-secondary p-0.5" role="radiogroup" aria-label="Read or edit the plan">
      {(["Read", "Edit"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={editing === (mode === "Edit")}
          onClick={() => onChange(mode === "Edit")}
          className={
            editing === (mode === "Edit")
              ? "h-6.5 rounded-full bg-card px-3 text-xs text-foreground ring-1 ring-border"
              : "h-6.5 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

/** The plan, to read (Streamdown, code highlighted as in replies) or edit (CodeMirror). */
function PlanBody(props: {
  plan: string;
  empty: boolean;
  editing: boolean;
  size: "card" | "full";
  onDraft: (text: string) => void;
  onEscape: () => void;
  onApprove: () => void;
}) {
  const full = props.size === "full";
  if (props.editing && !props.empty) {
    return (
      <Suspense fallback={<p className="px-1 text-sm text-muted-foreground">Opening the editor…</p>}>
        <div className={full ? "min-h-0 flex-1" : undefined}>
          <MarkdownCode
            value={props.plan}
            onChange={props.onDraft}
            label="The plan, to edit before approving"
            keys={{ Escape: props.onEscape, "Mod-Enter": props.onApprove }}
            autoFocus
            {...(full ? { fill: true } : { minHeight: "12rem", maxHeight: "18rem" })}
          />
        </div>
      </Suspense>
    );
  }
  return (
    <div className={full ? "min-h-0 flex-1 overflow-y-auto rounded-xl bg-well px-6 py-5" : "max-h-72 overflow-y-auto rounded-xl bg-well px-4 py-3"}>
      {props.empty ? (
        <p className="text-sm text-wait">The plan came without its text, so there's nothing to approve yet. Keep planning asks for the whole plan.</p>
      ) : (
        <Streamdown mode="static" plugins={{ code: codePlugin }} className={full ? "min-w-0" : "min-w-0 text-sm"}>
          {props.plan}
        </Streamdown>
      )}
    </div>
  );
}

/** Your note for Keep planning, and the three answers under it: in the chat's width they don't fit on one row. */
function Answers({ busy, note, onNote, answers }: { busy: boolean; note: string; onNote: (note: string) => void; answers: PlanAnswers }) {
  return (
    <>
      <input
        value={note}
        onChange={(e) => onNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && note.trim() && !busy) answers.keepPlanning();
          // Leaves the field; not the agent's Stop (which would withdraw this plan, and your edits).
          if (e.key === "Escape") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        maxLength={2000}
        aria-label="What should change? Goes back with Keep planning"
        placeholder="What should change? (Keep planning)"
        className="h-8 w-full rounded-full bg-secondary px-3.5 text-sm outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={answers.keepPlanning}
          className="inline-flex h-8 items-center gap-2 rounded-full bg-secondary pr-1.5 pl-3.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Keep planning
          <Shortcut id="ask.deny" variant="secondary" />
        </button>
        <button
          type="button"
          disabled={busy || !answers.canApprove}
          onClick={answers.buildLater}
          className="inline-flex h-8 items-center rounded-full bg-secondary px-3.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Approve, build later
        </button>
        <button
          type="button"
          disabled={busy || !answers.canApprove}
          onClick={answers.approve}
          className="inline-flex h-8 items-center gap-2 rounded-full bg-foreground pr-1.5 pl-4 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Approve and build here
          <Shortcut id="ask.allow" variant="inverse" />
        </button>
      </div>
    </>
  );
}
