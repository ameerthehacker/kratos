# Kratos plan

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done (with proof noted)

Goal of milestone 1: **Kratos can host its own development** — a session started from the Kratos
UI, running Claude Code, enforcing plan → scoped step → proof → walkthrough → gate.

## Milestone 1 — self-hosting

- [x] **0. Scaffold** — turborepo, `kratos` CLI serving the web app, WebSocket hello/ping,
      draft core types, v0 guardrail hooks. Scope: everything.
- [x] **0b. Library-first pass** — replace hand-rolled code from step 0 with standard libraries
      (Fastify, zod, commander, react-use-websocket; hooks: picomatch, simple-git, shell-quote).
      Scope: `apps/**`, `packages/core/**`, `.claude/**`, root config. Accept: build + typecheck
      pass, server and hook checks re-run with the same results as step 0.
- [x] **1. Agent interface review** — owner reviews and finalizes the draft `AgentAdapter` /
      `AgentEvent` types in `packages/core/src/agent.ts`. Scope: `packages/core/**`.
      Accept: owner can explain each type; decisions logged.
- [x] **2. Claude Code adapter** — spawn the `claude` CLI in its RPC mode (`-p` with stream-json
      in/out and `--permission-prompt-tool=stdio`), speak its JSON-lines + control protocol
      directly (no SDK), map its messages to `AgentEvent`s. New package
      `packages/adapter-claude-code`. Split per D24: this step = `protocol.ts` + `index.ts`.
      Accept: a throwaway script sends prompts and prints normalized events (deny, allow,
      multi-turn, interrupt).
- [x] **2c. Demo script** — `pnpm --filter @kratos/adapter-claude-code demo --cwd <dir> "<prompt>"`; owner
      answers permission prompts in the terminal. Scope: `src/demo.ts` (already drafted).
- [x] **2d. Process manager class** (D26) — generic `JsonLinesProcess` (execa): spawn, send JSON
      line, iterate parsed stdout lines, `exited`, graceful `stop()` (close stdin → SIGTERM →
      SIGKILL), safe writes after exit, kill on Kratos exit. Adapter becomes protocol-only and
      reports a mid-turn crash as `turn_end: error`. Scope: adapter `src/` + package.json.
      Accept: real CLI run still passes; crash, write-after-exit, stop and orphan checks pass.
- [x] **2b. Budget system v2** (D24) — budgets measure review load (insertions, in-scope files,
      config/lockfiles/docs excluded); steps declare an `estimate` up front; warn at 80%; over
      budget → owner chooses extend / checkpoint / split. Scope: `.claude/**`.
      Accept: hook test cases pass; CLAUDE.md rule 3 rewritten.
- [x] **2e. Remove v0 guard hooks** (D27) — owner found them more friction than help. Hook
      scripts, their settings entry, hook-only deps and `.kratos/` removed; CLAUDE.md rules kept as
      practice (plan, small steps, decisions, proof, walkthrough, gate) without enforcement.

### Tests for what's built (before step 3) — approved by owner

Rule for inclusion: a test exists only if a break would be **silent** and would hurt the
**permission gate**, **process safety**, or the **guardrails**. Fast, deterministic, no network,
no real `claude`, no tokens. Runner: Vitest (one root `pnpm test`), tests next to the code.

- [x] **T1. Vitest setup + `JsonLinesProcess`** (~90 lines) — with fake `node -e` children:
      exit reported with `requested:false` + code on crash; non-JSON lines skipped; `send()` after
      exit returns `false` and nothing throws; `stop()` graceful when the child exits on stdin
      close; `stop()` escalates to SIGKILL when SIGTERM is ignored (generous time bounds).
- [x] **T2. CLI → AgentEvent mapping** (~100) — move `toEvents` to a pure `src/map.ts` (no
      behaviour change). Cases: text; empty `thinking` dropped; `tool_use` → tool_call;
      `tool_result` with string / text-array / missing content + `is_error`; unknown block kinds
      skipped; sub-agent messages skipped; `result` success / error subtype / after interrupt.
