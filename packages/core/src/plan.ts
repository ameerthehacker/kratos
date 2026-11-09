import { z } from "zod";

/**
 * A plan as Kratos read it from its file (D79). Feature plans and session plans share one plain
 * Markdown format; the file is the source of truth and this is only what was read from it, for
 * the UI. Nothing is refused: what didn't read cleanly is in `notes`.
 */

/** `[ ]` to do · `[~]` in hand · `[?]` the agent says done · `[x]` ticked by you. */
export const StepMark = z.enum(["todo", "doing", "claimed", "ticked"]);
export type StepMark = z.infer<typeof StepMark>;

export const PlanStep = z.object({
  /** `P3`, `S2`. A step with an id is yours to tick; one without is the agent's own (D79). */
  id: z.string().optional(),
  title: z.string(),
  mark: StepMark,
  goal: z.string().optional(),
  /** Files and globs the step may change, from its `Scope:` line. */
  scope: z.array(z.string()),
  accept: z.string().optional(),
  /** What the agent ran and saw, written when it says the step is done. */
  proof: z.string().optional(),
  /** Why you sent it back (4p4a): its `Not yet:` line, for the agent to address. */
  notYet: z.string().optional(),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const DecisionStatus = z.enum(["proposed", "accepted"]);
export type DecisionStatus = z.infer<typeof DecisionStatus>;

export const PlanDecision = z.object({
  id: z.string().optional(),
  title: z.string(),
  status: DecisionStatus,
  /** Everything after the title: the decision, why, instead of what, how to reverse. */
  text: z.string(),
});
export type PlanDecision = z.infer<typeof PlanDecision>;

export const PlanQuestion = z.object({ text: z.string(), answered: z.boolean(), answer: z.string().optional() });
export type PlanQuestion = z.infer<typeof PlanQuestion>;

/** A feature plan (what and why, across sessions) or a session plan (how one session does its part). */
export const PlanKind = z.enum(["feature", "session"]);
export type PlanKind = z.infer<typeof PlanKind>;

/** Your side of who-writes-what (4p4a): one change to a plan, made from its page. */
export const PlanAction = z.discriminatedUnion("kind", [
  /** A step is done: `[x]`. */
  z.object({ kind: z.literal("tick"), stepId: z.string() }),
  /** Not done yet: back to `[~]`, with your note as its `Not yet:` line for the agent. */
  z.object({ kind: z.literal("not_yet"), stepId: z.string(), note: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal("accept"), decisionId: z.string() }),
  /** An open question for the agent: "Why D2 (<title>)? <note>". */
  z.object({ kind: z.literal("ask_why"), decisionId: z.string(), note: z.string().trim().max(500).optional() }),
  /** An open question answered, found by its text. */
  z.object({ kind: z.literal("answer"), question: z.string(), answer: z.string().trim().min(1).max(2000) }),
]);
export type PlanAction = z.infer<typeof PlanAction>;

/** Where an approved plan is saved (4p6a): this session's own plan, or its feature's. */
export const PlanSave = z.enum(["session", "feature"]);
export type PlanSave = z.infer<typeof PlanSave>;

/**
 * What approving a proposed plan makes (D79, board §8), from where the session is, and the one
 * switch there is: a one-off's plan is its own (or "Make it a feature"); in a feature without a
 * plan it's the feature's (or "Just this session"); in a feature with one, it's this session's
 * plan for its step — the feature's isn't overwritten from plan mode.
 */
export function approvedPlan(where: { inFeature: boolean; featureHasPlan: boolean }): { save: PlanSave; or?: PlanSave } {
  if (!where.inFeature) return { save: "session", or: "feature" };
  if (!where.featureHasPlan) return { save: "feature", or: "session" };
  return { save: "session" };
}

export const Plan = z.object({
  title: z.string(),
  /** `## Intent` (a session plan may call it `## Approach`). */
  intent: z.string().optional(),
  steps: z.array(PlanStep),
  decisions: z.array(PlanDecision),
  questions: z.array(PlanQuestion),
  /** What didn't read cleanly, in words, for you and the agent. */
  notes: z.array(z.string()),
});
export type Plan = z.infer<typeof Plan>;
