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

### D64. Notifications: in the browser, while you're away, once across tabs (step 3w3, owner)
- Owner: browser notifications, only when you're not looking at Kratos; settings saved by
  Kratos; Play a sound on by default (the design has it off).
- Settings: `notifications { on, needsYou, finished, sound }` in `settings.json`, defaults on;
  `set_settings` replaces the group whole (the UI sends all four), so the server's shallow merge
  stays right. An unreadable group falls back to the defaults.
- Builds on 3r3's `useAttention` (approvals and questions while the tab was hidden), now:
  "Finished" = a session going from busy to idle (not marked done); "away" = tab hidden or its
  window not focused; each kind behind its switch, all behind Notify me.
- Once across tabs (`lib/notify.ts`): every tab sees the same session changes. A tab you're
  looking at keeps a mark in localStorage, and while one is marked nobody notifies (its title
  and favicon already show it). Otherwise a Web Lock per event (`kratos-notify:<session>:<status>`,
  held 5 s) lets the first tab show it and the rest skip. Alternatives: a BroadcastChannel leader
  election (more code, and the leader can't tell which tab you're looking at); notifications
  from the server (work with no tab open, but per-OS code and no click-through — owner chose the
  browser).
- Permission: "Notify me" shows on only when the browser allows it; switching it on asks (a click,
  as browsers require); "blocked" says where to unblock. Sending a prompt still asks once (3r3),
  unless Notify me is off. Notifications need localhost or https: over plain http on a LAN
  address the browser has no Notification API, and the popover says so.
- Sound: a two-note chime made with Web Audio (no file, no library), played by the notifying tab.
  Browsers only allow sound after a click in that tab: the audio is woken on the first click; a
  tab never clicked stays silent.
- Also: the favicon is redrawn when the theme changes (it had the old theme's colours).
- Not checked end to end in a browser (owner released first): the switches, cross-tab once and
  the chime were tested by type and unit tests only.
- Reverse: drop `notify.ts`, the Notifications section, `NotificationSettings`, and restore
  `useAttention`'s hidden-tab check.

### D63. Quick settings: settings kept by Kratos, themes as CSS token blocks (step 3w1, owner)
- Owner: build the design's quick settings (Home/Session boards) — themes first, notifications
  next; settings saved by Kratos, the same in every tab and browser.
- Settings: core `Settings` (zod; `theme` from `THEMES`, an unknown value falls back to the
  default) in `~/.kratos/settings.json` — per user like the logs, not per project like the
  database. `SettingsStore` reads it once (missing or unreadable = defaults, logged), writes a
  change to a temp file renamed over the old one (no half-written file), and tells listeners.
  Messages: `settings` (server → every tab, on connect and on change) and `set_settings`
  (partial; an unknown theme fails the zod check like any invalid message).
  Alternative: localStorage per browser (no server change, but each browser its own).
- Themes: the Themes board's 8 themes, all 19 app tokens each, as `[data-theme="…"]` blocks in
  `index.css` (Kratos Dark also on `:root`); shadcn's other names (`--popover`, `--sidebar`,
  `--ring`, charts…) derived in one `:root, [data-theme]` block. Declared on every themed
  element on purpose: a variable built from others is resolved where it's declared, so a nested
  `data-theme` (a swatch) gets its own colours. That's how the swatches are drawn — by their own
  theme's tokens, with no hex in components (CLAUDE.md UI rule). The Themes board, not the Home
  board, is the source: the Home board's copies are partial (some themes set 13 of 19).
