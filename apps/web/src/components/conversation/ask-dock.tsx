import { useState } from "react";
import { useAppHotkeys, useHotkey } from "@tanstack/react-hotkeys";
import { approvedPlan, type PermissionDecision, type PlanSave } from "@kratos/core";
import { keepPlanning, PlanReview, type PlanWhere } from "@/components/conversation/plan-review";
import { Preview } from "@/components/conversation/preview";
import { Shortcut } from "@/components/shortcut";
import { useKratos } from "@/lib/kratos-store";
import type { Step } from "@/lib/timeline";

/** Answer a permission ask (the hub routes it to the session that asked; first answer wins).
 * `savePlanAs`: a proposed plan, approved, saved there (4p6a). */
export type Decide = (askId: string, decision: PermissionDecision, savePlanAs?: PlanSave, planText?: string) => void;

/**
 * The open permission ask, docked above the composer (owner's option C, 3c3): "Claude Code wants
 * to write notes.txt", a readable preview of exactly what will happen, Deny / Allow. With several
 * open asks the oldest comes first. The step in the chat just says "Waiting for you".
 * ⌘↵ allows and ⌘⌫ denies (3k3), their keys inside the buttons (the design). A proposed plan is
 * its own card (4p6a): ⌘↵ approves it to build here, ⌘⌫ keeps planning.
 */
export function AskDock(props: { asks: Step[]; agent: string; onDecide: Decide; where: PlanWhere }) {
  const [sent, setSent] = useState<{ askId: string; at: number } | null>(null); // until the server settles it
  const step = props.asks[0];
  const askId = step?.ask?.id;
  // Refused since you answered (a plan it couldn't save, 4p6a): the ask is open again, saying why.
  const lastError = useKratos((s) => s.lastError);
  const refused = sent && sent.askId === askId && lastError && lastError.at > sent.at ? lastError.message : undefined;
  const busy = sent?.askId === askId && !refused;
  const decide = (decision: PermissionDecision, savePlanAs?: PlanSave, planText?: string) => {
    if (!askId) return;
    setSent({ askId, at: performance.now() });
    props.onDecide(askId, decision, savePlanAs, planText);
  };
  // A plan: where approving saves it, by default or as you switched it (this ask only).
  const isPlan = step?.kind === "plan";
  const goes = approvedPlan(props.where);
  const [switched, setSwitched] = useState<string | null>(null);
  const saveAs = switched === askId && goes.or ? goes.or : goes.save;
  const other = saveAs === goes.save ? goes.or : goes.save;
  // Your note for Keep planning, for this ask only (a revised plan starts without the last one's).
  const [note, setNote] = useState({ askId: "", text: "" });
  const planNote = note.askId === askId ? note.text : "";
  // Your version of the plan, for this ask only (4p6b): sent when it differs from the agent's.
  const [draft, setDraft] = useState({ askId: "", text: "" });
  const planDraft = draft.askId === askId ? draft.text : undefined;
  const edited = isPlan && planDraft !== undefined && planDraft !== (step?.plan ?? "") ? planDraft : undefined;
  // A plan presented without its text (or edited down to nothing): nothing to approve, only Keep planning.
  const emptyPlan = isPlan && !step?.plan?.trim();
  const noApprove = emptyPlan || (edited !== undefined && !edited.trim());
  const appHotkeys = useAppHotkeys();
  // ⌘↵ in the prompt with text to send is the prompt's "send now": it handles it first.
  useHotkey(appHotkeys["ask.allow"], () => decide({ decision: "allow" }, isPlan ? saveAs : undefined, edited), {
    enabled: !!askId && !busy && !noApprove,
    ignoreDefaultPrevented: true,
  });
  // ⌘⌫ while typing deletes the line, as always; we only take it when there's nothing to delete.
  useHotkey(
    appHotkeys["ask.deny"],
    (event) => {
      if (typing(event.target)) return;
      event.preventDefault();
      decide(isPlan ? keepPlanning(planNote, emptyPlan, edited) : DENY);
    },
    { enabled: !!askId && !busy, preventDefault: false },
  );
  if (!step?.ask) return null;
  if (isPlan) {
    return (
      <PlanReview
        key={askId} // Read / Edit start over with each plan
        step={step}
        agent={props.agent}
        where={props.where}
        busy={busy}
        refused={refused}
        empty={emptyPlan}
        note={planNote}
        onNote={(text) => setNote({ askId: askId ?? "", text })}
        edited={edited}
        onDraft={(text) => setDraft({ askId: askId ?? "", text })}
        saveAs={saveAs}
        other={other}
        onSwitch={() => setSwitched(switched === askId ? null : (askId ?? null))}
        decide={decide}
      />
    );
  }

  return (
    <div role="group" aria-label={`${props.agent} needs your OK`} className="mb-2 flex flex-col gap-2 rounded-2xl bg-card py-2.5 pr-2.5 pl-3.5 ring-1 ring-border">
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1 text-secondary-foreground">
          {props.agent} wants to <span className="text-foreground">{lowerFirst(step.intent)}</span>
          {props.asks.length > 1 && <span className="text-muted-foreground"> · 1 of {props.asks.length}</span>}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(DENY)}
          className="inline-flex h-8 items-center gap-2 rounded-full bg-secondary pr-1.5 pl-3.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Deny
          <Shortcut id="ask.deny" variant="secondary" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide({ decision: "allow" })}
          className="inline-flex h-8 items-center gap-2 rounded-full bg-foreground pr-1.5 pl-4 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Allow
          <Shortcut id="ask.allow" variant="inverse" />
        </button>
      </div>
      {step.ask.reason && <div className="text-sm text-muted-foreground">{step.ask.reason}</div>}
      <Preview step={step} />
    </div>
  );
}

const DENY: PermissionDecision = { decision: "deny", message: "The owner denied this in Kratos." };

/** A text field with something in it, or an editor (the plan card's CodeMirror, 4p6b): ⌘⌫ there
 * means "delete to the line start". */
const typing = (target: EventTarget | null) =>
  ((target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && target.value.length > 0) ||
  (target instanceof HTMLElement && target.isContentEditable);

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
