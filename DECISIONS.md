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

### D6. v0 guardrails as Claude Code hooks (step 0) — **superseded by D27**
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

### D12. Hooks use `picomatch`, `simple-git`, `shell-quote`, `zod` (step 0b) — **superseded by D27**
- Why: glob matching, git queries, and shell tokenizing are classic "looks easy, has edge cases"
  code. Hooks import them from the root `node_modules` (root devDependencies).
- Note: `shell-quote` tokenizes, so `cd x && pnpm add y` is caught, while a quoted
  `echo "pnpm add"` is not a false alarm.

### D13. Claude Code adapter will use `@anthropic-ai/claude-agent-sdk` (decided now, built in step 2) — **superseded by D23**
- Alternatives: spawn `claude -p --output-format stream-json` and parse it ourselves.
- Why: official library for driving Claude Code; it runs the same CLI, with typed messages,
  permission callbacks (`canUseTool`) and hooks — the exact seams Kratos needs for gates.

### D14. One event stream per session, not per turn (step 1, owner)
- Alternatives: `send()` returns that turn's events (old draft).
- Why: matches the Claude Agent SDK (one long-lived `query()` stream); the server/UI subscribe
  once; enables interrupt and mid-turn steering. Turns are marked by `turn_end` events.
- Reverse: wrap `events` + `send` into a per-turn helper that reads until `turn_end`.

### D15. Permission gate is an async callback `requestPermission` (step 1, owner)
- Alternatives: `permission_request` event + `session.respond(id, …)`; no gating in adapters.
- Why: maps 1:1 to the SDK's `canUseTool`; no request-id bookkeeping. Kratos's policy (scope,
  budget, ask the owner in the UI) lives in the callback. Allow may carry `updatedInput` so the
  owner can edit a command before it runs; deny carries a message the agent sees.
- Reverse: emit an event from inside the callback and resolve it from `respond()`.

### D16. No usage/cost events in v1 (step 1, owner)
- Why: not needed until the UI shows per-step cost. The SDK reports it on each result, so adding
  an optional `usage` field to `turn_end` later is non-breaking.

### D17. Complete blocks, not token deltas (step 1, owner)
- Why: fewer events, simpler UI and logs. Reverse: add a `text_delta` kind (SDK option
  `includePartialMessages`).

### D18. `thinking` event + `turn_end` instead of `done` (step 1)
- Why: showing the agent's reasoning serves the "understand why" goal; `done` was ambiguous once
  the stream outlives a turn. Agents without visible reasoning simply never emit `thinking`.

### D19. Events and permission data are zod schemas; adapter/session are TS interfaces (step 1)
- Why: events and decisions cross the WebSocket (validated per CLAUDE.md); adapters and sessions
  are behaviour (functions), which zod doesn't model usefully.
- Deferred: session resume (SDK `resume: sessionId`), per-event ids/timestamps — add when the UI
  needs history or reconnect.

### D20. Run the owner's installed `claude` CLI, found with `which` (step 2, owner)
- Alternatives: the SDK's bundled, version-pinned binary (default if `pathToClaudeCodeExecutable`
  is unset).
- Why: same Claude Code the owner uses day to day. `claudePath` option overrides; a clear error if
  `claude` isn't on PATH. Risk: CLI and SDK versions can drift — if the SDK breaks, try the bundled
  binary first.
- Reverse: drop `pathToClaudeCodeExecutable` in the adapter.

### D21. Adapter details (step 2)
- Settings: CLI default (user + project + local), so the target repo's CLAUDE.md and hooks apply
  to Kratos-driven sessions too.
- Skipped in v1: messages from sub-agents (`parent_tool_use_id` set), empty `thinking` blocks (this
  CLI omits thinking text), and the ~35 SDK message kinds that don't map to an AgentEvent.
- Order in practice: `tool_call` → permission callback → `tool_result`.
- The callback only fires for tools the CLI's own settings say to ask about: with the owner's
  settings, Write/Edit ask but some Bash commands are auto-allowed (and may be backgrounded).
  Kratos gates (step 5) must account for this — e.g. a stricter permission mode for Kratos runs.
- Verified with the real CLI (2.1.308): deny→reroute→allow, multi-turn context in one process,
  interrupt → `turn_end: interrupted`, interrupt during a pending ask → `control_cancel_request`
  fires our AbortSignal and the tool is not run, `stop()` leaves no processes.

