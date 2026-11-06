# Decisions

Format: **decision** · alternatives · why · how to reverse. Newest at the bottom.

### D1. Monorepo with Turborepo + pnpm workspaces (step 0)
- Alternatives: single package; npm workspaces; Nx.
- Why: owner's choice of turborepo; pnpm was already installed and is turbo's best-supported
  manager (strict deps, fast installs).
- Reverse: swap `pnpm-workspace.yaml` for `"workspaces"` in root package.json and use npm.

### D2. Three packages: `apps/cli`, `apps/web`, `packages/core` (step 0)
- Alternatives: separate `server` package; separate `protocol` package.
- Why: smallest split that keeps the agent-agnostic types shared between server and UI. The
  server lives in the CLI because the CLI's only job is to start it. Split later if it grows.
- Reverse: move `apps/cli/src/server.ts` into its own package.

### D3. Plain `node:http` + `ws` for the server (step 0) — **superseded by D8**
- Alternatives: Express, Fastify, Hono.
- Why: we serve static files and one WebSocket endpoint; a framework adds concepts we don't need.
  `ws` is the de-facto Node WebSocket library (Node 22 has a WebSocket *client* but no server).
- Reverse: wrap `createServer` handler with a framework; `ws` attaches to any http server.

### D4. Vite + React for the UI (step 0)
- Alternatives: vanilla TS, Svelte, Solid.
- Why: the UI will grow into a timeline/plan/diff view; React is the most familiar ecosystem.
- Reverse: replace `apps/web/src` — the WebSocket protocol is framework-independent.

### D5. Production UI is served by the CLI from `apps/web/dist` (step 0)
- Alternatives: always run Vite dev server; embed assets into the CLI bundle.
- Why: `kratos` = one command, one port. `pnpm dev:web` proxies `/ws` for fast UI iteration.
- Reverse: change static path resolution in `apps/cli/src/server.ts`.

### D6. v0 guardrails as Claude Code hooks (step 0)
- Alternatives: rules in CLAUDE.md only; build Kratos enforcement first.
- Why: lets us live by the Kratos rules today. `PreToolUse` hooks enforce step scope + diff
  budget on edits and ask before new dependencies / `git push` / `rm -rf`.
- Known gap: hooks can't see files changed via Bash; CLAUDE.md rule 10 covers it.
- Reverse: remove the `hooks` block from `.claude/settings.json`.

### D7. Library-first policy (step 0b, owner request)
- Decision: prefer widely used, maintained libraries over hand-rolled code. Hand-roll only when
  it's a few obvious lines or no good library exists — and log why.
- Why: less code for the owner to understand and maintain; well-known libs have docs, answers,
  and edge cases already handled (e.g. path traversal, MIME types, glob semantics, shell parsing).
- Reverse: n/a (policy); individual library choices below are each reversible.

### D8. Fastify + `@fastify/static` + `@fastify/websocket` for the server (step 0b)
- Alternatives: Express + `serve-static` + `ws`; Hono + `@hono/node-server`.
- Why: first-party plugins for exactly our two needs (static files, WebSocket), built-in TS types,
  logging via pino. `@fastify/websocket` uses `ws` underneath. Replaces our hand-rolled static
  serving, MIME table and traversal guard.
- Reverse: Express equivalent is ~same size; swap `apps/cli/src/server.ts`.

### D9. zod schemas as the single source of truth for messages (step 0b)
- Alternatives: plain TS types + manual checks; valibot; typebox.
- Why: messages arrive from outside (browser, files), so they must be validated at runtime;
  zod gives validation + inferred TS types from one definition. Most common choice.
- Reverse: replace `z.infer` types with hand-written ones.

### D10. `commander` for CLI args (step 0b)
- Alternatives: `node:util` parseArgs, yargs, cac.
- Why: most used Node CLI library; we'll need subcommands and `--help` soon.

### D11. `react-use-websocket` in the UI (step 0b)
- Alternatives: hand-written `useEffect` + `WebSocket`; socket.io.
- Why: handles connect/reconnect, state, StrictMode double-mount, and JSON messages. socket.io
  would need its own server protocol — overkill.
- Gotcha: the package is CJS-only; its default import breaks under Vite 8's Node-style interop
  (blank page, "is not a function"). We import the named `useWebSocket` from
  `react-use-websocket/dist/lib/use-websocket` instead. Revisit if the package ships ESM.

### D12. Hooks use `picomatch`, `simple-git`, `shell-quote`, `zod` (step 0b)
- Why: glob matching, git queries, and shell tokenizing are classic "looks easy, has edge cases"
  code. Hooks import them from the root `node_modules` (root devDependencies).
- Note: `shell-quote` tokenizes, so `cd x && pnpm add y` is caught, while a quoted
  `echo "pnpm add"` is not a false alarm.

### D13. Claude Code adapter will use `@anthropic-ai/claude-agent-sdk` (decided now, built in step 2)
- Alternatives: spawn `claude -p --output-format stream-json` and parse it ourselves.
- Why: official library for driving Claude Code; it runs the same CLI, with typed messages,
  permission callbacks (`canUseTool`) and hooks — the exact seams Kratos needs for gates.