- [x] **T3. Permission gate over the control protocol** (~170, may need an extension) — a small
      fake `claude` script (speaks the D23 protocol, scripted by prompt) passed via `claudePath`:
      allow → `control_response` allow with original input; allow + `updatedInput` → forwarded;
      deny → message forwarded; **callback throws → deny (fails closed)**; `control_cancel_request`
      → AbortSignal fires and **no** response is written; non-`can_use_tool` request → error
      response; `interrupt()` sends the interrupt request and turn ends `interrupted`; process
      dies mid-turn → `turn_end: error`.
**Deliberately not tested now (and why)**
- Guard hooks — removed in 2e (D27), nothing left to test.
- zod schemas in `core` — declarative; a test would be testing zod.
- `apps/cli` server (static files, ping/pong) — placeholder; step 3 rewrites it, tests come then.
- Web UI, demo script, `which` lookup — trivial wiring or dev-only; visible when broken.
- Real `claude` CLI behaviour — not a unit test (slow, costs tokens, nondeterministic). The fake
  in T3 can drift from the real protocol; a separate opt-in smoke script (`pnpm smoke`, the
  existing scratch proof) is the guard for that — later, not in this batch.
- Orphan cleanup on parent exit — execa's `cleanup` guarantee, verified once in 2d.

- [ ] **3. Session over WebSocket** — one shared session per server, used from the browser
      (D31, D32). Split into three working slices (approved by owner):
  - [x] **3a. Session hub + protocol** (~200) — `packages/core` protocol gains: client `prompt`,
        `interrupt`, `permission_decision`; server `user_prompt`, `agent_event`,
        `permission_request`, `permission_resolved`. (In 3b, `hello` was dropped: `pong` carries
        the server info instead — D34.)
        `apps/cli/src/session-hub.ts`: owns the agent session (started on first prompt, restarted
        after it ends), the message log (replayed to each new tab), pending asks (first decision
        wins, resolution broadcast, CLI-withdrawn asks marked cancelled), broadcast to tabs.
        Tests with an in-memory fake adapter: late tab gets full replay incl. a pending ask; first
        decision wins + broadcast; stale decision ignored; withdrawn ask → cancelled; lazy start
        and restart; closing all tabs leaves the ask pending.
  - [x] **3b. WebSocket + CLI wiring** (~60) — `server.ts` connects each socket to the hub and
        validates client messages with zod; `kratos [project-dir]` defaults to the current dir,
        prints "Claude Code will act in: …"; real Claude adapter. Accept: one WS round trip against
        the fake claude in a test. Added on owner request: `--host` (D33), `pong` with server info
        instead of `hello` (D34); graceful SIGINT/SIGTERM shutdown (D35).
  - [x] **3p. Persistence (SQLite)** (D36) — the session log *and Claude's memory* survive a
        kratos restart. One DB in the user data folder; latest session per project resumes.
        Three working slices (approved by owner):
    - [x] **3p1. Session store** (~180) — Drizzle schema (`sessions`: id = Claude conversation
          id, project_dir, agent, agent_started, timestamps; `messages`: session_id, seq, JSON
          message, created_at), drizzle-kit SQL migrations applied on open, `SessionStore`:
          open(path), latest-or-create for a project, append message, load log, mark agent
          started. pnpm allowed to build better-sqlite3's native binary. Tests on a temp DB file:
          migrations run, latest-per-project, ordered append/load, reopen keeps data.
    - [x] **3p2. Resume plumbing** (~50) — `startSession` gains `conversationId` + `resume`
          (core, generic); Claude adapter passes `--session-id <id>` (new) or `--resume <id>`;
          fake claude reports its args so a test proves both.
    - [x] **3p3. Hub + CLI on the store** (~110) — hub loads the log on start, persists every
          message, marks stale asks cancelled, starts the agent with resume = "started before";
          CLI opens `<user data>/kratos/kratos.db` (env-paths). Tests: restart replays the log
          with the stale ask cancelled and the next prompt resumes the same id. Accept: real
          `claude`: tell it a word, restart kratos, ask for the word — it remembers.
  - [ ] **3c. Browser UI** (D38) — absolute minimum on shadcn + shadcn's AI Elements, following
        the owner's Home design (dark, mint accent, Bricolage/Geist). Two slices (approved):
    - [x] **3c1. Setup + Home** — Tailwind v4 + shadcn in `apps/web`, design tokens and fonts;
          `useKratos` hook (WebSocket, ping→pong info, replayed + live log, send); Home screen
          (logo header + project folder + connection dot, "What should we build?", prompt card
          with agent chip + send); after the first prompt, a bare message list. Accept: send a
          prompt from the browser to real `claude`, refresh keeps it.
    - [~] **3n. Sessions side by side** (owner request, D41) — the logo opens Home at any time;
          sending from Home starts a *new* session while existing ones **keep running** (their
          agent, log and asks untouched). Each tab views one session; you get back to any session
          from the Recent list on Home or the sessions sidebar, which show live status.
      - [x] **3n1. Multi-session backend** (~250 incl. tests) — `SessionRuntime` (one session:
            log, agent, asks, status; today's hub logic moved out) + `SessionHub` as a registry
            of runtimes and per-tab subscriptions; store gains `get`, `list` and a `title`
            column (migration 0001). Protocol: client `open_session {id}`, `prompt.newSession`;
            server `session {id}` (what this tab views, then its replay) and `sessions` (list
            with title + status: working / needs_approval / idle, broadcast on change). Asks are
            answered by id from any tab. Tests: concurrent sessions keep running and stay
            separate, per-tab views, list/status updates, restart restores the list.
      - [ ] **3n2. UI** — routes with React Router (owner request): `/` = Home (prompt +
            Recent list), `/s/:id` = a session's conversation (bookmarkable, refresh-safe); the
            logo links to `/`; sending from Home navigates to the new session's URL. Collapsible
            sessions sidebar (owner's design); status dots. Server answers deep links with
            `index.html` (SPA fallback, tested). Verified with real `claude`, two sessions at once.
    - [ ] **3c2. Conversation** — move UI state into a Zustand store (D39); AI Elements chat: prompts as bubbles, replies via Streamdown,
          tool calls as Trace, permission asks as Approve/Deny (Confirmation), bottom prompt box
          with Stop. Accept: live demo with real `claude` incl. an approval; refresh keeps a
          pending ask.
    - Left out: sessions sidebar, Recent, light theme, deny reasons, thinking, attachments.
- [ ] **4. Plan artifact** — plan file model + UI to view/edit steps; agent must write a plan
      before code.
- [ ] **5. Step gates** — scope fence + budget enforced by Kratos itself (via
      `requestPermission`), using the D24 model: steps carry an estimate (agent must split before
      coding if it exceeds the budget); budget = review load (in-scope insertions, config/lockfiles/
      docs/excluded globs free); live budget meter in the UI; warn the agent at 80%; over budget →
      UI gate with **Extend** (+N lines, reason logged) / **Checkpoint** (commit what works, continue
      as a new step) / **Split** / **Revert**. Approve/reject between steps; checkpoints via git.
- [ ] **6. Decision ledger** — decisions captured as structured events, shown in UI, flippable.
- [ ] **7. Dogfood** — build step 8+ of Kratos using Kratos.

## Later ideas (not committed)

- Autonomy dial per path / action type
- "Predict" mode and "you write this" mode in the UI
- Data-flow walkthrough view per step
- Rewind / branch from any checkpoint
- More adapters (Codex CLI, Gemini CLI, Aider…)
- Track estimate vs actual per step to calibrate future estimates (step 2 missed by ~30%)