### D23. Talk to the `claude` CLI's RPC mode directly — no Agent SDK (step 2, owner)
- Alternatives: `@anthropic-ai/claude-agent-sdk` (built and tested first, then removed).
- Why: owner's call — no extra layer between Kratos and the CLI; fewer deps; we see the real
  protocol. The SDK is itself a host for this same protocol, so we lose nothing we use today.
- Protocol (read from the SDK's source, CLI 2.1.308): spawn
  `claude -p --input-format stream-json --output-format stream-json --verbose
  --permission-prompt-tool=stdio`; one JSON object per line each way.
  - prompts → stdin `{type:"user", message:{role:"user", content}}`
  - CLI asks → `{type:"control_request", request_id, request:{subtype:"can_use_tool", tool_name, input}}`
  - we answer → `{type:"control_response", response:{subtype:"success", request_id,
    response:{behavior:"allow", updatedInput} | {behavior:"deny", message}}}`
  - CLI withdraws a pending ask → `{type:"control_cancel_request", request_id}` (→ our AbortSignal)
  - interrupt → stdin `{type:"control_request", request_id, request:{subtype:"interrupt"}}`
- Tools: Node's `child_process.spawn` + `readline` (standard library, not hand-rolled) for
  JSON lines; zod schemas validate every CLI line we consume, unknown kinds are ignored.
- Risk: this protocol is the CLI's internal host interface, not a documented public API — it can
  change between CLI versions. The zod schemas make breakage loud instead of silent.
- Reverse: re-add the SDK and rewrite `src/index.ts` around its `query()` (an SDK version was
  built and tested during step 2 but never committed; it was ~100 lines).

### D22. `package.json` / `tsconfig*.json` don't count toward diff budgets (step 2, owner)
- Why: boilerplate, not logic to understand. Step 2's budget was raised 150 → 188 by exactly its
  config lines until the hook implements this in step 2b. Folded into D24.

### D31. `kratos [project-dir]`, defaulting to the current dir (step 3, owner)
- Alternatives: required argument (D25's approach for the demo).
- Why: owner's preference — works like `code .`. The resolved folder is printed at startup and
  shown in the UI header so it's always visible where Claude acts.
- Caveat: `pnpm start` from this repo runs at the repo root, so it points Claude at Kratos
  itself — fine for dogfooding, but pass a folder to work elsewhere.

### D32. One shared session per server (step 3, owner)
- Alternatives: one session per browser tab (simpler; refresh loses the conversation).
- Rules (my defaults, flip any):
  - The server keeps the session's message log and replays it to each new or refreshed tab,
    including asks still waiting for an answer.
  - Any tab may answer an ask; the first decision wins and the resolution is broadcast so other
    tabs close the card. Decisions for unknown or already-resolved asks are ignored.
  - A pending ask waits even if every tab closes (no auto-deny) — reopen and answer it.
  - The `claude` process starts on the first prompt and restarts on the next prompt if it ended.
  - The log is in memory and unbounded for now; it's lost when the server stops.

### D29. Leaving `messages()` early stops the process (bug found by T3)
- Bug: if a consumer `break`s out of `session.events` without calling `stop()` first, everything
  hung forever. Closing execa's line iterator waits for the process to exit, but the process only
  exits when its stdin is closed — which nobody did. Step 3's server (stop reading when a browser
  disconnects) would have hit this.
- Fix: `JsonLinesProcess.messages()` iterates execa's lines manually and, in `finally`, stops the
  process *before* closing the iterator. Regression test in `json-lines-process.test.ts`.

### D30. Gate tests run against a fake `claude` (`test/fake-claude.mjs`) (T3)
- A ~80-line Node script that speaks the D23 protocol, scripted by prompt (`ask`, `unknown`,
  `cancel`, `hang`, `crash`), refuses to start without the RPC-mode flags, and reports back what it
  received as a `tool_result` so tests assert on the real wire messages.
- Risk: it can drift from the real CLI (tests pass, real runs break). Guard: an opt-in smoke run
  against the real `claude` (later, see the test plan).

### D28. Vitest at the root, tests next to code, excluded from builds (T1)
- `pnpm test` = `vitest run` over the whole repo; `*.test.ts` sits beside the file it tests and is
  excluded from each package's `tsc` build (Vitest transpiles TS itself; tests aren't typechecked
  by `pnpm typecheck` — revisit with `vitest --typecheck` if that bites).
- Tests that spawn processes must clean them up in `afterEach` (via `JsonLinesProcess.pid`), so a
  broken `stop()` fails the test instead of hanging the whole run (found by mutation testing).
