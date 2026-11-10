import type { ReactNode } from "react";
import { ListTodo, Map as MapIcon, Maximize2, X } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { ownersSteps, progressOf, type FeatureSummary, type Plan, type PlanStep, type SessionSummary } from "@kratos/core";
import { StepRow, startOnStep, type Act } from "@/components/plan-parts";
import { sessionTitle } from "@/components/session-status";
import { Hint, Shortcut } from "@/components/shortcut";
import { usePlan } from "@/hooks/use-plan";
import { useKratos } from "@/lib/kratos-store";
import { usePlansPrefs } from "@/lib/plans-prefs";
import { cn } from "@/lib/utils";
import type { PlanFrom } from "@/pages/plan";

/** A session's plans (4p5a): its feature's, when it's in a feature that has one, and its own. */
export function useSessionPlans(sessionId: string | undefined) {
  const session = useKratos((s) => s.sessions.find((x) => x.id === sessionId));
  const feature = useKratos((s) => (session?.featureId ? s.features.find((f) => f.id === session.featureId) : undefined));
  const featurePlan = usePlan("feature", feature?.hasPlan ? feature.id : undefined)?.plan ?? undefined;
  const sessionPlan = usePlan("session", session?.hasPlan ? session.id : undefined)?.plan ?? undefined;
  return { session, feature, featurePlan, sessionPlan, offered: Boolean(featurePlan || sessionPlan) };
}

/** Whether a session has a plan to show (its own, or its feature's): from the lists' flags, so the
 * toggle and ⌥⌘B don't load the plans themselves. */
export function usePlansOffered(sessionId: string | undefined): boolean {
  return useKratos((s) => {
    const session = s.sessions.find((x) => x.id === sessionId);
    if (!session) return false;
    return session.hasPlan || (session.featureId !== null && s.features.some((f) => f.id === session.featureId && f.hasPlan));
  });
}

/**
 * The plans island (4p5a; the design's Plans board §8): beside a session's chat, the glance — its
 * feature plan's step in hand, with your tick, and this session's plan as a checklist; ⤢ opens
 * either whole. Not offered without a plan; shown or hidden with ⌥⌘B, remembered.
 */
export function PlansIsland({ sessionId }: { sessionId: string }) {
  const { session, feature, featurePlan, sessionPlan, offered } = useSessionPlans(sessionId);
  const open = usePlansPrefs((s) => s.open);
  const setOpen = usePlansPrefs((s) => s.setOpen);
  const send = useKratos((s) => s.send);
  if (!offered || !open || !session) return null;
  const from: PlanFrom = { from: `/s/${session.id}`, label: sessionTitle(session) };
  return (
    // An island like the others (owner's layout): rounded, on the canvas; the chat needs the room
    // below lg, so it's not shown there.
    <aside aria-label="Plans" className="hidden w-80 flex-none flex-col gap-1 overflow-y-auto rounded-3xl bg-background pb-4 lg:flex">
      <div className="flex items-center gap-1.5 pt-3 pr-2.5 pl-5">
        <h2 className="flex-1 text-xs font-semibold tracking-wider text-faint uppercase">Plans</h2>
        <Shortcut id="plans.toggle" />
        <Hint label="Hide plans" id="plans.toggle">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Hide plans"
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </Hint>
      </div>
      {feature && featurePlan && (
        <FeaturePart
          feature={feature}
          plan={featurePlan}
          stepId={session.stepId}
          from={from}
          act={(action) => send({ type: "plan_action", owner: { kind: "feature", id: feature.id }, action })}
        />
      )}
      {featurePlan && sessionPlan && <div className="mx-5 my-2 h-px bg-border" />}
      {sessionPlan && (
        <SessionPart
          session={session}
          plan={sessionPlan}
          from={from}
          act={(action) => send({ type: "plan_action", owner: { kind: "session", id: session.id }, action })}
        />
      )}
    </aside>
  );
}

