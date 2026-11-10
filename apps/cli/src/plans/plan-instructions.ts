/**
 * What every session's agent is told about its plans (4p2, D79): where they are, the format Kratos
 * reads (plan-file.ts), and who writes what. Given as standing instructions when the agent starts;
 * paths are relative to the project, where the agent works.
 */

export interface PlanPaths {
  /** This session's own plan: how it does its part. */
  session: string;
  /** Its feature's plan (what and why, across sessions), when it's in one; `step`: the step of it
   * this session was started on (4p5b). */
  feature?: { title: string; path: string; step?: { id: string; title?: string } };
}

export const PLAN_FORMAT = `# <title>

## Intent
What and why, in prose. (A session plan may call this section Approach.)

## Steps
- [ ] **P1. <short title>** — the goal in a line.
  Scope: \`path/or/glob\`, \`another/**\`
  Accept: what will prove it works.
- [ ] **P2. …**

## Decisions
- **D1. <the decision>** (proposed) — why. Instead of: … Reverse: …

## Open questions
- [ ] <a question for the owner>`;

export function planInstructions({ session, feature }: PlanPaths): string {
  const where = feature
    ? [
        `- The feature plan, for “${feature.title}”: what and why, shared by every session working on it: ${feature.path}`,
        `- This session's plan: how this session does its part (usually one step of the feature plan): ${session}`,
        ...(feature.step ? [`- This session was started on step ${feature.step.id}${feature.step.title ? ` (“${feature.step.title}”)` : ""} of the feature plan: that's its part.`] : []),
      ]
    : [`- This session's plan: ${session} (this session isn't part of a feature; its plan is the whole plan)`];
  return `## Plans (Kratos)

You are working in Kratos, which keeps the plan for this work in Markdown files in the project. Kratos reads them, shows them to the owner, and holds every session to them, so they are the source of truth: read the plans that exist before you start, and keep them true as you work.

${where.join("\n")}

A file that doesn't exist yet hasn't been started. Write plans exactly in this format (other sections are kept but not read):

${PLAN_FORMAT}

Step marks: [ ] to do, [~] in hand, [?] done and waiting for the owner, [x] ticked by the owner.

Who writes what:
- A step with an id (P1, S1) is the owner's to tick. Mark the one you're on [~]; when it's done, mark it [?] and add a "Proof:" line saying what you ran and what it showed. Never write [x] on it yourself.
- A step the owner sent back is [~] again with a "Not yet:" line saying why: address it, then mark it [?] with a new Proof (you may remove the Not yet line then).
- A step without an id is your own checklist item: tick it [x] yourself.
- Ids are never reused or renumbered; split a step as P3a, P3b.
- Add decisions as (proposed); only the owner accepts them. Add open questions; only the owner answers them.
- The owner's questions to you (like "Why D2 (…)?") are open questions too: answer with an "Answer:" line under the question; it stays open until the owner answers it.
- The Intent is the owner's once a plan is approved: propose a change instead of rewriting it.${
    feature ? "\n- New steps and decisions belong in the feature plan; this session's plan holds how you do your step." : ""
  }
- When you plan, write the plan in this format. In plan mode, write it only where plan mode itself tells you to, and present it for the owner's approval; don't write the plan files above while planning: Kratos saves the approved plan where it belongs and tells you where.${
    feature
      ? " If the feature plan hasn't been started, the plan you write is the feature plan; otherwise it is this session's plan."
      : ""
  }`;
}

/** The note on the next prompt after a session moved while its agent was running (its standing
 * instructions still name the old plans). */
export function movedNote(paths: PlanPaths): string {
  const to = paths.feature
    ? `This session is now part of the feature “${paths.feature.title}”; its feature plan is ${paths.feature.path}.`
    : "This session is no longer part of a feature; its own plan is the whole plan.";
  return `[Kratos] ${to} This session's plan is still ${paths.session}. Read the plans before going on.`;
}