- Alternatives: `node:test` (built in, but no TS without a loader); per-package turbo `test`
  tasks (unnecessary while there's one test package).

### D26. `JsonLinesProcess`: one class owns child-process lifecycle, built on execa (step 2d, owner)
- Correction (T1): the "EPIPE crashes Kratos" risk below did **not** reproduce on Node 22/macOS —
  writes to a dead child's stdin are dropped silently, even with bare `child_process`. The stdin
  error handler stays as cheap insurance, but no test covers it.
- Why: process handling was mixed into the Claude adapter, and some cases were unhandled: EPIPE
  when writing after a crash would crash Kratos, a crash mid-turn ended the stream silently,
  `stop()` killed instantly, and a Kratos crash could orphan `claude` processes.
- Decision: a generic class (no Claude knowledge) — `send(json) → boolean`, `messages()` (parsed
  stdout lines, junk skipped), `exited` (never rejects; says whether the stop was requested),
  `stop(graceMs)`: close stdin → SIGTERM after grace → SIGKILL (execa `forceKillAfterDelay`).
  execa settings: `buffer: false` (long-lived; default would hold all output in memory),
  `reject: false`, `cleanup: true` (no orphans). Adapters keep only their protocol.
- Adapter now emits `turn_end: error "claude exited unexpectedly: …"` if the process ends without
  `stop()`.
- Placement: in the adapter package for now (Node-only, so not `core`, which the browser
  imports). Move to a shared `packages/process` when a second CLI adapter needs it.
- Verified: 10 lifecycle checks with fake processes (crash, junk lines, write-after-exit, EPIPE
  race, graceful stop 3ms, stubborn → SIGKILL ~700ms, missing command, adapter crash surfacing,
  no orphans when the parent exits) + the real-CLI run (claude exits ~0.5s after stdin closes).

### D25. Demo requires an explicit `--cwd` (step 2c)
- Found: pnpm runs package scripts from the package folder and `INIT_CWD` isn't set, so a
  "current dir" default made Claude act inside `packages/adapter-claude-code`.
- Decision: `demo --cwd <dir> "<prompt>"`, required, echoed before anything runs ("Claude Code will
  act in: …"). Parsed with Node's built-in `parseArgs` — one flag in a dev script doesn't need
  commander (D10 covers the user-facing `kratos` CLI).
- Carry into step 3: the Kratos server must also take the target project dir explicitly.

### D27. Remove the v0 guard hooks (step 2e, owner)
- Decision: delete `.claude/hooks/guard-edits.mjs` and `guard-bash.mjs`, their entry in
  `.claude/settings.json`, the hook-only root deps (picomatch, simple-git, shell-quote, zod) and the
  `.kratos/` step file. CLAUDE.md keeps the working practice without enforcement.
- Why: for the owner, the enforcement was more resistance than help while building Kratos —
  repeated blocks and budget negotiations interrupted the flow more than they protected it.
- Kept: the D24 *model* (review load, estimate, extend/checkpoint/split) as a product idea for
  PLAN step 5, where the owner opts in through the UI instead of being blocked by a hook.
- Reverse: restore both hooks and the settings entry from commit 05d12d2 and re-add the deps.

### D24. Budget system v2: review load, estimate first, graduated response (step 2b, owner) — **v0 hook removed by D27; model kept for step 5**
- Problem: step 2 hit the budget three times — budgets were guessed then only checked mid-edit,
  counted deleted/replaced lines and config, counted other steps' WIP (whole-tree diff), and had
  no warning and no clean path when over. Raising the number each time fixed nothing.
- Decision (v0 hook now; same model is Kratos's own gate in PLAN step 5):
  - Review load = insertions vs HEAD (+ lines of new files) in files matching the step's scope,
    excluding docs, lockfiles, `package.json`, `tsconfig*.json`, and per-step `exclude` globs.
  - Steps declare `estimate`; estimate > budget blocks the first code edit → split first.
  - ≥ 80% → warning to the agent (`additionalContext`); > 100% → block with three owner options:
    extend (recorded in `extensions` with a reason), checkpoint (commit + new step), split.
  - Splits are vertical slices: each part works and is verifiable alone.
- Verified live in step 2: the 80% `additionalContext` warning reaches the agent.
- Learned in step 2: estimates can miss by ~30% (index.ts 150 vs 110 guessed); extensions are the
  honest path, recorded with reasons in the step file.
- Reverse: previous hook in git history (commit 40ec6d7).