- The page sets `data-theme` and the `dark` class (shadcn's `dark:` variants) on `<html>`;
  `color-scheme` comes with each theme. The last theme shown is cached in localStorage and
  applied by an inline script in index.html before the first paint, so a reload doesn't flash
  Kratos Dark while the WebSocket connects (checked: the theme is set at DOMContentLoaded). The
  picking tab applies a theme at once; the server's `settings` moves the others.
- Popover: shadcn's Popover (base-ui, like the other menus), added with the shadcn CLI.
- Not yet: code blocks and diffs keep `github-dark` in every theme until 3w2.
- Reverse: drop `settings.ts`, the two messages, the theme blocks (restore the `.dark` block),
  `quick-settings.tsx`, `lib/themes.ts` and the index.html script.

### D62. Headless `claude` gets artifacts and waits for MCP (step 3u7, owner)
- Owner: Claude Code in the terminal can read and update claude.ai artifacts (the design canvas);
  inside Kratos it can't, and MCP "doesn't work properly". Found by running `claude` with Kratos's
  exact flags and reading the CLI's own code (claude 2.1.308; nothing here is documented):
  - Artifacts: `sdk_default_off` — the `Artifact` tools are withheld when
    `CLAUDE_CODE_ENTRYPOINT` is `sdk-cli`/`sdk-ts`/`sdk-py` (`-p` is `sdk-cli`) unless
    `CLAUDE_CODE_ARTIFACT` is on. Interactive sessions have them. With `=1`, headless loads
    `Artifact`, `ArtifactComments`, `ArtifactData` (23 → 26 tools) and read the design canvas.
    They need a claude.ai login, which Kratos's `claude` uses (`apiKeySource: none`).
  - MCP: claude.ai connectors run "fully async (nonblocking)" in `-p`; `init` reports them
    `pending` and the first turn starts without them (~1 s later they're up). Kratos starts a new
    `claude` per session process — every Kratos restart and resume — so the model is told the
    connector "disconnected" / "still connecting", then "available again". That was the
    flakiness: this very conversation had three processes (14:48, 15:00, 15:27). A 150 s run
    showed no drops once connected. `CLAUDE_CODE_MCP_STARTUP_WAIT_MS=<ms>` (the CLI's "host
    wait") holds the first input until connectors are up: `init` then says `connected`, 34 tools.
    (`MCP_CONNECTION_NONBLOCKING=false` also works; the host wait is the knob meant for hosts.)
- Decision: the adapter starts `claude` with `CLAUDE_CODE_ARTIFACT=1` and
  `CLAUDE_CODE_MCP_STARTUP_WAIT_MS=10000` (a cap; it waits only as long as connecting takes),
  unless Kratos's own environment sets them. `JsonLinesProcess` takes an `env`, added to
  Kratos's own (execa's default).
- Also seen, not changed: `-p` skips the folder-trust prompt (interactive waits for it before
  loading MCP and hooks); headless has no `WebFetch` (cause not found — this session offers a
  `web-fetch` helper agent "where you have no WebFetch tool", so likely deliberate).
- Risk: undocumented internals can change in any Claude Code release. If they do, Kratos sessions
  lose artifacts or race MCP again, as before; nothing breaks. Re-check with
  `--debug-file` + the `init` message.
- Reverse: drop `cliEnv()` from `packages/adapter-claude-code/src/index.ts`.

### D61. Self-update: checking for a release (step 3u5a, owner)
- Owner: Kratos downloads and verifies a new release by itself, you click to restart into it;
  checks at start and every hour; a restart waits until no agent works; Homebrew installs are
  updated by Kratos *and* brew knows (3u5c settles how, without `brew update`).
- Check: GitHub's `GET /repos/ameerthehacker/kratos/releases/latest` with Node's `fetch` (10 s
  timeout, `user-agent: kratos/<version>`, which GitHub requires), the reply zod-checked. That
  endpoint never returns drafts or pre-releases; a `prerelease: true` answer is ignored anyway,
  and 404 means no release yet. Unauthenticated: 60 requests/hour per IP, we use one.
- Compare: `semver` (npm's own version library): `gt(latest, running)`, so 0.2.0 beats
  0.2.0-rc.1. Only a semver version checks at all: a source run shows a commit hash or "dev"
  (D57), so `pnpm dev` never calls GitHub.
- Failures (offline, rate limit, odd JSON, a non-version tag) are logged at debug and change
  nothing; the next hourly check tries again. A new version is announced at info once.
- Protocol: `update { status }` (core `UpdateStatus`), sent to each tab on connect and on every
  change, like `sessions`; not in a session's log. States for now: `idle | available` (+
  `version`, release `url`); 3u5b/3u5c add theirs when they exist rather than unused ones now.
- `apps/cli` now depends on `zod` directly (same range as core) to check GitHub's reply.
- UI (3u5d, owner: reuse the version pill). The design artifact couldn't be opened from the
  session (a claude.ai chat artifact the Docs tools can't read), so this follows Claude's draft:
  - Pill: unchanged when up to date; when a release is out, mint (`bg-primary/15 text-primary`)
    with a dot and "0.0.9 → 0.1.0". It's now a button for the dialog, not a link: the release /
    commit link moved into the dialog (one place for everything about the version).
  - Dialog (shadcn `Dialog`, `sm:max-w-md` — at `max-w-sm` the three buttons overflowed):
    title says available / up to date, "checked 4 minutes ago" (`Intl.RelativeTimeFormat`, no
    date library for one phrase), Release notes, Check again, Update & restart + "Kratos restarts
    by itself once every agent is done (N sessions working now)". Update & restart stays disabled
    until 3u5c can apply. Source runs: "Running from source" + View commit.
  - `check_update` (client → server): the server answers that tab with `update` after checking,
    even when nothing changed, so the button's spinner always settles. `checkedAt` (set when GitHub
    answers) makes every successful check a change, so all tabs see the new time too.
  - `KRATOS_VERSION=<semver>` (env) makes a source run act as that release, to try updates
    locally: `KRATOS_VERSION=0.0.9 pnpm dev` sees the real v0.1.0. A dev knob, not a flag: users
    have no reason to fake their version. 3u5b/3u5c will need a fake release server too (to try
    a download without publishing); added then.
- Download (3u5b): when a check finds a newer release, the updater fetches its `SHA256SUMS`, then
  `kratos-<v>-<platform>-<arch>.tar.gz` into `~/.kratos/updates/<v>/`, hashing while it streams
  (`.part` until it matches), and unpacks only `kratos` with `tar` (npm's own archive library,
  the common choice; rejects absolute and `..` paths). States `downloading` → `ready`; the
  archive is kept for brew (3u5c), and an archive still matching is reused, not fetched again.
  - "Not yet" vs error: the workflow attaches `SHA256SUMS` last, after every archive, so no
    `SHA256SUMS` (or no line for this machine) means the release is still building: back to
    `available`, quietly, retried at the next check. A checksum mismatch or a network failure is
    logged at warn and shown as `error` on `available` (not a state of its own): the dialog can
    say what failed, and the next check simply retries.
  - A local test server, not a fake fetch, for downloads: the real streaming, hashing, `.part`
    and unpack code runs. No fake release server for manual testing after all: `KRATOS_VERSION=
    0.2.0` + a temporary `HOME` downloads the real v0.3.0, which is the better check.
  - `parseSums` repeats the formula script's few lines: that script is plain `.mjs` outside
    `src/`, not part of the bundle.
- Reverse: delete `apps/cli/src/updater/`, its two lines in `index.ts`, the `updater` option in
  `server.ts`, `UpdateStatus` + the `update` message in core, the `update` case in the web store.

### D60. A busy port is an error, not a fallback (step 3u6, owner)
- Decision: if `listen` fails with `EADDRINUSE`, print one line through commander's `error`
  (like the other startup errors: "Not a folder", `claude` missing) and exit 1 — no stack trace.
- Alternative: quietly try the next free port. Rejected for now: the usual cause is a second
  kratos on the same port, and a silently different URL (with a second agent on the same project)
  is more confusing than a clear stop. Other listen errors (e.g. `EACCES`) still throw as before.
- Reverse: drop the `catch` around `startServer` in `apps/cli/src/index.ts`.

### D59. Node 26 (LTS), enforced the same way (owner, after W1's first Vercel deploys)
- Owner: move to Node 26. Vercel built on its Node 26 default whatever `engines` said (`>=24 <25`,
  then `24.x` — likely because the project reads `apps/site/package.json`, which has no engines),
  and pnpm's `engineStrict` refused it. Node 26 is the current LTS, so moving beats fighting it.
- Same lock as D37, one major up: `.nvmrc` = `26`, root `engines.node` = `26.x`, `engineStrict`
  still on; `@types/node` ^26 everywhere. `better-sqlite3` rebuilt for Node 26's ABI.
- Node 26 no longer ships corepack: on a new machine run `npm i -g corepack && corepack enable pnpm`
  (it then honors `packageManager`, pnpm 11.1.2). Done here under nvm's v26; nvm's global default
  is untouched.
- Checked on 26: clean install, build, typecheck, all tests (the store's tests load
  better-sqlite3's native binding).
- Affects the 3u single-binary plan (it names Node 24's SEA): build the binary with Node 26.
- Reverse: the D37 values back (`24`, `24.x`, `@types/node` ^24), reinstall on Node 24.

### D58. Website: Astro in `apps/site`, static, Tailwind with the app's tokens (step W1, owner)
- Owner: a website built with Astro, then cut to an ultra-simple one-pager (name, one line, the
  install command, a live session demo). Kratos ships via Homebrew from the owner's tap repo
  `ameerthehacker/homebrew-kratos` (`brew install ameerthehacker/kratos/kratos`; the formula comes
  with step 3u); source link `github.com/ameerthehacker/kratos`. Both live in
  `apps/site/src/site.ts`, one place to change. (Numbered D58: D54–D56 were taken on main while
  this was built, and the step-3u plan holds D57.)
- Shape: `apps/site` in the monorepo (turbo builds it with the rest; `dist/` like the others).
  Static output, zero JS by default; the only scripts are the copy button and the hero demo,
  plain TypeScript in Astro `<script>` tags (bundled by Astro) — no React on the site.
- Styling: Tailwind v4 through `@tailwindcss/vite` (Tailwind's documented Astro setup). Colors,
  fonts and radii are the app's dark theme (`apps/web/src/index.css`, D38), copied into the
  site's own `@theme` — same names (`bg-canvas`, `text-muted-foreground`, `bg-wait`…) and same
  CLAUDE.md UI rules. Dark only: the app is dark only today. Fonts self-hosted from the same
  `@fontsource-variable` packages (no Google Fonts request). Icons: `@lucide/astro` (the app uses
  Lucide). Copy buttons use `copy-to-clipboard`, as the app does (D47: the Clipboard API alone
  is refused in embedded browsers — the site check hit it too). The logo SVG is copied to `public/favicon.svg` (Astro can't import across packages
  without a build step; it's one small file).
- Typecheck: `astro check` (`@astrojs/check`) needs TypeScript 5 or 6, the repo is on 7 — the site
  pins its own `typescript@^6` dev dependency (pnpm keeps it local to `apps/site`).
- Dev: root `pnpm dev` skips the site (it's the dogfooding loop; a second dev server there is
  noise); `pnpm dev:site` runs it alone at http://localhost:4321.
- Alternatives: Next.js / plain Vite + React (heavier, JS by default for a static page);
  Starlight (great for docs, too opinionated for a landing page — revisit for docs later);
  plain CSS without Tailwind (would duplicate the token system the app already has).
- Reverse: delete `apps/site` and the two root scripts; nothing else depends on it.

### D57. Versions and releases (step 3u, owner)
- Owner: show the version as the design does, right in production, clicking opens its GitHub
  release; releases ship through a Homebrew tap updated by publishing a GitHub release; macOS and
  Linux; a single binary that serves the web UI; later, one-click self-update (3u5).
- Repos (owner): `ameerthehacker/kratos` (now the `origin`), tap `ameerthehacker/homebrew-kratos`
  — creating and pushing them is the owner's (outward-facing).
- Version source (3u1): one place, `apps/cli/package.json` `version`, which the release workflow
  sets from the tag. `0.0.0` means unreleased: Kratos then shows the short commit hash of the
  checkout it runs from (`git rev-parse --short HEAD` in its own folder, not the project's) —
  the design's default shows a hash too — else "dev". The server builds the link (release page,
  or the commit) and sends both in `pong` (`serverVersion`, `versionUrl`); `kratos --version`
  (commander) and the startup line print it.
- UI (the design's header pill, Home + Session): bare value, muted 11px mono on secondary, right
  after the wordmark. New (owner): it's a link, opening in a new tab, with a hover state.
- Rejected: hardcoding "0.0.0" (what the server did); reading the version from git tags at run
  time (a Homebrew install has no git checkout).
- No sharp (3u2): it was only for trimming macOS editor icons, and it carries libvips — native
  libraries a single binary can't easily take along. Now: `sips` converts the .icns (as before),
  `squareTrim` (pure JS, `pngjs`) crops the transparent border at sharp's threshold (alpha 10) and
  centres it on a transparent square, and `sips` resizes to 64px. Checked side by side against
  sharp's cached icons (VS Code, Xcode, Finder): same crop and size; pixels differ only by
  resampling (~2-3% mean per channel). Icons already cached keep being served.
- Single binary (3u3): `@yao-pkg/pkg` in its SEA mode (owner: use an existing package if it
  makes native binaries easy). It downloads stock Node for the target from nodejs.org (checksum
  verified, cached in `~/.pkg-cache`), packs our files into Node's official SEA blob with a
  virtual filesystem, injects it and ad hoc signs on macOS. Our code reads its files at the same
  paths as from source (`src/paths.ts`), and pkg extracts native addons to `~/.cache/pkg/<hash>/`
  on first run. `scripts/build-binary.mjs`: esbuild bundles `src/index.ts` to `dist/kratos.mjs`
  (ESM; a `require` shim in the banner for CommonJS deps), then `pkg` with the `"pkg"` config in
  apps/cli/package.json (assets: web UI, migrations, better-sqlite3's prebuilds).
  - Why the esbuild step: pkg's resolver can't follow pnpm's symlinked node_modules (it failed on
    execa's deps, and recreated better-sqlite3's folder as a dangling link). So everything is
    bundled except better-sqlite3, which is copied as a real folder (package.json, lib/,
    prebuilds/; no runtime deps) to `dist/node_modules/` beside the bundle. Its prebuild is chosen
    at runtime by platform, which pkg can't see, so the prebuilds are listed as assets.
  - Tried first, hand-rolled: esbuild to CJS + `node --experimental-sea-config` + postject +
    codesign, unpacking assets ourselves to `~/.kratos/runtime/<version>/` and loading SQLite via
    `nativeBinding` (~120 lines incl. a files module). It worked (130 MB) but was ours to keep;
    pkg does the same steps and can build other targets from one machine (it fetches their Node).
    Rejected: Bun's `--compile` (no better-sqlite3), classic pkg (patched Node from pkg-fetch),
    nexe/boxednode (stale / builds Node from source).
  - Logger: pino's worker-thread transports load files by path, which a binary can't; the console
    and the rotating file now go through `pino.multistream` in-process (`createLogger` is async).
  - Node: the binary is built on the Node that runs the build, 26 since D59 (esbuild target
    `node26`); pkg fetches the same major for other targets.
  - Size: 167 MB on macOS arm64 with Node 24 (Node itself is 117 MB; web UI 11 MB; SQLite prebuilds for all
    platforms 16 MB). An unreleased (0.0.0) binary shows "dev": no git checkout beside it.
  - pkg warns it can't pack `open`'s bundled `xdg-open` script; `open` falls back to the system's
    `xdg-open` on Linux, so nothing is lost.
  - Reverse: delete the script and the `"pkg"` config; `pnpm build` + `pnpm start` still work.
- Release workflow (3u4): `.github/workflows/release.yml` on `release: published`.
  - `check` (typecheck + tests) → `binary`, a matrix of native runners (`macos-latest` arm64,
    `macos-15-intel`, `ubuntu-latest` x64, `ubuntu-24.04-arm`): the version comes from the tag
    (`v1.2.3` → `npm pkg set version` in apps/cli, so the pill links to the release), then
    `pnpm build:binary`, a smoke test that `kratos --version` prints exactly that version, and
    `kratos-<v>-<platform>-<arch>.tar.gz` attached with `gh release upload`. Native runners rather
    than pkg's cross-building: each binary is smoke-tested where it runs, and macOS ones are
    signed on macOS.
  - `tap`: downloads the four archives, attaches `SHA256SUMS`, writes the formula with
    `apps/cli/scripts/homebrew-formula.mjs` (tested; `on_macos`/`on_linux` × `on_arm`/`on_intel`,
    `bin.install`, caveats saying `claude` is needed, `test do` checks `--version`), and pushes it
    to `ameerthehacker/homebrew-kratos` `Formula/kratos.rb` with the `HOMEBREW_TAP_TOKEN` secret
    (fine-grained, Contents read/write on the tap only). Pre-releases skip the tap, so a release
    can be tried before brew users get it. A missing secret fails the job with a clear message.
  - Checked locally: a `0.0.1-test` binary archived and run through the formula script,
    installed with `brew install` from a throwaway local tap (URL pointed at the local file):
    on PATH, signature valid, `brew test` passes, the server starts and serves the UI; then
    uninstalled and untapped. Not checked: the workflow on GitHub (no actionlint here; YAML
    parses), and Homebrew on Linux — whether brew's post-install processing of a Linux binary
    leaves pkg's injected blob intact is for the first real release to show.
  - Actions: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, pinned by
    major — the v4s ran on Node 20, which GitHub deprecated (0.1.0's run warned). Their breaking
    changes don't touch us: setup-node's automatic caching is npm-only and we set `cache: pnpm`;
    pnpm/action-setup v6 adds pnpm 11 support. First exercised by the next release.
  - Reverse: delete the workflow and the formula script; releases go back to manual.
- Opens the browser (owner, 3u3): `kratos` opens the UI in the default browser once it listens
  (`open`, already used for editors); `--no-open` skips it. `pnpm dev` passes `--no-open` (the UI
  is on Vite's port there, and tsx restarts would reopen it). Failing to open only warns.


### D56. Steering prompts: the agent holds them, Kratos follows each by id (step 3t, owner)
- Owner: send prompts while the agent works and see clearly what happens to each; design
  "Proposal · steering prompts (queue, send now, read)". Backend first.
- Found on the real CLI (2.1.308, tiny Haiku turns): a user message sent mid-turn is held and
  taken at the next step boundary *in the same turn* (the reply honoured it); sent during the
  final reply, it runs as the next turn. A message with a `uuid` gets `command_lifecycle
  {command_uuid, state}` lines — queued → started → completed | cancelled — with no flag needed
  (`--replay-user-messages` echoes too, but adds nothing). `cancel_async_message {message_uuid}`
  → `{cancelled}`; `interrupt {cancel_queued: true}` stops and cancels all waiting; a plain
  interrupt lets waiting prompts run right after; `interrupt {send_now: true, message_uuid}`
  stops the step and delivers *all* waiting prompts (3t2). The CLI also reports its own messages
  (e.g. "[Request interrupted…]") — the adapter only follows ids it sent.
- Risk: these requests are undocumented — found in the CLI's own strings (its SDK uses them, and
  init advertises `interrupt_cancel_queued_v1` / `interrupt_send_now_v1`). If they change, the
  fake claude's tests won't notice; the real-CLI check at each step will.
- Shape: the agent owns the queue (it decides where a prompt lands); Kratos sends a prompt at once
  and follows it. Core: `send(prompt, files, {id})`, AgentEvent `prompt_state`, `cancelPrompt`,
  `interrupt({cancelQueued})`. Alternative: Kratos holds the queue and sends at turn end — but
  then it can't steer mid-turn, which is the point.
- Log: `prompt_queued {id, text, attachments?}` → `prompt_read {id, how: step | next_turn,
  after?}` (after = the tool call that had just finished) or `prompt_removed {id, reason:
  removed | stopped}`; `prompt_state` events themselves aren't logged. A prompt read after the
  turn ended reopens the turn (the agent started it by itself). Replay: the timeline puts a read
  prompt in the chat where it was read; queued ones stay out of it (the queue card is 3t3).
- Stop (owner): with a queue, Stop stops everything (`cancel_queued`), and once every withdrawn
  prompt is settled the tab that pressed Stop gets their text (`prompts_returned`, not logged)
  for its composer. Files of returned prompts aren't returned. An agent that exits, a shutdown or
  a restart drops a leftover queue (`prompt_removed stopped`).
- `SessionSummary.queued` for "Working · 2 queued".
- Send now (3t2, owner: only the chosen prompt goes; the CLI's own delivers everything it holds):
  the runtime withdraws the *other* queued prompts from the agent (`cancelPrompt` — their
  `cancelled` is swallowed, they stay queued for tabs), calls `sendNow` (`interrupt {send_now,
  message_uuid}`), and once the withdrawals are done *and* the chosen prompt is read, sends the
  others again under new agent ids — same Kratos ids, same order, same files. Waiting for both
  avoids a race where a re-sent prompt joins the chosen one. Agent ids map back to Kratos ids, and
  lifecycle lines for an old agent id are ignored. The chosen prompt is logged `prompt_read {how:
  "now", stopped}` with the step (tool call) that was running. One Send now at a time.
- UI (3t3, the design, fitted to today's composer): while the agent works the placeholder is "Add
  to the queue…" and, with text, the send button becomes Queue (↵); ⌘↵ / Ctrl↵ sends now — the
  hints live in the button's tooltip, not key caps (the composer dropped those in 3q2). The queue
  card above the composer is built from the log (`openQueue`), so every tab and a reload show
  it; Edit = remove + text back into the box, which is also where Stop's returned text goes
  (`insert` prop). Read prompts join the chat where they were read, with "Read after <step>",
  "⚡ Sent now · stopped <step>" or "Sent when the last turn ended" (a read with no step before it
  says "Read while working"); the step Send now cut short reads "Stopped <doing>", and the
  generic "Stopped" line it causes is dropped. "N queued" in the working line and status.
- Reverse: additive — without ids nothing is followed, and prompts mid-turn behave as before.

### D55. File attachments: inline with the prompt, stored by id, checked against the harness (step 3s, owner)
- Owner: attach files to a prompt; backend first (the design has no attachments yet).
- Found on the real CLI (2.1.308, tiny Haiku turns): the stream-json user message's `content` can
  be a list of blocks — `image` (base64), `document` with a base64 PDF, `document` with
  `source: {type: "text"}` and a `title` — and the agent read all three correctly. Nothing has
  to be written into the project, and Claude keeps them in its own transcript for later turns.
- Shape: each adapter declares an `AttachmentPolicy` (kinds image / pdf / text with media types
  and max bytes; max count and total), sent to tabs in `Harness.attachments`; core's
  `classifyAttachment` / `checkAttachmentSet` decide — pure, so the UI can check before sending.
  Text is judged by content (UTF-8, no NUL), since browsers often don't know a `.ts` file's type;
  anything else that isn't an accepted image/PDF type is refused (an SVG is text, never an image).
  `AgentSession.send(prompt, attachments)` takes agent-neutral `{name, kind, mediaType, data}`;
  the Claude adapter puts the files' blocks first, then the prompt text.
- Claude's limits: images png/jpeg/gif/webp ≤ 5 MB and PDFs ≤ 30 MB (the Claude API's), text
  ≤ 1 MB, ≤ 10 files and 30 MB per prompt (under the API's 32 MB request cap).
- Transport: base64 inline in the `prompt` WebSocket message (`ws` accepts up to 100 MiB).
  Alternative: upload each file over HTTP first (`@fastify/multipart`) and send ids — progress
  bars and early errors, but half-uploaded leftovers to clean up and a second place to check.
  Inline keeps one check, before anything starts; a refused prompt isn't sent and the tab is
  told why. Revisit if files get big or uploads need progress.
- Storage: bytes in a file named by Kratos's own random UUID in `attachments/` next to the
  database (`.kratos/attachments/` for `pnpm dev`, git-ignored; ~/.kratos/attachments
  otherwise); an `attachments` table (migration 0006) knows name, kind, type, size, session. The
  session log's `user_prompt` carries only those refs, never bytes.
- Serving: `GET /attachments/:id` — looked up by id, only this project's sessions, ids checked as
  UUIDs before any disk access (no path from the browser). Never run in the page: text kinds are
  served as `text/plain`, with `nosniff` and a `default-src 'none'` CSP.
- UI (3s2, design "Proposal 3s2 · attachments", options 1 + B): "+" first in the composer row;
  drop on the card (only the card is the target) or paste; files are checked in the tab with
  core's `classifyAttachment` / `checkAttachmentSet` before sending, so the server's refusals
  rarely happen. Images as 56px thumbnails from a local object URL (freed on remove, send and
  unmount), other files as chips; a refused file stays red until removed and blocks send; over
  the count/total, the extra files aren't added and an amber note names them. Files are read
  with `FileReader` (data URL → base64), sizes shown with `pretty-bytes`. Dropping, pasting and
  the "+" file picker are `react-dropzone`'s (`useDropzone`: the card is the drop root; `noClick`,
  `noKeyboard`, plain file input) — owner: library over hand-rolled drag events (it handles the
  drag-leave flicker over child elements and pasted files); it accepts everything, so our own
  check marks refused files visibly instead of dropping them. Kept ours: renaming a pasted
  "image.png" to "pasted-image.png". The composer's file logic lives in `useDraftFiles`; the card
  only lays things out (owner: "prompt card is getting big"). Sent: thumbnails open a
  shadcn Dialog lightbox; PDFs and text open `/attachments/<id>` in a new tab (never rendered in
  the page). Vite's dev server proxies `/attachments` like `/ws`.
- Reverse: additive — the table and folder can stay; drop `attachments` from the prompt.

### D54. Agent questions: their own callback and messages, answers checked by the server (step 3r, owner)
- Owner: support the agent asking questions (Claude's AskUserQuestion), per the design's question
  card ("Proposal · question widget"); backend first.
- Found on the real CLI (2.1.308, tiny Haiku turns): the question is a `can_use_tool` ask for
  `AskUserQuestion` (`requires_user_interaction: true`), input `questions: [{question, header,
  multiSelect, options: [{label, description}]}]`. Answer = allow with that input plus
  `answers: {"<question>": "<labels and own text, joined with ', '>"}`; skip = deny with a
  message, and the agent carries on; allow *without* answers = "the user did not answer" —
  so Kratos never sends it. `annotations: {"<question>": {notes}}` also works (unused: the design
  has no notes).
- Shape: agent-neutral `AgentQuestion` / `QuestionRequest` / `QuestionReply` (answered: per
  question `selected` labels + optional `other` text; or skipped) in core, and a second session
  callback `askQuestions` beside `requestPermission` rather than squeezing questions into
  PermissionDecision: they aren't allow/deny, and the UI shows them differently. The adapter
  routes AskUserQuestion there; without a callback, or with input it can't read, it denies
  ("make your own call"), never a bare allow.
- Claude marks its pick by ending a label with "(Recommended)": the adapter turns that into
  `recommended: true` (the design's tag) and maps answers back to the agent's own labels.
- Protocol: `question_request` / `question_resolved {outcome: answered | skipped | cancelled,
  answers?}` are in the session log, so a replay shows how questions ended (answers included);
  `question_answer {id, reply}` is checked by the server with core's `checkQuestionReply` (one
  answer per question, known labels, one choice for single-choice, nothing empty) and refused
  with the reason otherwise. Late answers (another tab won, or withdrawn) are ignored quietly,
  like late permission decisions. Status `needs_answer` ("Needs your answer", amber) wins over
  `needs_approval`.
- Withdrawn by the agent, or left open by a restart → `cancelled` ("Not answered"); shutdown →
  cancelled, and the agent hears "skipped".
- UI (3r2), per the design's question widget: a card above the composer (like the ask dock):
  "Claude Code has 2 questions", Skip; tabs per question with a green check once answered;
  radio/checkbox rows (≥44px) with the "Recommended" tag and number keys; an "Other" field
  (typing picks it; single choice: instead of an option); Back / Next / Send answers, enabled by
  core's `checkQuestionReply` — the same rule the server enforces. Keys 1–9 pick, ↵ next/send,
  Esc skip; the card takes focus when it shows unless you're typing elsewhere. In the chat the
  agent's AskUserQuestion call becomes a question step: "Asking 2 questions · Waiting for you" →
  "Asked 2 questions" with chips per answer ("Docs · Hub, Readme, “Changelog”"), "You skipped ·
  Claude Code decides", or "Not answered". A skip comes back to the CLI as an error result: the
  timeline doesn't add "Failed" to question steps.
- Getting your attention (3r3, the design): a hook in the layout. Tab title counts sessions
  waiting on you — approvals too, they block the agent the same way ("(1) Question · Kratos",
  "(2) Approvals · Kratos", mixed "Waiting for you"); the favicon is now the Kratos logo
  (inlined from `kratos-logo.svg`, a data URL) with an amber dot in the theme's `--wait` while
  anything waits. A favicon is drawn outside the page, so CSS variables don't resolve in it: the
  logo's `var(--primary, …)` colours are replaced with the theme's current values (owner) — the
  file's fallbacks only if the theme has none. A system notification (browser Notification API) when a session *starts*
  waiting while the tab is hidden — not for ones already waiting at page load — titled "Claude
  Code has a question" (body: the question, for the viewed session; else its title) or "… needs
  your OK"; tagged by session so a newer one replaces it; click focuses and opens the session.
  Permission is asked once, from a click (sending a prompt), as browsers require; never again
  after you answer. Alternative: a settings toggle — later, with Settings.
- Reverse: additive — drop the callback (questions are then refused) and the messages.

### D53. Permission modes: the harness's own, switched live, Bypass only with consent (step 3q, owner)
- Owner: choose permission modes like the harnesses allow (auto, accept edits, …), including
  Bypass, but only after a consent dialog; Home remembers the pick like model and effort.
- Found on the real CLI (2.1.308; tiny Haiku turns in a scratch folder under $HOME — a /tmp
  folder skews it: macOS's /tmp symlink makes every write "outside allowed working directories"):
  - default asks for edits and commands; acceptEdits lets edits and file commands (`touch`)
    through; auto asked Kratos nothing (its own checker); dontAsk refused both without asking;
    plan writes its plan to `~/.claude/plans/`, asks via `ExitPlanMode {plan}`, and on approval
    switches itself to default; bypassPermissions needs the CLI started with
    `--allow-dangerously-skip-permissions` to be switchable (it isn't turned on by it).
  - `set_permission_mode {mode}` → `{mode}` applied ("manual" → "default"); unknown modes are
    refused by the CLI. Every change, the agent's own included, comes as `system`/`status` with
    `permissionMode`; each turn's `system`/`init` repeats the current one.
- Shape: `AgentPermissionMode {id, label, description, isDefault?, dangerous?}` on the adapter
  (Claude's six are known to the adapter: the CLI has no request that lists them);
  `startSession({ permissionMode })`, `setPermissionMode()` → applied mode; AgentEvent
  `permission_mode` only on a real change (the adapter drops the per-turn repeats), so Kratos
  follows switches the agent makes itself. It goes into the session log like any agent event.
- Consent is enforced by the server, not just the UI: a `dangerous` mode in `set_permission_mode`
  or a Home `prompt` is refused unless `confirmDangerous: true` (sent only after the consent
  dialog — or, for a remembered Bypass, from the consent that stored it),
  and a refused Home prompt starts nothing. Unknown modes are refused before reaching the agent.
- Every Claude process starts with `--allow-dangerously-skip-permissions`, so Bypass can be
  switched on mid-session without restarting the agent. Alternative: restart (resume) the agent
  with `--permission-mode bypassPermissions` when chosen — no flag on other sessions, but it
  can't happen mid-turn. Only Kratos sends control requests, and the server gates the switch.
- Store: `sessions.permission_mode` (migration 0005) = chosen or last reported; null = never
  chosen. Resume passes it, so a session keeps its mode across restarts (Bypass included —
  consent is per session, given once).
- UI (3q2, owner picked design option A of three): the composer drops its key-cap hints to make
  room; a mode chip ("✋ Ask ▾") sits after the agent chip; its menu ("Permissions") lists each
  mode with its description, the dangerous one apart in red; picking it opens a shadcn
  AlertDialog ("Turn off all permission checks?" — Cancel / Turn off checks) and only its confirm
  sends `confirmDangerous`. Icons come from an agent-neutral `kind` (ask, edits, plan, auto,
  never_ask, bypass, other) plus a `shortLabel` on each mode, so the UI never knows Claude's ids
  (like ToolAction). Memory (owner: "new session does not carry the last mode"): the last mode
  picked — on Home or inside a session — is what new sessions start in. That includes Bypass
  (owner, reversing my first cut, which never remembered it): it can only be stored after its
  consent dialog, which now says "New sessions will start this way too, until you pick another
  mode", and Home then sends `confirmDangerous` with it. Trade-off accepted: one consent covers
  later sessions; the red chip on Home keeps it visible. Agent-made switches
  (leaving plan mode) don't change that memory: only your picks do. Desktop widths only (owner:
  mobile will be its own app); chips just truncate in a very narrow window.
- Later: a plan-approval card for `ExitPlanMode` (today a generic ask).
- Reverse: additive — drop `set_permission_mode`/`permissionMode` and the allow flag.

### D52. Working indicator: the real step, or a word, shimmering (step 3d6, owner)
- Owner: no "thinking…" loader like other agent IDEs; add one with a nice animation, not just
  "Thinking". Owner's picks from options: say the real step + playful words between steps;
  shimmer + glyph animation.
- What it says: the newest step of the turn that hasn't finished and isn't waiting for an
  answer, in -ing form — a new `Step.doing` next to `title`/`intent` ("Reading store.ts",
  "Running the tests", or the agent's own description of a command). Between steps (thinking,
  writing the reply) it cycles forge-flavoured words (Thinking, Forging, Tempering…) every ~3s.
  Pure `currentActivity(items)` in timeline.ts, unit-tested.
- When: mounted while the session isn't idle, so its timer counts the whole turn; hidden (not
  unmounted) while an ask waits — the ask dock speaks then. Elapsed counts from when this tab
  saw the turn start: the log has no timestamps, so a reload mid-turn restarts it.
- Animation: CSS only — `@utility text-shimmer` paints a muted→foreground→muted gradient
  through the text, moved by `animate-shimmer` (theme keyframes). Beside it, the Kratos logo's
  hammer (owner: "more relatable to Kratos"; picked over a logo tile or a hammer on an anvil):
  the logo's two shapes, no tile, seen side-on — raised near upright, it swings ~90° about the
  grip so the head's end comes down, and three sparks fly from the hit (`animate-hammer`,
  `animate-spark`, one 1.2s loop). A first draft tipped only ~50° and its sparks appeared in
  empty air; checked frame by frame, enlarged. Reduced motion: no sweep, no swing, no sparks,
  words don't cycle.
- Libraries: `usehooks-ts` (`useInterval`, `useMediaQuery`) instead of hand-written interval and
  media-query hooks (owner: library-first). The "8s / 1m 05s" format stays three lines:
  date-fns' formatDuration writes "1 minute 5 seconds".
- Screen readers: `role=status` with the step as its label, so word changes aren't announced.
- Reverse: drop `WorkingIndicator` and `Step.doing`; nothing else depends on them.

### D51. Effort level: set by Kratos, read back from the agent (steps 3m3–3m4, owner)
- Owner: choose how hard the agent thinks from the chat box; it shows the level really in use
  ("Real level"), not a "Default" guess. In 3m4 it lives in the model chip: "Opus 5.5 · High",
  with an Effort submenu (owner, from Claude's own picker), not a chip of its own.
- Found on the real CLI (2.1.308; no prompts sent, so no tokens):
  - `initialize` → each model's `supportedEffortLevels` (low/medium/high/xhigh/max; Opus 4.6
    and Sonnet 4.6 lack xhigh; Haiku 4.5 has none). → `AgentModel.efforts` (absent = none).
  - `--effort <level>` sets it at start; an unknown value is ignored with a warning.
  - `apply_flag_settings {settings: {effortLevel}}` changes it live. Undocumented: it is what
    the CLI's own remote control uses — the risk is that a CLI update changes it; the adapter
    tests (fake claude) and a real check at each step catch that.
  - `get_settings` → `applied.effort` is the level the running model really gets
    (`effective.effortLevel` only merges settings files and was wrong here: xhigh in
    ~/.claude/settings.json, yet Opus ran high and Haiku medium). Works without `initialize`.
  - The CLI clamps on its own: xhigh then a model without it → high; a model with no effort →
    null; back to a model with xhigh → xhigh again. So a start `--effort` needs no checking.
  - Gotchas: `effortLevel: null` ("clear") lands on medium, not the default the session started
    with; a made-up live level ("turbo") gets "success" and changes nothing.
- So: Kratos never sends "clear" (no null in `set_effort`); the adapter refuses a live level the
  current model doesn't list (else the UI would show a switch that never happened); after a
  start, a model switch or an effort switch, the runtime asks `effort()` and lists that.
- Data: `sessions.effort` (migration 0004; the choice, null = never chosen); `prompt.effort`
  (Home's pick, applied when it starts a session, like `model`); ClientMessage
  `set_effort {effort}`; `SessionSummary.effort` = the agent's last report, else the choice,
  else null (agent never ran). A level chosen while no agent runs is stored unchecked and
  passed at the next start, where the CLI clamps/ignores it.
- A failed read is only logged (the list keeps the choice); a refused switch is an error in
  the conversation, like a failed model switch, and the old level stays.
- UI (3m4): in the model chip, not its own chip (owner): "Claude Code · Haiku 5.5 Low"; an
  "Effort  Low ›" row opens a submenu of the model's levels with a check on the one in use
  (Base UI submenus open on hover/arrow key). No row for a model without levels. The chip
  never shows a level the model doesn't list (e.g. for the moment after a model switch before
  the agent reports the clamped level). On Home a pick is remembered with the model choice
  (`kratos.home-choice`) and dropped if the chosen model lacks it.
- Level words: Claude's ids → Low/Medium/High/Extra high/Max; an unknown id is capitalized
  with `lodash-es` `capitalize` (owner: library-first; lodash-es is the ES-module build, so
  Vite only bundles the functions imported).
- Reverse: additive — drop `set_effort`/`effort`; the column can stay.

### D50. Project chip + open in editor (step 3d3, owner)
- Owner: the header's raw path should look modern and open the project in various editors.
  Now a pill (folder icon, project name, chevron; full path in its menu) whose menu opens the
  project in an installed editor, reveals it in the file manager, or copies the path.
- Detection at start (`apps/cli/src/editors.ts`): a fixed list (VS Code, Cursor, Zed, Windsurf,
  WebStorm, IntelliJ, Sublime, Xcode). On macOS an editor counts if its .app is in
  /Applications or ~/Applications — its CLI often isn't on PATH (here: VS Code without `code`);
  elsewhere, if its CLI is on PATH (`which`). Sent to tabs in `pong.editors`.
- Safety: the browser only sends `open_in {editor}` with an id; the server checks it against
  the detected list and only ever opens the project folder — no command or path from a tab.
- Launch: the `open` package (sindresorhus; `open -a "<App>" <dir>` on macOS, the CLI name
  elsewhere). Failures go back to the tab as an error and to the log.
- Real logos (owner): `simple-icons` has no VS Code logo (Microsoft had it removed), so Kratos
  uses each installed app's own icon: `plutil` finds the icon file named in the app's
  Info.plist, `sips` converts the .icns (both built into macOS), and `sharp` trims the
  transparent padding macOS icons carry so the tile sits level with text (owner: "logos not
  sitting well" before the trim; sharp was replaced by `sips` + `pngjs` in 3u2, D57). Cached in `~/.kratos/cache/editor-icons`, served at
  `/editor-icons/<id>.png` for detected ids only (404 otherwise). Off macOS: a generic icon.
- The chip shows the editor you used last (remembered per browser), else the first one found,
  else a folder. The connection dot moved into the chip, with a tooltip saying what it means
  (shadcn Tooltip, opening below; rendered as a span).
- One-click open (3d5, owner): the chip is a split pill — the logo and name open the project in
  the chip's editor (Finder if none was found), the chevron opens the menu. The dot sits
  between the two buttons, not inside one, so its tooltip doesn't nest in the button's.
  The menu marks the pill's editor "Default" — the same one a click opens, picked or first
  found — so the mark and the chip never disagree (it was "Last used", only after a pick).
  Whatever you pick from the list becomes the default, Reveal in Finder included (owner; it had
  been left out on purpose, so picking Finder seemed to change nothing).
- Reverse: drop the menu; `pong.editors` and `open_in` are additive.

### D49. Done sessions (step 3d2, owner)
- Owner: mark a chat done; the sidebar has **Working** and **Done** sections (owner kept the
  names even though "working" is also a live status); marking moves it. Owner's answers: a new
  prompt reopens a done session; mark/reopen from the session header, sidebar rows and Recent
  rows; Recent hides done sessions.
- Data: `sessions.done_at` (migration 0003, null = not done), `SessionSummary.done`,
  ClientMessage `set_done {id, done}` — by id, so a row can act on any session of the project
  (other projects' ids are refused, like `open_session`). Marking is housekeeping: it doesn't
  bump `updatedAt`, so Recent order stays put.
- UI: one `DoneButton` (icon for rows, shown on hover/focus; labelled pill in the new session
  header). In rows it sits beside the link, not inside it (a button can't live in a link).
- Sections collapse (owner): Done starts collapsed; the open/closed state is remembered per
  browser (zustand `persist`, `kratos.sidebar`), since the sidebar remounts when toggled.
- Sidebar hides fully (3d4, owner, per the design): closed, the island is gone — no icon rail —
  and a "Show sessions" button sits at the left of the main header. Whether it's open is kept
  in the same `kratos.sidebar` store (closed by default), so it survives reloads.
- Quieter header (3d7, owner): the labelled "Mark as done" pill became a ghost check icon with a
  tooltip beside the status; once done, the status is replaced by a green "✓ Done" chip that
  reads "↺ Reopen" on hover/focus — in red (`destructive`, owner): it undoes the state — and
  reopens on click (owner asked to call it Reopen; it keeps
  "Done" at rest because it's the header's only sign of the state). Both labels share one grid
  cell, so the chip doesn't change width. Rows keep their hover icon.
- Done at the bottom (3d8, owner: "it requires least attention"): the sidebar's Done section is
  pinned to the bottom of the island instead of following Working. Each scrolls on its own;
  Done is capped at half the height so a long done list can't push Working away.
- Reverse: drop the column/message; the UI only filters on `done`.

### D48. Relative times: date-fns (step 3d1)
- Recent rows say when a session was last active ("5 minutes ago"). Library-first for dates
  (CLAUDE.md): `date-fns` `formatDistanceToNowStrict` — tree-shakeable, the common choice.
  Alternative: the built-in `Intl.RelativeTimeFormat`, which needs hand-picked units/rounding.
- Reverse: one call in `components/recent-list.tsx`.

### D47. Copying prompts: copy-to-clipboard (step 3c5, owner)
- Owner: a copy button on your prompts. Library-first: `copy-to-clipboard` v4 (async; tries the
  Clipboard API, falls back to `execCommand("copy")`; its `window.prompt` last resort is off).
- Why not `navigator.clipboard` alone: tried first — it's refused outside secure contexts (e.g.
  `--host 0.0.0.0` over plain http) and in embedded browsers, which the real run hit ("Write
  permission denied"). A failed copy is logged via `clientLog` (D44).
- UI: a small icon button under each prompt bubble, shown on hover / keyboard focus, a check
  for 1.5 s after copying. Reverse: `components/conversation/prompt-bubble.tsx`.

### D46. Agent boundary: null = default model, asks name their call (step 3c4, owner)
- Owner asked whether we're coupled to Claude Code. A check found two leaks: the UI knew
  Claude's `"default"` model id, and matched asks to steps by tool name + order (true only
  because Claude sends the call before the ask).
- Now: "the agent's default" is `null` everywhere outside adapters (`set_model`, session
  model, `AgentSession.setModel(null)`); the adapter maps it to its agent's own name
  (Claude: `"default"`) and marks that list entry `isDefault` so the picker can show it.
  `PermissionRequest` carries `toolCallId` (Claude's `tool_use_id`, checked on the real CLI to
  equal the `tool_use` block id) and the generic `action`; the timeline attaches asks by id,
  keeping the name + order match only for logs from before this.
- Also: a denied step keeps its present-tense title ("Write b.txt · You denied this").
- Still agent-specific on purpose: raw `tool`/`input` (shown under "Show raw", no logic on it),
  the Claude logo for harness `claude-code` (presentation), and `apps/cli/src/index.ts`
  choosing the adapter.
- Reverse: `toolCallId`/`action`/`isDefault` are optional; `null` could become a sentinel again.

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
- 3c3 (owner picked option C of three sketches; the amber card looked heavy): the ask docks
  above the composer — "Claude Code wants to write notes.txt", Deny / Allow, and a readable
  preview: a diff for edits (jsdiff `diffLines`; `−`/`+` lines), the highlighted command for
  runs, the raw call otherwise. The step in the chat only shows "Waiting for you" and reads in
  present tense until answered. Several open asks: oldest first, "1 of N". For the preview the
  adapter adds `edits: [{before, after}]` to `action` (Write = before ""), each side capped at
  8000 chars with `truncated` — the log already stores the full call, so this is a capped copy.
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

### D37. Node 24, enforced (step 3p1, owner) — **superseded by D59 (Node 26)**
- `.nvmrc` = `24`; root `engines.node` = `24.x` (was `>=24 <25`, same range; changed for W1 because
  Vercel ignored the two-part form and built on its Node 26 default); `engineStrict: true` in `pnpm-workspace.yaml`
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
- Root `vitest.config.ts` (owner): Vitest's default excludes plus `.claude/**`. Agent sessions keep
  git worktrees in `.claude/worktrees/` (whole repo copies on other branches); without this,
  `pnpm test` also ran their tests, which failed there.

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
