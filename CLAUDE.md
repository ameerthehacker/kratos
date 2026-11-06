# Kratos

Kratos is a coding-agent harness for **mindful, controllable vibe coding**. The human stays the
author of intent; the agent proposes, explains, and proves. Kratos wraps existing coding agents
(Claude Code CLI first) behind a generic interface, and exposes a local web UI over WebSocket.

## Bootstrapping rule (read this first)

Until Kratos can host its own development, **this file + the hooks in `.claude/` _are_ Kratos v0**.
We build Kratos the way Kratos will make people build software. The owner of this repo must never
end up with code they don't understand. If a rule below slows us down, that's the point — raise it
as a decision instead of skipping it.

## Working agreement (mandatory for every change)

1. **Intent before code.** No code without an active step in `PLAN.md`. If the request is vague,
   ask clarifying questions first. Each step has: goal, scope (files/globs), acceptance criteria.
2. **Declare the step.** Before editing, write `.kratos/current-step.json`
   (`{ "id", "title", "scope": [globs], "estimate": lines, "diffBudget": lines }`). The edit hook
   blocks writes outside scope. Only `PLAN.md`, `DECISIONS.md`, `CLAUDE.md`, and `.kratos/**` are
   always writable.
3. **Small steps, sized up front** (D24). One concern per step.
   - **Budget = review load:** new lines (insertions) in the step's own files. Deleted lines,
     config (`package.json`, `tsconfig*.json`), lockfiles and docs don't count. Default 150.
   - **Estimate before coding:** list the files and rough new lines per file, then set `estimate`.
     If it exceeds the budget, propose a split to the owner *before* writing code. Every split
     must be a vertical slice that works and can be verified on its own (never "half an adapter").
   - **At 80%** the hook warns: finish the current unit, then stop at the gate.
   - **Over budget** the hook blocks. Stop, show what works, and let the owner choose:
     **extend** (add `{ "lines", "reason" }` to `extensions` — only after the owner says yes),
     **checkpoint** (commit the working part, continue as a new step), or **split**.
     Never raise `diffBudget` or edit the hook to get past a block.
4. **Log decisions.** Any non-obvious choice (library, data shape, protocol, error handling, file
   layout, trade-off) goes in `DECISIONS.md`: decision, alternatives, why, how to reverse.
   Never sneak a decision into code silently.
5. **Library-first.** Prefer widely used, maintained libraries over hand-rolled code for anything
   with edge cases (HTTP, validation, CLI args, globs, git, shell parsing, dates, etc.). Pick the
   common choice for the use case, not the clever one. Hand-roll only trivial code or when no good
   library exists, and log why. Adding a package triggers an approval prompt: say what it does and
   log it in `DECISIONS.md` (see D7).
6. **Show proof, not claims.** After a step, run the relevant checks (`pnpm build`, `pnpm typecheck`,
   run the app) and show the actual output. "Done" without evidence is not done.
7. **Explain by data flow.** End each step with a short walkthrough ordered by how data moves
   (e.g. browser → WebSocket → server → agent adapter → CLI process), not by file order. Call out
   anything the owner should understand before moving on, and new concepts in plain words.
8. **Stop at the gate.** After a step, stop and wait for the owner. Don't chain into the next step.
   Then mark it done in `PLAN.md` and clear/replace `.kratos/current-step.json`.
9. **Teach mode on request.** If the owner says "I'll write this", scaffold around it, leave a
   clear `TODO(owner)` with hints, and review their code instead of writing it.
10. **No edits via Bash.** Change files with the edit tools only (hooks can't see `sed`/heredocs).

## Architecture

Turborepo + pnpm workspaces, TypeScript, ESM everywhere.

```
apps/cli    `kratos` command (commander): Fastify server with @fastify/static (serves
            apps/web/dist) and @fastify/websocket (/ws)
apps/web    Vite + React UI; react-use-websocket to ws://<host>/ws
packages/core  zod schemas for the WebSocket protocol + the generic AgentAdapter interface
```

Messages crossing a boundary (WebSocket, files, agent output) are validated with zod schemas from
`packages/core`; TS types are `z.infer`-ed from them, never written separately.

Agents plug in through `AgentAdapter` (packages/core). Claude Code is the first adapter; nothing
outside an adapter may depend on a specific agent.

## Commands

```bash
pnpm install          # install workspace deps
pnpm build            # turbo build (core → cli, web)
pnpm typecheck        # turbo typecheck
pnpm start            # run kratos (after build) → http://localhost:4317
pnpm dev:web          # Vite dev server with /ws proxied to a running kratos
```