/** Its feature plan: how far along, and the step in hand — this session's own first (4p5b), then
 * those waiting for your tick or being worked on — or, with none, the next to do (▶ starts a
 * session on it). */
function FeaturePart({ feature, plan, stepId, from, act }: { feature: FeatureSummary; plan: Plan; stepId: string | null; from: PlanFrom; act: Act }) {
  const navigate = useNavigate();
  const steps = ownersSteps(plan);
  const { ticked } = progressOf(plan);
  const mine = stepId ? steps.find((s) => s.id === stepId && s.mark !== "ticked") : undefined; // a ticked one is done, not now
  const now = [...(mine ? [mine] : []), ...steps.filter((s) => s !== mine && (s.mark === "claimed" || s.mark === "doing"))];
  const next = steps.find((s) => s.mark === "todo");
  return (
    <section aria-label="Feature plan" className="flex flex-col gap-3 px-5 pt-2">
      <Opener to={`/f/${feature.id}/plan`} from={from} label={`Open the feature plan: ${feature.title}`}>
        <MapIcon className="size-3.5 flex-none text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Feature plan · {feature.title}</span>
        <span className="font-mono text-faint">
          {ticked}/{steps.length}
        </span>
      </Opener>
      {steps.length > 0 && <Progress steps={steps} />}
      {now.length > 0 ? (
        <Group label="Now">
          {now.map((step, i) => (
            <StepRow key={`${i}:${step.id}`} step={step} act={act} compact />
          ))}
        </Group>
      ) : next ? (
        <Group label="Up next">
          <StepRow
            step={next}
            act={act}
            compact
            onStart={feature.done ? undefined : () => navigate(startOnStep(feature.id, next.id!))}
          />
        </Group>
      ) : (
        steps.length > 0 && <p className="text-xs text-muted-foreground">All {steps.length} steps ticked.</p>
      )}
    </section>
  );
}

/** This session's own plan: how it does its part, as a checklist. */
function SessionPart({ session, plan, from, act }: { session: SessionSummary; plan: Plan; from: PlanFrom; act: Act }) {
  const done = plan.steps.filter((s) => s.mark === "ticked").length;
  return (
    <section aria-label="This session's plan" className="flex flex-col gap-1 px-5 pt-2">
      <Opener to={`/s/${session.id}/plan`} from={from} label="Open this session's plan">
        <ListTodo className="size-3.5 flex-none text-run" aria-hidden="true" />
        <span className="flex-1 text-xs font-semibold tracking-wider uppercase">How · this session</span>
        <span className="font-mono text-faint">
          {done}/{plan.steps.length}
        </span>
      </Opener>
      {plan.steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No steps yet.</p>
      ) : (
        plan.steps.map((step, i) => <StepRow key={`${i}:${step.id}`} step={step} act={act} compact />) // ids may repeat
      )}
    </section>
  );
}

/** A plan's line that opens it whole (⤢), saying where you came from so its way back does. */
function Opener({ to, from, label, children }: { to: string; from: PlanFrom; label: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      state={from}
      aria-label={label}
      className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-secondary-foreground hover:bg-accent"
    >
      {children}
      <Maximize2 className="size-3 flex-none text-faint" aria-hidden="true" />
    </Link>
  );
}

const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs font-semibold tracking-wider text-faint uppercase">{label}</span>
    {children}
  </div>
);

/** One segment per step: ticked, waiting for you, in hand, to do. */
function Progress({ steps }: { steps: PlanStep[] }) {
  return (
    <div className="flex gap-0.75" aria-hidden="true">
      {steps.map((step, i) => (
        <span
          key={`${i}:${step.id}`} // two steps may share an id (the plan's notes say so)
          className={cn(
            "h-1 flex-1 rounded-full",
            step.mark === "ticked" ? "bg-add" : step.mark === "claimed" ? "bg-wait" : step.mark === "doing" ? "bg-run" : "bg-input",
          )}
        />
      ))}
    </div>
  );
}
