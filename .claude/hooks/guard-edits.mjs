// Kratos v0 guardrail: PreToolUse hook for Edit/Write/MultiEdit/NotebookEdit. Budget model: D24.
// 1. Edits must be inside the active step's scope (.kratos/current-step.json).
// 2. The step's estimate must fit its budget before any code is written (split first).
// 3. Review load = NEW lines (insertions) in in-scope files, minus config/lockfiles/docs.
//    ≥ 80% of budget → warn the agent to wrap up; > 100% → stop: owner extends / checkpoints / splits.
// Planning docs are always writable so a step can be declared in the first place.
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import picomatch from "picomatch";
import { simpleGit } from "simple-git";
import { z } from "zod";

const ALWAYS_WRITABLE = ["PLAN.md", "DECISIONS.md", "CLAUDE.md", ".kratos/**"];
const NOT_REVIEW_LOAD = [
  ...ALWAYS_WRITABLE, "**/*.md", "**/pnpm-lock.yaml", "**/package-lock.json", "**/yarn.lock",
  "**/package.json", "**/tsconfig*.json",
];
const WARN_AT = 0.8;

const Step = z.object({
  id: z.string(),
  title: z.string(),
  scope: z.array(z.string()).min(1),
  /** Expected new lines of reviewable code, stated before starting. */
  estimate: z.number().int().nonnegative(),
  diffBudget: z.number().int().positive().default(150),
  /** Extra globs that aren't review load for this step (e.g. generated fixtures). */
  exclude: z.array(z.string()).default([]),
  /** Owner-approved budget extensions; only add one after the owner says yes. */
  extensions: z.array(z.object({ lines: z.number().int().positive(), reason: z.string().min(1) })).default([]),
});

const isMatch = (path, globs) => globs.length > 0 && picomatch.isMatch(path, globs, { dot: true });

const input = JSON.parse(readFileSync(0, "utf8"));
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!target) process.exit(0);

const rel = relative(root, resolve(root, target)).split("\\").join("/");
if (rel.startsWith("..")) process.exit(0); // outside the repo: not our business
if (isMatch(rel, ALWAYS_WRITABLE)) process.exit(0);

const stepFile = resolve(root, ".kratos/current-step.json");
if (!existsSync(stepFile)) {
  deny(`No active step. Add the step to PLAN.md and declare it in .kratos/current-step.json ` +
    `({ "id", "title", "scope": [globs], "estimate", "diffBudget" }) before editing ${rel}.`);
}
const parsed = Step.safeParse(JSON.parse(readFileSync(stepFile, "utf8")));
if (!parsed.success) deny(`.kratos/current-step.json is invalid: ${z.prettifyError(parsed.error)}`);
const step = parsed.data;
const budget = step.diffBudget + step.extensions.reduce((sum, e) => sum + e.lines, 0);

if (!isMatch(rel, step.scope)) {
  deny(`${rel} is outside the scope of step ${step.id} "${step.title}" ` +
    `(${step.scope.join(", ")}). Ask the owner to widen the scope or plan a new step.`);
}
if (step.estimate > budget) {
  deny(`Step ${step.id} estimates ${step.estimate} new lines but its budget is ${budget}. Before writing ` +
    `code, propose to the owner a split into smaller steps that each work and can be verified on ` +
    `their own — or ask the owner for an extension.`);
}

const load = await reviewLoad(root, step);
if (load !== null && load > budget) {
  deny(`Step ${step.id} is over budget: ${load} new lines > ${budget}. Stop and show the owner what ` +
    `works so far. Offer: (1) extend — owner approves N more lines, recorded in "extensions" with a ` +
    `reason; (2) checkpoint — commit the working part, continue the rest as a new step; (3) split.`);
}
if (load !== null && load >= WARN_AT * budget) {
  respond({ additionalContext: `Kratos: step ${step.id} has used ${load} of ${budget} budgeted new ` +
    `lines (${Math.round((100 * load) / budget)}%). Finish the current unit, then stop at the gate; ` +
    `don't start new sub-tasks in this step.` });
}
process.exit(0);

function respond(fields) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...fields } }));
  process.exit(0);
}

function deny(reason) {
  respond({ permissionDecision: "deny", permissionDecisionReason: reason });
}

// New lines in the step's own files: insertions vs HEAD (tracked) + all lines of untracked files.
// Deletions are free; other steps' files and non-review files don't count. null if not a repo.
async function reviewLoad(cwd, step) {
  const git = simpleGit(cwd);
  if (!(await git.checkIsRepo())) return null;
  const counts = (path) => isMatch(path, step.scope) && !isMatch(path, [...NOT_REVIEW_LOAD, ...step.exclude]);

  let total = 0;
  try {
    const { files } = await git.diffSummary(["HEAD"]);
    for (const f of files) {
      if (!f.binary && counts(f.file)) total += f.insertions;
    }
  } catch {
    // no commits yet: everything is untracked, counted below
  }
  const { not_added: untracked } = await git.status();
  for (const path of untracked.filter(counts)) {
    try {
      const text = readFileSync(resolve(cwd, path), "utf8");
      total += text.split("\n").length - (text.endsWith("\n") ? 1 : 0); // trailing newline isn't a line
    } catch {}
  }
  return total;
}
