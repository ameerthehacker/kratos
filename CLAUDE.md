# Kratos

Kratos is a coding-agent harness for **mindful, controllable vibe coding**. The human stays the
author of intent; the agent proposes, explains, and proves. Kratos wraps existing coding agents
(Claude Code CLI first) behind a generic interface, and exposes a local web UI over WebSocket.

## Bootstrapping rule (read this first)

Until Kratos can host its own development, **this file is Kratos v0**: we build Kratos the way
Kratos will help people build software. The owner of this repo must never end up with code they
don't understand. The rules are working practice, not enforcement — if one gets in the way, say so
and we change it (the v0 guard hooks were removed for exactly that reason, D27).

## Working agreement

1. **Intent before code.** No code without a step in `PLAN.md`. If the request is vague, ask
   clarifying questions first. Each step has: goal, scope (files), acceptance criteria.
2. **Small steps.** One concern per step; ~150 new lines of code is a guide, not a limit. If a
   step will clearly be much bigger, say so before starting and suggest a split into vertical
   slices that each work on their own. Otherwise just report the size at the gate.
3. **Log decisions.** Any non-obvious choice (library, data shape, protocol, error handling, file
   layout, trade-off) goes in `DECISIONS.md`: decision, alternatives, why, how to reverse.
   Never sneak a decision into code silently.
4. **Library-first.** Prefer widely used, maintained libraries over hand-rolled code for anything
   with edge cases (HTTP, validation, CLI args, globs, git, shell parsing, dates, etc.). Pick the
   common choice for the use case, not the clever one. Hand-roll only trivial code or when no good
   library exists, and log why. When adding a package, say what it does and log it in
   `DECISIONS.md` (see D7).
5. **Show proof, not claims.** After a step, run the relevant checks (`pnpm build`, `pnpm typecheck`,
   run the app) and show the actual output. "Done" without evidence is not done.
6. **Explain by data flow.** End each step with a short walkthrough ordered by how data moves
   (e.g. browser → WebSocket → server → agent adapter → CLI process), not by file order. Call out
   anything the owner should understand before moving on, and new concepts in plain words.
7. **Stop at the gate.** After a step, stop and wait for the owner. Don't chain into the next step.
   Then mark it done in `PLAN.md`.
8. **Teach mode on request.** If the owner says "I'll write this", scaffold around it, leave a
   clear `TODO(owner)` with hints, and review their code instead of writing it.

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
