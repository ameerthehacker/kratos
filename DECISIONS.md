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

### D45. Conversation view: the owner's chat design, generic tool actions, library rendering (step 3c2a)
- Owner: render chat messages and tool calls like the shared "Kelpie" design's chat (only that
  part): prompts as bubbles, replies as plain text, tool calls as "Agent · N steps" groups of
  plain-words steps (round tinted icon, title, chips) with a "Show raw" toggle.
- Agent-neutral data: `tool_call` events carry an optional `action` (`read | edit | run | search
  | web | task | other` + target / command / description / lines added/removed). The Claude
  adapter derives it from its tool names (`tool-action.ts`); the UI only reads `action`, so it
  never learns Claude's tool names (CLAUDE.md: only adapters know their agent). Logs from before
  this have no `action` and show as "Used <tool>". Alternative: map Claude tool names in the web
  app — rejected, it would tie the UI to one agent.
- `buildTimeline()` (pure, tested) turns the log into items; a permission ask attaches to the
  newest unfinished call of the same tool (the CLI sends the call before the ask).
- Libraries (owner: "don't reinvent"): Streamdown for replies (markdown, safe by default) with its
  official `@streamdown/code` plugin (Shiki) for code blocks; `react-shiki` (Shiki) for the raw
  `$ command`, same github-dark theme; `use-stick-to-bottom` to keep the view pinned to new
  messages. AI Elements (from the earlier plan) is not installed: its look isn't this design,
  and the two libraries above are what it uses underneath. A hand-rolled command tokenizer
  written first was replaced by Shiki on the owner's request.
