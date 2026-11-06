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
apps/cli                   `kratos [project-dir]` (commander)
  src/server.ts            Fastify: serves apps/web/dist, one WebSocket per browser tab (/ws)
  src/session-hub.ts       the one shared agent session: log, replay, asks, broadcast (D32)
  src/store/               SQLite via Drizzle + better-sqlite3; schema → drizzle/ migrations (D36)
  src/logger.ts            pino: console (pretty, info) + ~/.kratos/logs rotating files (debug) (D44)
apps/web                   Vite + React UI; react-use-websocket to ws://<host>/ws
packages/core              zod schemas for the WebSocket protocol + the AgentAdapter interface
packages/adapter-claude-code
  src/json-lines-process.ts  child-process lifecycle (execa), JSON lines in/out (D26)
  src/index.ts             drives `claude` in its stream-json RPC mode (D23); map.ts → AgentEvents
  test/fake-claude.mjs     scripted stand-in for `claude` used by tests (D30)
```

Data flow: browser tab ⇄ WebSocket ⇄ server ⇄ SessionHub (⇄ SQLite) ⇄ AgentAdapter ⇄ `claude`.

Messages crossing a boundary (WebSocket, files, agent output) are validated with zod schemas from
`packages/core`; TS types are `z.infer`-ed from them, never written separately.

## UI conventions (apps/web)

- **No hardcoded Tailwind values** like `text-[15px]`, `leading-[1.55]`, `max-w-[760px]`,
  `size-[7px]`, `#7CCFA6`. Use, in this order:
  1. the standard Tailwind scale — including fractional steps (`size-4.5` = 18px), and accept
     ±1–2px from the design rather than hardcoding it;
  2. a named design token in `apps/web/src/index.css` (`@theme`, e.g. `text-body`, `text-display`)
     when the design genuinely needs a size the scale lacks and it's used, or meaningful, app-wide;
  3. an arbitrary value only when neither works for a true one-off — with a comment saying why.
- Colors only via theme variables (`bg-primary`, `text-muted-foreground`, `bg-wait`, …), never hex.
- **Island layout** (owner's design): panels float as rounded islands (`rounded-3xl bg-background`)
  on the darker canvas (`bg-canvas`), separated by gaps (`p-2.5 gap-2.5`), never by borders or
  full-bleed dividers. New panels (sidebars, inspectors) are islands too. The design artifact is
  the source of truth — re-read it before UI work; it evolves.
- Exception: shadcn-generated files in `src/components/ui/` stay as generated (`shadcn add`
  overwrites them); their selector variants like `[&_svg]:…` have no non-bracket form anyway.

Agents plug in through `AgentAdapter` (packages/core). Claude Code is the first adapter; nothing
outside an adapter may depend on a specific agent.

## Commands

```bash
nvm use               # Node 24 (.nvmrc); pnpm install refuses other versions
pnpm install          # install workspace deps
pnpm dev              # server (tsx watch) + UI (Vite, http://localhost:5173) + package watchers;
                      # agent works in this repo (dogfooding), history in .kratos/kratos.db
                      # (override: KRATOS_PROJECT=<dir> KRATOS_DB=<file> pnpm dev)
pnpm build            # turbo build (core → cli, web)
pnpm typecheck        # turbo typecheck
pnpm test             # vitest: all tests, no real claude needed
pnpm start            # run kratos (after build) → http://localhost:4317 (acts in this repo!)
node apps/cli/dist/index.js <dir> [--port] [--host] [--db] [--log-dir] [--log-level]  # another project
tail -f ~/.kratos/logs/current.log    # debug log (JSON lines, rotated 10 MB × 5); `| pnpm exec pino-pretty` to read
pnpm dev:web          # Vite dev server with /ws proxied to a running kratos
pnpm --filter @kratos/cli db:generate   # after editing src/store/schema.ts
```
