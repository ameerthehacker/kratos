import { lazy, Suspense, useState, type ReactNode } from "react";
import { ArrowLeft, Check, CircleAlert, ListTodo, Map as MapIcon, MessageSquare, Package, Pencil } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { HotkeysProvider, useAppHotkeys, useHotkey } from "@tanstack/react-hotkeys";
import { Streamdown } from "streamdown";
import type { FeatureSummary, Plan, PlanDecision, PlanKind, PlanQuestion } from "@kratos/core";
import { FeatureDoneButton } from "@/components/feature-done-button";
import { Actions, Field, MarkDot, NoteField, StepRow, type Act } from "@/components/plan-parts";
import { sessionTitle } from "@/components/session-status";
import { Shortcut } from "@/components/shortcut";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/hooks/use-plan";
import { useKratos } from "@/lib/kratos-store";
import { SCOPES } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/** CodeMirror (4p4c): its own chunk, loaded when you press Edit — the page and the chat don't carry it. */
const PlanEditor = lazy(() => import("@/components/plan-editor"));

/** Where the link that opened a plan came from (4p1c's links say; else a sensible default). */
export type PlanFrom = { from?: string; label?: string };

/**
 * `/f/:featureId/plan` and `/s/:sessionId/plan` — a whole plan in the main island (4p1b, D79; the
 * design's Plans board §6, §8), with your side of who-writes-what (4p4a): tick or send back a step
 * the agent says is done, accept or ask about a decision, answer a question; or edit its text
 * (4p4b). Esc goes back.
 */
export function PlanPage({ kind }: { kind: PlanKind }) {
  const params = useParams();
  const id = kind === "feature" ? params.featureId : params.sessionId;
  // One page per plan: going from one plan to another (the sidebar's links) mustn't carry an open
  // editor, with the first plan's text and base, over to the second, where Save would write it.
  return <PlanView key={`${kind}:${id}`} kind={kind} id={id} />;
}

function PlanView({ kind, id }: { kind: PlanKind; id: string | undefined }) {
  const plan = usePlan(kind, id);
  const feature = useKratos((s) => s.features.find((f) => f.id === (kind === "feature" ? id : s.sessions.find((x) => x.id === id)?.featureId)));
  const session = useKratos((s) => (kind === "session" ? s.sessions.find((x) => x.id === id) : undefined));
  const send = useKratos((s) => s.send);

  const state = (useLocation().state ?? {}) as PlanFrom;
  const back = state.from ?? (kind === "session" ? `/s/${id}` : "/");
  const backLabel = state.label ?? (kind === "session" ? "Back to the chat" : "Back");
  const navigate = useNavigate();
  const appHotkeys = useAppHotkeys();
  // On the window, like review's: an Esc that closed a popup isn't "back".
  useHotkey(appHotkeys["plan.back"], () => navigate(back), { target: window, ignoreDefaultPrevented: true });

  const owner = kind === "feature" ? feature?.title : session && sessionTitle(session);
  const [editing, setEditing] = useState(false);
  return (
    <HotkeysProvider scope={SCOPES.plan}>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pb-12">
          <div className="flex items-center gap-2">
            <Link to={back} className="group flex h-9 items-center gap-2 rounded-lg pr-1.5 pl-2.5 -ml-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {backLabel}
              <Shortcut id="plan.back" variant="secondary" className="invisible group-hover:visible group-focus-visible:visible" />
            </Link>
            <span className="flex-1" />
            {plan?.markdown != null && !editing && (
              <Button size="sm" variant="ghost" className="rounded-full px-3" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit
              </Button>
            )}
            <KindChip kind={kind} />
          </div>

          {plan === undefined ? null : editing && plan.markdown !== null ? (
            <Suspense fallback={<p className="text-sm text-muted-foreground">Opening the editor…</p>}>
              <PlanEditor markdown={plan.markdown} onSave={(markdown, base) => id && send({ type: "save_plan", owner: { kind, id }, markdown, base })} onDone={() => setEditing(false)} />
            </Suspense>
          ) : plan.plan === null ? (
            <NoPlan kind={kind} owner={owner} done={kind === "feature" && feature?.done === true} onStart={() => id && send({ type: "start_plan", owner: { kind, id } })} />
          ) : (
            <PlanBody
              plan={plan.plan}
              kind={kind}
              context={<Context kind={kind} plan={plan.plan} featureTitle={feature?.title} />}
              feature={kind === "feature" ? feature : undefined}
              act={(action) => id && send({ type: "plan_action", owner: { kind, id }, action })}
            />
          )}
        </div>
      </main>
    </HotkeysProvider>
  );
}

function KindChip({ kind }: { kind: PlanKind }) {
  return (
    <span className="flex h-6 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-xs text-secondary-foreground">
      {kind === "feature" ? <MapIcon className="size-3.5 text-primary" aria-hidden="true" /> : <ListTodo className="size-3.5 text-run" aria-hidden="true" />}
      {kind === "feature" ? "Feature plan" : "Session plan"}
    </span>
  );
}

/** What the plan belongs to, above its title: a feature's progress, or a session's feature. */
function Context({ kind, plan, featureTitle }: { kind: PlanKind; plan: Plan; featureTitle?: string }) {
  const gated = plan.steps.filter((s) => s.id);
  const ticked = gated.filter((s) => s.mark === "ticked").length;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {kind === "session" && !featureTitle ? <MessageSquare className="size-3" aria-hidden="true" /> : <Package className="size-3" aria-hidden="true" />}
      {kind === "feature" ? `Feature · ${ticked} of ${gated.length} ticked` : (featureTitle ?? "One-off")}
    </span>
  );
}

