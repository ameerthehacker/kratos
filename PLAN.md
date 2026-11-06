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
    - [x] **3n. Sessions side by side** (owner request, D41) — the logo opens Home at any time;
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
      - [x] **3n2. UI** (D42) — routes with React Router (owner request): `/` = Home (prompt +
            Recent list), `/s/:id` = a session's conversation (bookmarkable, refresh-safe); the
            logo links to `/`; sending from Home navigates to the new session's URL. Collapsible
            sessions sidebar (owner's design); status dots. Server answers deep links with
            `index.html` (SPA fallback, tested). Verified with real `claude`, two sessions at once.
    - [~] **3m. Harness & model picker** (owner request, D43) — the agent chip becomes a dropdown
          with the official Claude logo: pick the harness (Claude Code for now) and a model. The
          model list comes from the CLI itself (`initialize` → `models`), never hardcoded: latest
          aliases (Default/Opus/Fable/Sonnet/Haiku) on top, pinned older versions in "Other
          versions". Chosen on Home for new sessions; switchable mid-session (`set_model`).
          Two working slices (approved by owner):
      - [x] **3m1. Backend** (~200 incl. tests) — `AgentAdapter.listModels()` (Claude: spawn,
            `initialize`, read `models`, stop; cached) and `startSession({ model })` →
            `--model`; `AgentSession.setModel()` → `set_model`; store `model` column (migration
            0002), resumed sessions keep their model; protocol: server `harnesses` (id, name,
            models) on connect/when loaded, `prompt` gains `harness`/`model` for new sessions,
            client `set_model`, `SessionSummary.model`. Tests: fake claude answers
            `initialize`/`set_model` and reports `--model`; hub start/resume/switch.
      - [x] **3L. Logging (tech debt, owner request, D44)** (~200 incl. tests) — done:
            pino (Fastify's own logger, so app + HTTP share one) with two outputs: console via
            pino-pretty at `info`, and `~/.kratos/logs/kratos.log` (JSON, `debug`) rotated by
            pino-roll at 10 MB, keeping 5. `--log-level` overrides the console. Components log
            through children (`hub`, `session`, `http`, `web`). Replaces all 7 `console.*` calls
            and adds the useful lifecycle lines (models loaded/failed, agent started with
            model/resume, agent exited, asks + decisions at debug). Browser warnings go to the
            server as a new `client_log` message (still shown in devtools). All Kratos data moves
            to `~/.kratos`: the default DB becomes `~/.kratos/kratos.db` (no migration of the old
            location: the product is brand new, owner; env-paths dropped). Tests: file written +
            rotation config, `client_log` reaches the log, hub/runtime log calls. Also (owner, mid-step):
            the session view no longer shows a "turn end" marker; only a cut-short turn says "Stopped".
      - [x] **3m2. UI** (~150) — official Claude SVG (downloaded from claude.ai's own asset
            server, checked: one path, no scripts) as a component; shadcn dropdown chip
            "logo · Claude Code · Opus 5.5 ▾" with Harness + Model (Latest / Other versions);
            Home choice remembered per browser; in a session the chip shows and switches that
            session's model. Verified with real `claude`: start on Haiku, switch to Sonnet,
            ask the agent which model it is. Done: also found and fixed two 3L bugs (log folder
            race on first start; session log lines carried `component` twice).
    - [x] **3c2. Conversation** (owner: render chat messages + tool calls like the "Kelpie"
          design's chat — only that part, not its agent pane/workbench). Two vertical slices:
      - [x] **3c2a. Messages + tool steps** (~200, D45) — `components/conversation/`:
            your prompts as right-aligned bubbles; the agent's text as markdown (Streamdown);
            consecutive tool calls grouped under "Claude · N steps" with a "Show raw" toggle;
            each step = round tinted icon (read / edit / run / think / other) + a plain-words
            title ("Read session.tsx", "Edited 2 lines in store.ts", "Ran the tests") + chips
            (file, ✓/✗ result) + raw block when toggled (`$ command` highlighted, output
            trimmed); thinking as a quiet "think" step; a cut-short turn as an event line.
            Auto-scroll that sticks to the bottom (use-stick-to-bottom). Composer sticky at the
            bottom. Accept: real `claude` run that reads, edits and runs a command renders as
            steps; raw toggle shows the command + output; refresh replays the same view.
            Done: verified with real `claude` (run → edit → re-run → read, markdown + code block).
      - [x] **3c2b. Asks + Stop** (~100, D45) — a pending permission ask as the design's amber
            "needs a call" card (what it wants to do, in plain words + raw) with Allow / Deny;
            once settled it's a step ("Asked you: … · Allowed"). Send button turns into Stop
            while the agent works (`interrupt`). Accept: real run with an approval and a denial;
            refresh keeps a pending ask; Stop ends a turn. Done: all four verified with real
            `claude`. Next: asks for edits should show a readable diff, not raw JSON.
      - [x] **3c3. Ask redesign: option C + readable preview** (~150, owner picked C, D45) — the
            amber card is replaced: the step only shows a "Waiting for you" chip; the question
            docks above the composer ("Claude Code wants to write notes.txt", Deny / Allow) with
            a readable preview — a diff for writes/edits (jsdiff), the highlighted command for
            runs, the raw call otherwise. Several open asks: the oldest first, "1 of 2". The
            adapter adds the edit text to `action` (`edits: [{before, after}]`, capped).
            Accept: real `claude` write (new file), edit (diff) and bash asks, allow + deny.
            Done: all three verified (write allowed, edit denied, bash allowed).
      - [x] **3c4. Decouple the last Claude-isms** (~60 + tests, owner asked "are we coupled?")
            1. Default model = `null` in our protocol: `set_model { model: string | null }`;
               `AgentSession.setModel(null)` and `startSession` without a model mean "the agent's
               default". The Claude adapter maps null → its `"default"` id; the adapter's
               `listModels` marks the default entry (`isDefault`) instead of the UI knowing the
               `"default"` id. UI: picker and session page send/compare `null` only.
            2. Asks name their call: `PermissionRequest` gains `toolCallId?` (Claude: its
               `tool_use_id`, verified on the real CLI — same id as the `tool_use` block) and
               `action?` (same mapping as tool calls). `buildTimeline` attaches an ask by that
               id; the tool-name + order match stays only as a fallback for old logs.
            Scope: core `agent.ts`/`protocol.ts`, adapter `index.ts`/`map`/`fetchModels`,
            hub/runtime `setModel`, web `agent-picker`, `session.tsx`, `timeline.ts`.
            Accept: tests for null model start/switch, ask-by-id (incl. two asks for the same
            tool), and grep shows no `"default"` model id outside the adapter; real `claude`
            run: switch to Default mid-session, allow/deny an ask. Done (D46): Haiku → Default
            answered as Opus 5.5 live; stored model NULL; asks stored with their toolCallId.
      - [x] **3c5. Copy your prompts** (~30, owner, D47) — a small copy button under each of your
            prompt bubbles (shows on hover/keyboard focus), copies the exact text with the
            browser's clipboard API, and confirms with a check for a moment. Accept: copy a
            multi-line prompt in the real UI and read the clipboard back. Done: the copied text
            (seen on the copy event) is the exact multi-line prompt.
    - Left out: light theme, deny reasons, attachments, timestamps per step (not sent yet).
    - [ ] **3d. UI/UX polish (owner, before step 4)**
      - [x] **3d1. Home prompt box** (~40) — modern look, design picked by the owner from two
            sketches (owner picked A, minimal, with the focus glow): short placeholder ("Describe a
            change…"), 16px text that grows as you type (CSS `field-sizing`), soft accent glow
            on focus, keyboard hints; B adds starter chips that fill in a first sentence.
            Accept: screenshots of Home empty / typing / focused. Done: shared by Home and the
            reply box (`size` large / compact); hints hide below 640px. Also (owner): Recent
            restyled — status tile, title, "model · 5 minutes ago" (date-fns), hover highlight
            + chevron; capped at the 3 newest (owner: no long scroll; the sidebar has them all).
      - [x] **3d2. Done sessions** (~150, D49) — mark a session done; the sidebar splits into
            **Working** and **Done** (owner kept the names), Home's Recent hides done ones.
            Mark/reopen from: a new session header (title + status + "Mark as done"/"Reopen"),
            a hover check on sidebar rows, and on Recent rows. Sending a prompt to a done
            session reopens it. Data: `sessions.done_at` (migration 0003), `SessionSummary.done`,
            ClientMessage `set_done {id, done}` (by id: rows can act on any session of this
            project). Accept: hub tests (mark, reopen on prompt, other-project id refused),
            real run: mark from each of the three places, reload keeps it. Done: all three
            places + reopen verified on a copy of the dev DB; reopen-on-prompt by hub test.
            Also (owner): both sections collapse; Done starts collapsed; remembered per browser.
- [ ] **Settings (owner, later)** — user-configurable appearance, starting with the code
      theme (reply code blocks + raw commands; today one constant in `apps/web/src/lib/appearance.ts`),
      likely with light/dark. Stored per user (not per project). To be designed with the owner.
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