- Layout: viewport-high; each page scrolls its own content, and the session composer sits below
  the scroll area (always visible, the design's sticky composer). Shiki makes the bundle large
  (warning at build); lazy-loading it is a later optimisation.
- 3c2b asks + Stop: an open ask lives on its step (`step.ask`) and renders as the design's amber
  "needs your OK" card — the call in present tense ("Edit notes.txt"), the agent's reason if
  any, the exact command or call (always shown: you approve what will actually run), Allow /
  Deny. Deny sends a fixed message ("The owner denied this in Kratos."); typed deny reasons are
  later. Answered, it's the step again with "You allowed this" / "You denied this" (a denied
  call's error result adds no "Failed"). Stop: the send button turns into Stop while the
  session isn't idle and the box is empty (typing still sends); it sends `interrupt`.
  Known gap: a Write/Edit ask shows the raw JSON, not a readable diff — a later step.
- Code theme: one constant + the Streamdown code plugin built from it (`lib/appearance.ts`), so
  both highlighters always match; owner wants it user-configurable later (PLAN "Settings").
- Reverse: the components live in `apps/web/src/components/conversation/`; `action` is optional.

### D44. Logging: pino → console + rotating files in ~/.kratos (step 3L, owner)
- Owner: replace `console.*` with a proper logger that prints to the console *and* writes rotating
  log files under `~/.kratos` for debugging.
- Choices (owner): rotate at 10 MB, keep 5; browser warnings also into the file (via a
  `client_log` WebSocket message); *all* Kratos data in `~/.kratos` (DB too; the old app-data DB is
  *not* migrated — the product is brand new, owner); console at `info`, file at `debug`.
- Library-first: pino (already inside Fastify — one logger for app and HTTP), pino-roll (pino's
  rotating-file transport), pino-pretty (readable console). Alternatives: winston +
  winston-daily-rotate-file (would be a second logger next to Fastify's pino).
- Design (my calls):
  - Files: `~/.kratos/logs/kratos.N.log` (JSON lines), `current.log` → the active one. pino-roll's
    `limit.count` excludes the active file, so 4 + 1 = 5; `removeOtherLogFiles` makes the cap hold
    across restarts (each start opens a new file number). pino-roll checks the size per batched
    write, so a file can overshoot 10 MB by one batch.
  - Components log through child loggers: `http` (Fastify), `hub`, `session` (+ session id),
    `web` (the browser). Lines: models loaded/failed, new session, agent started (model, resume),
    agent ended/failed, model set, failed agent calls (warn); turn ends, asks and their outcome,
    and every HTTP request (method, url, status, ms) at debug, so file only.
  - CLI: `--log-dir` (default `~/.kratos/logs`), `--log-level` (console only; the file is always
    debug). The logger runs in a worker thread (pino transport): shutdown flushes it before exit.
  - `client_log {level, message ≤ 2000 chars, data?}` is handled by the server, not the hub; the
    web's `clientLog()` also prints to devtools and drops the line silently when disconnected.
  - Found in 3m2's run: pino-roll's `mkdir` is async but it links `current.log` at once, so a
    fresh log folder crashed the worker (ENOENT) — `createLogger` makes the folder first. And
    sessions get the root logger (not the hub's child), else lines carry `component` twice.
  - Hub/runtime/server take an optional logger (default silent) so tests stay quiet; tests use a
    `memoryLogger()` that keeps parsed lines. The adapter's terminal `demo.ts` keeps `console`: that
    is its user interface, not logging.
- Reverse: swap `logTargets()` in `apps/cli/src/logger.ts`; everything else only sees a pino Logger.

### D43. Harness & model picker (step 3m, owner)
- Owner: the agent chip is a dropdown with the Claude logo to pick the harness (only Claude Code
  for now) and a model Claude provides; shown as latest aliases + an "Other versions" group;
  chosen on Home, and switchable mid-session.
- Facts verified first: the CLI's `initialize` control request returns `models` (`value` for
  `--model`, `displayName`, `description`) — 13 for the owner's account incl. "default"; the
  aliases (`opus`, `fable`, `sonnet`, `haiku`) always mean the latest; changing model in a
  running session is `control_request {subtype: "set_model", model}` (read from the SDK source).
- Logo (owner: "download from the official Claude site"): claude.ai's own declared icon,
  `https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/cd02a42d9-Vq_H3mgS.svg` (2,558
  bytes, image/svg+xml). Fetched via its link on claude.ai (claude.ai itself blocks scripted
  requests with 403 — not worked around). Inspected before use: one `<path>`, fill `#D97757`, no
  scripts/handlers/external refs. Its color becomes a theme token.
- 3m1 backend: `AgentAdapter.listModels()` (Claude: start the CLI in a temp dir, `initialize`,
  map `models` — `claude-…` ids are "other", aliases "latest"; cached per run, retried after a
  failure); `startSession({ model })` → `--model` (also on resume); `AgentSession.setModel()`.
  Sessions store their `model` (null = agent default) and `agent` now holds the harness *id* —
  migration 0002 adds the column and rewrites old `'Claude Code'` rows to `'claude-code'`
  (verified on a copy of an old DB). The model picked on Home applies only to the prompt that
  *starts* a session; `set_model` switches the viewed session (live if its agent runs). If the
  agent can't list its models, the harness is still offered (empty list → its default works).
- `ControlChannel` (owner: "commonise control request/response"): one class for every control
  request Kratos sends the CLI — unique ids, matches `control_response`, settles once on answer /
  error answer / timeout / CLI exit / failed send. Used by `fetchModels`, `setModel`, `interrupt`.
  Requests the CLI sends *us* (`can_use_tool`) stay in the adapter: that's the permission gate.
- 3m2 UI (my calls): shadcn `dropdown-menu` (Base UI Menu) as the chip — Harness radio group,
  Model radio group (latest), "Other versions" submenu. The CLI's `default` model id is treated
  as "no model chosen" (null): Home sends no `--model`, the chip says "Default". In a session,
  picking Default sends `set_model "default"`, which the CLI accepts (verified: answers as Opus
  5.5, the recommended model). The Home choice is a tiny zustand store with the `persist`
  middleware (localStorage `kratos.home-choice`); a remembered model the agent no longer lists
  falls back to the default. In a session the harness is locked (only the model can change).
  Radio items need `closeOnClick` — Base UI keeps a menu open after a radio pick by default (found
  in the real run: the open menu ate the next typed text). The logo's color is a theme token
  (`text-claude`, same in every theme); the SVG's fill became `currentColor`.
- Contract made explicit: `setModel()` resolves when the CLI confirms, which arrives on its
  output — so `events` must be being consumed (the hub's pump always is). Found when a test that
  paused reading hung.

### D42. UI shell: React Router, Zustand, island layout (step 3n2, owner requests)
- Routes (owner: React Router, v8): `/` Home, `/s/:sessionId` a session; unknown → `/`. v8 notes:
  `RouterProvider` comes from `react-router/dom`, everything else from `react-router`. A session
  page asks the server to `open_session` its URL's id; Home navigates to the session its prompt
  landed in once the server echoes the prompt (works whether a new session was made or an empty
  one reused). The server answers extension-less GETs with `index.html` (deep links/refresh);
  missing files still 404. `startServer({ webRoot })` so the test doesn't need a build.
- State: Zustand now (planned for 3c2 in D39, pulled forward — layout, sidebar, Home and the
  session page all share it). `useKratosConnection` (mounted once in the layout) owns the
  WebSocket and writes the store; components select slices (`useShallow`).
- Island layout (owner's design, re-read): `bg-canvas` (#070708) behind rounded `bg-background`
  islands with 10px padding/gaps, no borders; current session = chip color. Rule in CLAUDE.md.
- Bug found while checking: Kratos's own cleanup (withdrawing asks at shutdown, cancelling stale
  asks on reload) bumped a session's `updatedAt`, reordering Recent. Such messages are now stored
  with `activity: false`; two regression tests (fail without the fix).

### D41. Sessions run side by side; each tab views one (step 3n, owner) — revises D32
- Owner: starting new work must not cancel a running session. So a project has many sessions;
  each keeps its own `claude` process, log and pending asks, and they run concurrently.
- Owner choices: each tab views its own session (starting new work moves only that tab; new tabs
  open the most recent session); sessions are reachable from the Recent list on Home *and* the
  design's sessions sidebar, both with live status.
- Design (my calls): `SessionRuntime` owns one session (today's hub logic); `SessionHub` is the
  registry + per-tab subscriptions, loading runtimes lazily from the store. Status is derived
  live — `needs_approval` (an ask is open) > `working` (a turn is in progress) > `idle`; not
  persisted (after a restart every session is idle and asks were cancelled, D36). A session's
  title is its first prompt, stored in a new `title` column. Ask ids are UUIDs, so a decision
  from any tab is routed to whichever session owns the ask.
- Superseded: D32's "one shared session per server" and "all tabs follow". Kept from D32: a
  session's log is replayed to every tab that opens it; first decision wins; asks survive tabs
  closing.
- Discarded draft: a first 3n version stopped the old agent and cancelled its asks on switch —
  replaced before commit after the owner's correction. Kept from it: never leave an agent
  `stop()`/`interrupt()` promise unhandled (an adapter rejection would crash Node by default).

### D40. `pnpm dev`: server + UI together, in a throwaway dev project (owner request)
- Root `dev` = `turbo run dev` (persistent, after `^build`): `apps/cli` via `tsx watch`
  (restarts on server changes; Node 24's own type stripping can't map our `.js` import paths),
  `apps/web` via Vite (HMR, proxies `/ws` → :4317), `core` + adapter via `tsc --watch`.
- ~~The dev server's agent works in `.dev/project` with history in `.dev/kratos.db`~~ —
  **changed (owner):** it works in the **repo root** (Kratos is built with Kratos: dogfooding is
  the milestone-1 goal), history in `.kratos/kratos.db` (git-ignored), never in the user's real
  history. turbo runs scripts from the package folder, so the path is explicit (`../..`), not
  "current dir". Override: `KRATOS_PROJECT=… KRATOS_DB=…`.
- Trade-off of dogfooding under `tsx watch`: if the agent edits server code (`apps/cli`,
  `packages/*`), kratos restarts and that agent's turn is cut off (the session itself resumes,
  D36). UI edits hot-reload without a restart.
- UI reconnects every 1s (was react-use-websocket's 5s default) so server restarts recover fast.
- Verified: both start from one command; UI on :5173 connects through the proxy; touching a
  server file restarts kratos cleanly (no EADDRINUSE) and the UI reconnects in ~0.3s; stopping
  leaves no processes and frees both ports.

### D39. UI building blocks (step 3c1)
- shadcn init: Vite template, `base` component library (Base UI), `nova` preset; brings the
  `cn` package (shadcn's own clsx + tailwind-merge replacement). Fonts via Fontsource packages,
  bundled — no Google Fonts request from a local tool.
- Logo: `src/assets/kratos-logo.svg`, imported as a component via `vite-plugin-svgr`
  (`?react`) so inlined it follows the theme; colors are CSS variables with the design's dark
  values as fallbacks, so the file is also a valid standalone SVG. (Owner request.)
- Connection: `useKratos` reads messages with `onMessage`, not `lastJsonMessage` — the old UI
  would have dropped all but the last message of a replay burst.
- State management (owner question): **Zustand, from 3c2** — today only `App` consumes the
  state; in 3c2 the message list, tool traces, Approve/Deny cards and Stop all need the log,
  pending asks and `send`, plus derived state. `react-use-websocket` keeps owning the
  connection and writes into the store; components select slices.
- TypeScript 7 gotchas: no `baseUrl` (shadcn's Vite guide still adds it; `paths` alone work);
  `vite-env.d.ts` needed for CSS/SVG imports.

### D38. UI: shadcn + shadcn's AI Elements, owner's Home design, absolute minimum (step 3c, owner)
- Kit: shadcn/ui with its AI Elements patterns (ui.shadcn.com/docs/ai-elements) — copied into
  `apps/web/src/components`, decoupled from the AI SDK (state passed as props), so they fit
  Kratos's own WebSocket protocol. Not the older `elements.ai-sdk.dev` registry: its docs say it
  moves into shadcn and is deprecated at the end of November 2026.
- Design: the owner's Kratos design artifact, Home screen — dark tokens (bg #111113, surface
  #18181B, mint accent #7CCFA6…), Bricolage Grotesque (display), Geist, Geist Mono — mapped onto
  shadcn's CSS variables.
- Scope cut: Home + conversation only; replies rendered with Streamdown (owner's choice); no
  sidebar/Recent (one session per project today, D36), no light theme, deny reasons, thinking or
  attachments yet.

### D37. Node 24, enforced (step 3p1, owner)
- `.nvmrc` = `24`; root `engines.node` = `>=24 <25`; `engineStrict: true` in `pnpm-workspace.yaml`
  so `pnpm install` refuses other versions (verified: Node 22 → `ERR_PNPM_UNSUPPORTED_ENGINE`).
  `@types/node` ^24 everywhere. pnpm comes from Node 24's corepack, matching `packageManager`.
- nvm's *global* default was left at 22 on purpose (it affects other projects); run `nvm use` in
  this repo. Switching before installing better-sqlite3 mattered: its native binding is built for
  one Node ABI (Node 24 = ABI 137).
- `allowBuilds`: better-sqlite3 `true` (native binding), esbuild `false` (from drizzle-kit; its
  script only verifies a binary that arrives via optional deps).

### D36. Persistence: SQLite via Drizzle + better-sqlite3, user data folder, resumable (step 3p, owner)
- *Location superseded by D44: the DB now lives in `~/.kratos/kratos.db`.*
- Owner choices: history *and* Claude's memory survive restarts; one `kratos.db` in the OS user
  data folder (`env-paths`; macOS `~/Library/Application Support/kratos`), never in the project;
  Drizzle ORM + better-sqlite3 (typed schema, drizzle-kit SQL migrations); the latest session per
  project resumes, older ones kept but not browsable yet.
- Alternatives considered: history only; DB inside each project; plain better-sqlite3; built-in
  `node:sqlite` (zero deps but prints an ExperimentalWarning on Node 22); a session list now.
- Design (my calls): the Kratos session id is also Claude's conversation id — first start
  `claude --session-id <id>`, every later start (crash or kratos restart) `claude --resume <id>`,
  decided by a persisted `agent_started` flag (resuming an id Claude never saw would fail). Asks
  still pending from a previous run are resolved as `cancelled` on load: the process that asked is
  gone; Claude can ask again after resuming.
- 3p2: `startSession` takes an optional `conversation: { id, resume }` (one object, so "resume
  without an id" can't be expressed); omitted = fresh unnamed conversation. Verified with the real
  CLI: `--session-id` + codeword, process stopped, new process with `--resume` recalled it; a fresh
  conversation (control) did not.
- 3p3: the hub owns the stored session (load on start, append on every publish, cancel stale
  asks, resume = agent started before — also fixes a crash-restart *within* a run, which would
  otherwise reuse `--session-id` for an existing conversation). `kratos --db <file>` overrides the
  default `<user data>/kratos/kratos.db` (useful for tests and separate histories). Verified with
  the real CLI: codeword told, kratos Ctrl-C'd and restarted, new tab got the replay and Claude
  recalled the codeword.
- Risks: pnpm blocks dependency build scripts by default, so better-sqlite3's native binary must
  be explicitly allowed; `--resume` failing (e.g. Claude's transcript deleted) would make every
  restart fail — handle if seen.

### D33. `--host` option, default `127.0.0.1` (step 3b, owner)
- `kratos -H/--host <host>`; default loopback. Any other host prints a startup warning: anyone who
  can reach it can make the agent edit files and run commands in the project — there's no login.
- Revisit when Kratos gets auth; until then, non-loopback is for trusted networks only.

### D34. `ping`/`pong` carry server info; no `hello` (step 3b, owner)
- A tab sends `ping` on connect (and any time, as a heartbeat); `pong` returns `{at, serverVersion,
  cwd, agent}`. The session log replay arrives on connect regardless of ping.
- Replaces the pushed `hello` message; ping/pong are no longer scaffold to be removed in 3c.

### D35. Shutdown on SIGINT/SIGTERM via `process.on`, not `once` (step 3b)
- Found: with `once`, kratos died with exit 130 mid-shutdown. execa's exit cleanup (`signal-exit`)
  re-raises the signal when it sees no other listener, and `once` had already removed ours. The
  `claude` child still died, but via emergency cleanup instead of `hub.close()`. With `on` + a
  guard, both signals exit 0 in ~1s with no `claude` left.

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
