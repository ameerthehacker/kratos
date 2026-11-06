// Kratos v0 guardrail: PreToolUse hook for Edit/Write/MultiEdit/NotebookEdit.
// 1. Edits must be inside the active step's scope (.kratos/current-step.json).
// 2. The uncommitted diff must stay within the step's diff budget.
// Planning docs are always writable so a step can be declared in the first place.
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import picomatch from "picomatch";
import { simpleGit } from "simple-git";
import { z } from "zod";

const ALWAYS_WRITABLE = ["PLAN.md", "DECISIONS.md", "CLAUDE.md", ".kratos/**"];
const NOT_COUNTED = [...ALWAYS_WRITABLE, "pnpm-lock.yaml", "package-lock.json", "yarn.lock"];

const Step = z.object({
  id: z.string(),
  title: z.string(),
  scope: z.array(z.string()).min(1),
  diffBudget: z.number().int().positive().default(150),
});

const isMatch = (path, globs) => picomatch.isMatch(path, globs, { dot: true });

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
    `({ "id", "title", "scope": [globs], "diffBudget" }) before editing ${rel}.`);
}
const parsed = Step.safeParse(JSON.parse(readFileSync(stepFile, "utf8")));
if (!parsed.success) deny(`.kratos/current-step.json is invalid: ${z.prettifyError(parsed.error)}`);
const step = parsed.data;

if (!isMatch(rel, step.scope)) {
  deny(`${rel} is outside the scope of step ${step.id} "${step.title}" ` +
    `(${step.scope.join(", ")}). Ask the owner to widen the scope or plan a new step.`);
}

const changed = await changedLines(root);
if (changed !== null && changed > step.diffBudget) {
  deny(`Diff budget exceeded for step ${step.id}: ${changed} changed lines > ${step.diffBudget}. ` +
    `Stop, show the owner what you have, and propose a checkpoint commit or a split.`);
}
process.exit(0);

function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
  process.exit(0);
}

// Lines added + removed vs HEAD (tracked) plus lines in new untracked files; null if not a repo.
async function changedLines(cwd) {
  const git = simpleGit(cwd);
  if (!(await git.checkIsRepo())) return null;
  const counts = (path) => !isMatch(path, NOT_COUNTED);

  let total = 0;
  try {
    const { files } = await git.diffSummary(["HEAD"]);
    for (const f of files) {
      if (counts(f.file) && !f.binary) total += f.insertions + f.deletions;
    }
  } catch {
    // no commits yet: everything is untracked, counted below
  }
  const { not_added: untracked } = await git.status();
  for (const path of untracked.filter(counts)) {
    try {
      total += readFileSync(resolve(cwd, path), "utf8").split("\n").length;
    } catch {}
  }
  return total;
}