function NoPlan({ kind, owner, done, onStart }: { kind: PlanKind; owner?: string; done: boolean; onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 pt-24 text-center">
      <p className="font-heading text-xl font-semibold">No plan yet</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {kind === "feature" ? `What “${owner ?? "this feature"}” is for, its steps and decisions, written down once for every session working on it.` : `How ${owner ? `“${owner}”` : "this session"} will do its part, step by step.`}
      </p>
      {done ? (
        <p className="text-sm text-muted-foreground">This feature is done; reopen it to plan it.</p>
      ) : (
        <Button className="mt-2 rounded-full px-4" onClick={onStart}>
          Start a plan
        </Button>
      )}
    </div>
  );
}

function PlanBody({ plan, kind, context, feature, act }: { plan: Plan; kind: PlanKind; context: ReactNode; feature?: FeatureSummary; act: Act }) {
  const gated = plan.steps.filter((s) => s.id);
  // Every step yours to tick is ticked: the feature can be finished (never automatic, D73).
  const finished = feature && !feature.done && gated.length > 0 && gated.every((s) => s.mark === "ticked");
  return (
    <article className="flex flex-col gap-7">
      <header className="flex flex-col gap-1">
        {context}
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{plan.title || "Untitled plan"}</h1>
      </header>

      {finished && (
        <div className="flex items-center gap-3 rounded-2xl bg-add/10 px-4 py-3 ring-1 ring-add/25">
          <Check className="size-4 flex-none text-add" aria-hidden="true" />
          <p className="flex-1 text-sm">
            All {gated.length} {gated.length === 1 ? "step" : "steps"} ticked{plan.decisions.some((d) => d.status === "proposed") ? ", but decisions are still waiting for you" : ""}.
          </p>
          <FeatureDoneButton feature={feature} labelled />
        </div>
      )}

      {plan.notes.length > 0 && (
        <div role="status" className="flex gap-3 rounded-2xl bg-wait/10 px-4 py-3 ring-1 ring-wait/25">
          <CircleAlert className="mt-0.5 size-4 flex-none text-wait" aria-hidden="true" />
          <ul className="flex flex-col gap-1 text-sm">
            {plan.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.intent && (
        <Section title={kind === "feature" ? "Intent" : "Approach"}>
          <Streamdown mode="static" className="min-w-0 text-secondary-foreground">
            {plan.intent}
          </Streamdown>
        </Section>
      )}

      <Section title="Steps">
        {plan.steps.length === 0 ? <Empty>No steps yet.</Empty> : plan.steps.map((step, i) => <StepRow key={step.id ?? i} step={step} act={act} />)}
      </Section>

      {(kind === "feature" || plan.decisions.length > 0) && (
        <Section title="Decisions">
          {plan.decisions.length === 0 ? <Empty>None yet.</Empty> : plan.decisions.map((d, i) => <DecisionCard key={d.id ?? i} decision={d} act={act} />)}
        </Section>
      )}

      {plan.questions.length > 0 && (
        <Section title="Open questions">
          {plan.questions.map((q, i) => (
            <QuestionRow key={`${i}:${q.text}`} question={q} act={act} />
          ))}
        </Section>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-faint">{children}</p>;

function DecisionCard({ decision, act }: { decision: PlanDecision; act: Act }) {
  const proposed = decision.status === "proposed";
  const [asking, setAsking] = useState(false);
  const id = decision.id;
  return (
    <div className={cn("flex flex-col gap-1 rounded-xl bg-card px-3 py-2.5", proposed && "ring-1 ring-wait/35")}>
      <p className="flex items-center gap-2 text-sm">
        {decision.id && <span className="font-mono text-xs text-muted-foreground">{decision.id}</span>}
        <span className="flex-1">{decision.title}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs", proposed ? "bg-wait/12 text-wait" : "bg-add/12 text-add")}>{proposed ? "Proposed" : "Accepted"}</span>
      </p>
      {decision.text && <p className="text-xs whitespace-pre-line text-muted-foreground">{decision.text}</p>}
      {/* Proposed: yours to accept, or to question; the question goes to Open questions (4p4a). */}
      {id && proposed &&
        (asking ? (
          <NoteField
            placeholder="Anything to add? (optional)"
            submit="Ask why"
            optional
            onDone={(note) => {
              setAsking(false);
              if (note !== null) act({ kind: "ask_why", decisionId: id, ...(note ? { note } : {}) });
            }}
          />
        ) : (
          <Actions>
            <Button size="sm" className="rounded-full px-3" onClick={() => act({ kind: "accept", decisionId: id })}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" className="rounded-full px-3" onClick={() => setAsking(true)}>
              Ask why
            </Button>
          </Actions>
        ))}
    </div>
  );
}

function QuestionRow({ question, act }: { question: PlanQuestion; act: Act }) {
  const [answering, setAnswering] = useState(false);
  return (
    <div className="-mx-2.5 flex gap-2.5 px-2.5 py-1.5">
      <MarkDot mark={question.answered ? "ticked" : "todo"} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm">{question.text}</p>
        {question.answer && <Field label={question.answered ? "Answer" : "Suggested"}>{question.answer}</Field>}
        {!question.answered &&
          (answering ? (
            <NoteField
              placeholder="Your answer"
              submit="Answer"
              initial={question.answer} // the agent's suggestion, to take or change
              onDone={(answer) => {
                setAnswering(false);
                if (answer) act({ kind: "answer", question: question.text, answer });
              }}
            />
          ) : (
            <Actions>
              <Button size="sm" variant="secondary" className="rounded-full px-3" onClick={() => setAnswering(true)}>
                Answer
              </Button>
            </Actions>
          ))}
      </div>
    </div>
  );
}
