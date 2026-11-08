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
      - [x] **3m3. Effort: backend** (~200 incl. tests, owner, D51) — how hard the agent thinks.
            Found on the real CLI (2.1.308): each model lists its levels (`initialize` →
            `supportedEffortLevels`, e.g. low/medium/high/xhigh/max; some lack xhigh, old Haiku
            has none); `--effort` sets it at start; `apply_flag_settings {effortLevel}` changes
            it live; `get_settings` → `applied.effort` is the level really in use. Claude's
            default differs per model (Opus high, Haiku medium) and clearing it mid-session
            lands on `medium`, so Kratos never sends "clear" — it shows the real level instead
            (owner's choice).
            - core: `AgentModel.efforts?: string[]` (absent = no effort control);
              `startSession({ effort })`; `AgentSession.setEffort(level)` (resolves when the
              agent confirms) and `AgentSession.effort()` (the level in use, if the agent says).
            - Claude adapter: map the above; refuse a level the model doesn't list (the CLI
              accepts made-up ones silently).
            - store: `sessions.effort` (migration 0004; null = never chosen); resume passes it.
            - protocol: `prompt` gains `effort?`; client `set_effort {effort}`;
              `SessionSummary.effort` = the real level. The hub asks the agent after it starts
              and after a model switch (the default moves with the model) and broadcasts it.
            - Tests: fake claude learns `supportedEffortLevels`, `--effort`, `apply_flag_settings`,
              `get_settings`; adapter start/switch/read; hub start, switch, model-switch re-read.
      - [x] **3m4. Effort: UI** (~120, owner, D51) — inside the model chip, like Claude's own
            picker (owner, revised): the chip reads "Opus 5.5 · High"; its menu gains an
            "Effort  High ›" row opening a submenu of the current model's levels (Low, Medium,
            High, Extra high, Max) with a check on the one in use; no Effort row when the model
            has none. In a session it shows the real level and switches it live. On Home no
            agent runs yet, so before you pick it shows no level; a pick is remembered with the
            model choice. Accept, real `claude`: start at Low, switch to High mid-session, the
            CLI reports high; switch to a model without xhigh while on Extra high → the chip
            shows what the CLI actually uses.
            Done: both checked with real `claude` (Haiku 5.5 low → high, CLI reported high;
            xhigh → Opus 4.6, chip shows High as the CLI reports). The chip hides a level the
            model doesn't list; unknown level ids are capitalized with lodash-es (owner).
    - [ ] **3q. Permission modes** (owner, D53) — choose how much the agent may do without
          asking, from what each harness offers. Found on the real CLI (2.1.308, tiny Haiku turns
          in a scratch folder): modes `default` (asks for edits and commands), `acceptEdits`
          (edits and file commands like `touch` go through; other commands ask), `auto` (the
          CLI's own checker decides; nothing reached Kratos), `dontAsk` (anything not pre-allowed
          is refused, no card), `plan` (read-only; the agent asks to leave with `ExitPlanMode`
          carrying the plan, and on approval the CLI switches itself to `default`),
          `bypassPermissions` (no checks; only switchable if the CLI was started with
          `--allow-dangerously-skip-permissions`). `--permission-mode` sets it at start;
          `set_permission_mode {mode}` switches live and answers with the mode applied ("manual"
          → "default"; unknown modes are refused by the CLI); every change, the agent's own
          included, is announced as a `system`/`status` line with `permissionMode`.
      - [x] **3q1. Backend** (~250 incl. tests) — done: real CLI through the built adapter
            (plan, manual→default, Bypass via the allow flag, turbo refused; one event per real
            change) and over WebSocket (Bypass refused without consent, allowed with it, stored).
            - core: `AgentPermissionMode {id, label, description, isDefault?, dangerous?}`;
              `AgentAdapter.permissionModes` (Claude's six; the CLI doesn't list them, so the
              adapter knows them); `startSession({ permissionMode })`;
              `AgentSession.setPermissionMode(mode)` (resolves with the mode applied); new
              AgentEvent `permission_mode {mode}` for every change the agent reports, so
              agent-made switches (leaving plan mode) are followed too.
            - Claude adapter: `--permission-mode` at start; always start with
              `--allow-dangerously-skip-permissions` so Bypass can be switched on live (it only
              makes it reachable; sessions still start in the chosen mode); map `system`/`status`
              → `permission_mode`.
            - store: `sessions.permission_mode` (migration 0005; null = the agent's default).
            - protocol: `Harness.permissionModes`; `prompt.permissionMode?` (Home's pick);
              client `set_permission_mode {mode, confirmDangerous?}` — the server refuses a
              `dangerous` mode without `confirmDangerous: true`, so only the consent dialog can
              turn Bypass on; `SessionSummary.permissionMode` = the mode in use.
            - Tests: fake claude learns `--permission-mode`, `set_permission_mode` (Bypass refused
              without the allow flag), `status` lines, and a plan turn (ExitPlanMode ask → status
              default); adapter + hub tests incl. the refused-without-consent case.
      - [x] **3q2. UI** (~150) — done to design option A (owner): key caps removed from the
            composer, "✋ Ask ▾" chip with an icon per agent-neutral `kind`; the last safe pick, on
            Home or in a session, carries to new sessions (owner) — Bypass too, once consented
            (owner; the dialog says so). Checked with
            real `claude`: Plan → ExitPlanMode allowed → chip back to Ask. Desktop only (owner).
            Planned as: a mode chip next to the agent chip ("◎ Ask ▾") listing the
            harness's modes with one-line descriptions; Home remembers the pick (with model and
            effort), a session switches live and shows agent-made changes (plan → Ask). Picking
            Bypass opens a consent dialog first (what it turns off, that it's this session only).
            Later, not in this step: a proper plan-approval card for `ExitPlanMode` (today it
            shows as a generic "Use ExitPlanMode" ask).
    - [ ] **3r. Agent questions** (owner, D54) — when the agent asks you a multiple-choice
          question mid-turn (Claude Code's `AskUserQuestion`), Kratos shows the design's question
          card ("Proposal · question widget") and sends your answers back. Found on the real CLI
          (2.1.308, tiny Haiku turns): it arrives as a `can_use_tool` ask for `AskUserQuestion`
          (`requires_user_interaction: true`) with `questions: [{question, header, multiSelect,
          options: [{label, description}]}]`. Answer = allow with the input plus
          `answers: {"<question>": "<label>"}` — several picks joined with ", ", any typed text
          accepted as-is ("Other"); several questions answered in one go. Skip = deny with a
          message (the agent carries on). Allow without answers = "the user did not answer", so
          Kratos never sends that. (Per-answer `annotations.notes` also works; the design has no
          notes, so not used.)
      - [x] **3r1. Backend** (~250 incl. tests) — done: end to end over WebSocket with real
            `claude` (Haiku): two questions, "(Recommended)" → flag, status needs_answer, a
            malformed answer refused with its reason, the answer (picks + own text) reached the
            agent, which restated it.
            - core: agent-neutral `AgentQuestion {header, question, multiSelect, options:
              [{label, description?, recommended?}]}`; `QuestionReply` = answered (per question:
              `selected` labels + optional `other` text) | skipped; `startSession({ askQuestions })`
              — a second callback beside `requestPermission`, same abort signal semantics.
            - Claude adapter: routes `AskUserQuestion` asks to `askQuestions` instead of the
              permission gate; "(Recommended)" at the end of a label → `recommended: true` (answers
              still use the agent's own labels); maps the reply to `answers` / a skip message
              ("decide yourself"); fails closed (deny) if Kratos can't ask.
            - protocol: server `question_request {id, request}` and `question_resolved {id,
              outcome: answered | skipped | cancelled, answers?}` (in the session log, so replay
              shows the outcome); client `question_answer {id, reply}`, checked by the server
              (known labels, one pick for single choice, every question answered);
              `SessionSummary.status` gains `needs_answer` ("Needs your answer").
            - runtime: open questions like asks — first answer from any tab wins, withdrawn on
              interrupt/stop → cancelled, left open by a restart → cancelled ("Not answered"),
              skipped on shutdown.
            - web: the timeline only skips the new messages for now (UI is 3r2).
            - Tests: fake claude learns a question turn (single, multi + Other, skip); adapter +
              hub tests incl. invalid answers, two tabs, interrupt, restart.
      - [x] **3r3. Tab title + notification** (~90, owner, D54) — while sessions wait on you, the
            tab reads "(1) Question · Kratos" (Approval(s) / Waiting for you when mixed) and the
            favicon (now the Kratos logo) gets an amber dot; a session that starts waiting while
            the tab is hidden shows a system notification ("Claude Code has a question" + the
            question; "… needs your OK"), clicking opens it. Permission is asked once, when you
            send a prompt. Checked with real `claude` (notification API recorded, tab hidden).
      - [x] **3r2. UI** (~250) — done, checked with real `claude` (two questions answered by keys,
            a multi-pick plus own text, then a single question skipped with Esc). Planned as: the design's question card in the ask dock (tabs per question,
            radio/checkbox rows with Recommended, "Other" field, keys 1–4 / ↵ / Esc, Back / Next /
            Send answers, Skip), the step "Asking 2 questions" → "Asked …" with answer chips,
            "Needs your answer" in sidebar and header.
    - [ ] **3s. File attachments** (owner, D55) — attach images, PDFs and text/code files to a
          prompt. Found on the real CLI (2.1.308, tiny Haiku turns): the stream-json user message
          takes a list of content blocks — `image` (base64), `document` with a base64 PDF, and
          `document` with `source: {type: "text"}` + `title` for a text file — and the agent read
          all three correctly (colour, a word in a PDF, a number in notes.md). Nothing needs to be
          written into the project; Claude keeps them in its own transcript for later turns.
      - [x] **3s1. Backend** (~250 incl. tests) — done: end to end over WebSocket with real
            `claude` (Haiku): a zip refused before anything started; a PNG, a PDF and an untyped
            notes.md stored by id next to the DB and read by the agent ("Red, PINEAPPLE, 4711");
            all three served back from `/attachments/<id>` (the text as text/plain).
            - core: each harness says what it accepts (`Harness.attachments`: kinds image / pdf /
              text with media types and max bytes, plus a max count); `AgentSession.send(prompt,
              attachments?)` with agent-neutral `{name, kind, mediaType, data}`.
            - Claude adapter: maps them to the blocks above. Limits from the Claude API: images
              png/jpeg/gif/webp ≤ 5 MB, PDF ≤ 30 MB; text = any UTF-8 file ≤ 1 MB (checked by
              content: browsers often don't know a `.ts` file's type); ≤ 10 files, ≤ 30 MB total.
            - protocol: `prompt.attachments?: [{name, mediaType, data (base64)}]` — sent inline over
              the WebSocket with the prompt, not uploaded separately (no half-uploaded leftovers,
              one place to check; fine at these sizes locally); `user_prompt` in the log gains
              `attachments: [{id, name, kind, mediaType, size}]` — metadata only.
            - store: `attachments` table (migration 0006); the bytes go to a file named by a random
              id in an `attachments/` folder next to the database (`.kratos/` is git-ignored).
              `GET /attachments/:id` serves one for thumbnails — looked up by id, only this
              project's, never a path from the browser.
            - server checks count, kind, size (and that "text" really is text) before anything
              starts; a refused prompt isn't sent, and the tab is told why.
            - Tests: fake claude reports the blocks it got; adapter, hub, store, server (serving
              and refusing ids) tests.
      - [x] **3s2. UI** (~330) — the design's "Proposal 3s2 · attachments", its pick: "+" first
            in the composer row (option 1) and thumbnails for images + chips for other files (B).
            Drop files on the card (it tints: "Drop to attach…"), paste a screenshot
            ("pasted-image.png"); files are checked in the tab with core's rules — a file that can't
            go stays red ("Can't attach"), the card's ring turns red, the reason sits under it, send
            is off until it's removed; files over the count/total aren't added (amber note that
            fades), "+" is off at 10. Sent prompts show images as thumbnails (lightbox: name, size,
            Open original) and other files as chips that open in a new tab; a missing file shows
            "Not available". Checked with real `claude` (PNG + PDF + untyped notes → "Red,
            PINEAPPLE, 4711"; a zip refused; paste; 12 files → 10 + note; lightbox). Not built:
            the red drag state for unsupported files (browsers often don't say the type until
            the drop).
    - [ ] **3t. Steering prompts** (owner, D56) — send more prompts while the agent works and see
          what happens to each (design "Proposal · steering prompts (queue, send now, read)").
          Found on the real CLI (2.1.308, tiny Haiku turns): a user message sent mid-turn is held
          and taken at the next step boundary *in the same turn* (the agent's reply honoured it);
          sent during the final reply, it runs as the next turn. Every message we tag with a
          `uuid` gets `command_lifecycle {command_uuid, state}` lines: queued → started →
          completed | cancelled (no flag needed). `cancel_async_message {message_uuid}` withdraws a
          waiting one; `interrupt {cancel_queued: true}` stops and cancels all waiting;
          `interrupt {send_now: true, message_uuid}` stops the step and delivers *all* waiting
          ones at once. A plain interrupt lets waiting ones run right after. These requests are
          undocumented (found in the CLI's strings; its own SDK uses them).
          Owner: Send now sends only the chosen prompt (others stay queued); Stop stops
          everything and puts the queued prompts' text back in the composer.
      - [x] **3t1. Backend: queue, statuses, remove, Stop** (~250 incl. tests) — done: end to end
            over WebSocket with real `claude` (Haiku): a prompt sent during a slow command was
            queued, read at the step boundary (after the Bash call) and honoured in the same
            reply; then two queued, one removed (`removed`), Stop dropped the other (`stopped`)
            and gave its text back to the tab; "queued" counts 1 → 2 → 1 → 0.
            - core: `send(prompt, attachments, {id})` tags the message; AgentEvent
              `prompt_state {id, state: queued | started | completed | cancelled}` (only our ids;
              the CLI's own "[Request interrupted…]" echo is ignored); `cancelPrompt(id)`;
              `interrupt({cancelQueued})` → the cancelled ids.
            - runtime: a prompt while a turn is open is *queued*: `prompt_queued {id, text,
              attachments?}` in the log, sent to the agent at once (it holds it). On `started`:
              `prompt_read {id, how: "step" | "next_turn", after?}` — mid-turn = read after the
              last finished step; else it starts a new turn (the runtime then counts the turn as
              open). `remove_queued {id}` → `cancelPrompt` → `prompt_removed {id}`. Stop with a
              queue → `interrupt({cancelQueued: true})`, `prompt_removed` for each, and the
              stopping tab gets their text back (`prompts_returned {text}`, not logged).
            - protocol: `SessionSummary.queued` (count, for "Working · 2 queued").
            - Tests: fake claude learns lifecycle lines, a held message taken at its next step
              (or next turn), `cancel_async_message`, interrupt with `cancel_queued`; adapter +
              hub tests incl. replay of a queue and two tabs.
      - [x] **3t2. Backend: Send now** (~100) — done: real `claude`: B, C, D queued during a
            slow command; Send now on C stopped the step, C was read "now" ("CHERRY"), B and D
            stayed queued and were read together as the next turn ("BANANA DATE"). Fixed on the
            way: prompts the agent takes together to start a turn are all `next_turn`. Planned as: `send_now {id}`: withdraw the *other* waiting
            prompts (`cancel_async_message`), `interrupt {send_now, message_uuid}`, then queue the
            others again (new agent ids, same Kratos ids — they stay in the card);
            `prompt_read {how: "now", stopped?}` with the step it cut short.
      - [x] **3t3. UI** (~330) — done, checked with real `claude`: three prompts queued during a
            slow command (queue card "3 queued", header "Needs approval · 3 queued"), Edit put one
            back in the box, Send now on another stopped the step ("Stopped …", "⚡ Sent now ·
            stopped …", reply CHERRY), the last read as "Sent when the last turn ended"; Stop with
            one queued gave its text back to the box. Fixed on the way: the generic "Stopped" line
            before a Send now, and long path chips spilling over their step. Fitted to the current
            composer: the key hints are the Queue button's tooltip (↵ queue · ⌘↵ send now) rather
            than key caps. Planned as: the design: Enter queues while the agent works (send button → Queue),
            ⌘↵ sends now; the queue card above the composer (Send now, Edit → back to the box,
            Remove); prompts move into the chat when read, with "Read after …" / "Sent now ·
            stopped …" / "Sent when the last turn ended"; "Working · N queued" in the sidebar.
    - [ ] **3u. Versions and releases** (owner, D57) — the app shows its real version (per the
          design), linking to its GitHub release; a release ships one binary per platform and
          updates a Homebrew tap. Owner's choices: code at `ameerthehacker/kratos`, tap at
          `ameerthehacker/homebrew-kratos` (`brew install ameerthehacker/kratos/kratos`);
          publishing a GitHub release starts it; macOS and Linux (arm64 + x64); a single binary
          that serves the web UI itself. Today: no git remote, every version 0.0.0, no CI.
          Owner's part (outward-facing): create both repos, push, add the tap token secret.
      - [x] **3u1. Version in the app** (~100) — done: `kratos --version` and the startup line
            print `be489ec` on this checkout; the header pill shows it and links to the commit (the
            repo isn't on GitHub yet, so links 404 until it's pushed). Planned as: one source: `apps/cli/package.json` `version`,
            set from the release tag at release time; local (unreleased) runs show the short
            commit hash instead, as the design's default does. The server reports it in `pong`,
            `kratos --version` prints it. UI per the design (Home + Session header): a small mono
            pill right after the "kratos" wordmark — secondary background, muted 11px Geist Mono,
            bare value ("0.3.1" / "ab9151c"), tooltip "Kratos version …". New (owner): it's a
            link — a release opens `github.com/ameerthehacker/kratos/releases/tag/v<version>`, a
            commit hash opens that commit — with a hover state like the other header controls.
      - [x] **3u2. Drop `sharp`** (~60) — done: new icons for VS Code, Xcode and Finder match
            sharp's side by side (same crop and size). Planned as: it's only used to trim macOS editor icons and drags in
            libvips, which a single binary can't easily carry. macOS's own `sips` converts and
            crops; the transparent edge is found with `pngjs` (pure JS). Icons look as before.
      - [x] **3u3. Single binary** (~250 incl. a discarded first try) — `@yao-pkg/pkg` in SEA
            mode (owner: use a package if it makes this easy): esbuild bundles the server, pkg
            packs it with the web UI, migrations and SQLite's prebuilds into stock Node and
            signs it. Logger moved off worker threads. `pnpm build:binary` → `dist-bin/kratos`.
            Also (owner): the UI opens in the browser at start; `--no-open` skips it. Checked:
            the binary alone, copied elsewhere, serves the UI, keeps sessions across restarts,
            runs `claude`, shows editor icons, `--version`.
      - [x] **3u4. Release workflow + tap** (~200) — `.github/workflows/release.yml` on
            `release: published`: tests, then native runners (macOS arm64/x64, Linux x64/arm64)
            build the binary with the tag's version, smoke-test `--version`, attach
            `kratos-<v>-<os>-<arch>.tar.gz`; then `SHA256SUMS`, the formula
            (`apps/cli/scripts/homebrew-formula.mjs`) pushed to the tap with
            `HOMEBREW_TAP_TOKEN`. Pre-releases skip the tap. Checked: brew install from a local
            tap on this Mac. Owner: create the tap repo + secret, then a first real release.
      - [ ] **3u5. Self-update, one click** (owner) — Kratos checks for a newer release (GitHub's
            latest release, now and then), the UI shows "update available" (the version pill), and
            one click updates and restarts it. To settle when we get there (needs 3u4's releases):
            a Homebrew install should update through brew (`brew upgrade ameerthehacker/kratos/kratos`,
            not by overwriting the Cellar) while a plain binary downloads the new release asset,
            checks its sha256 and swaps itself; restart = start the new binary with the same
            arguments, then exit (sessions are in the DB; running agents would be stopped — wait
            for idle, or ask); how often to check, and whether the design gets an "update
            available" state.
            Owner's answers: Kratos downloads + verifies by itself, you click to restart into it;
            check at start + every hour; a restart waits until no agent is working; Homebrew
            installs are updated by us *and* brew must know (so `brew list`/`upgrade`/`uninstall`
            stay right). Backend first (5a–5c), UI after (5d). Only a release binary updates:
            source runs (`pnpm dev`, 0.0.0/commit versions) never check.
        - [x] **3u5a. Check** (~120 + tests, D61) — `apps/cli/src/updater/`: GitHub's
              `releases/latest` (fetch, zod-checked; pre-releases are never "latest"), compared with
              `semver`; at start, then hourly; failures logged at debug, never fatal. State goes to
              tabs as a new `update` message (core `UpdateStatus`: `idle | available` + version +
              release URL for now; later slices add their states), on connect and on change;
              the web store keeps it out of the chat log. Startup logs "kratos 0.2.0 is
              available". Accept: tests with a faked GitHub (newer / same / older / pre-release /
              network error / junk JSON). Checked: a binary built as 0.0.9 logs "kratos 0.1.0 is
              available" from the real GitHub and a tab gets `available`; a source run gets
              `idle` and never calls GitHub.
        - [x] **3u5b. Download + verify** (~120) — when `available`: fetch this platform's
              `kratos-<v>-<platform>-<arch>.tar.gz` and `SHA256SUMS` into
              `~/.kratos/updates/<v>/`, check the sha256, unpack (`tar` package) → `ready`. A bad
              checksum deletes the files and reports `error`; an already-verified download is
              reused. Right after publishing, the release is "latest" before the workflow has
              attached its archives: a missing asset means "not yet" (stay `available`, retry at
              the next check), not an error. Accept: tests against a local HTTP server (good,
              bad sum, asset not attached yet).
              Checked: a source run as 0.2.0 (temporary HOME) downloaded the real v0.3.0 for this
              Mac (60 MB, 19 s), its hash matches the release's SHA256SUMS, the unpacked binary
              prints 0.3.0; the pill stays mint and the dialog says "downloaded and verified".
              A failed download shows as an `error` on `available` (no state of its own).
        - [x] **3u5c. Apply + restart** (~250 + tests) — tab sends `apply_update`; if an agent is
              working the state is `waiting` and it applies when all sessions are idle. Then:
              - plain binary: copy the new one next to `process.execPath`, then rename it over
                (atomic on one filesystem; the running process keeps its old file);
              - Homebrew (`execPath` under brew's Cellar). Not `brew update`: it refreshes every
                tap, can be throttled, and the tap trails the release by minutes (owner: brew
                doesn't see the new version consistently). Instead, each step checked:
                1. refresh only our tap: `git fetch` + fast-forward to `origin/main` in
                   `brew --repository ameerthehacker/kratos`;
                2. `brew info --json=v2 ameerthehacker/kratos/kratos` must show the new version;
                   if not, the tap job isn't done: stay `waiting`, retry at the next check;
                3. put our verified archive at `brew --cache --formula ameerthehacker/kratos/kratos`
                   and run `HOMEBREW_NO_AUTO_UPDATE=1 brew upgrade ameerthehacker/kratos/kratos`
                   (brew re-checks the sha256 against its formula and installs our file);
                4. `brew list --versions kratos` and the new binary's `--version` must both show
                   it; else `error`, and the old version keeps running (no swapping files
                   behind brew's back). Restart from brew's `bin/kratos` link.
              Restart: close the server and the store (frees the port), then `process.execve`
              the new binary with the same arguments plus `--no-open` (open tabs reconnect, so no
              new one; same PID, same terminal,
              Ctrl-C still works). Accept: a binary built as 0.0.9
              updates itself to the real v0.1.0 and comes back up as 0.1.0 (driven by a WebSocket
              script); brew path checked with a local throwaway tap, as 3u4 was.
              As built: the hub reports when no session is busy (working, or waiting on you);
              the updater goes ready → waiting → applying, and any failure goes back to `ready`
              with the error (the old Kratos keeps running). How it was installed: not a packaged
              binary (`node:sea`) = source, can't replace itself; a binary under `…/Cellar/kratos/`
              = Homebrew (that prefix's `brew`); else the binary file itself. Both paths check the
              new binary's `--version` before restarting. The restart args are rebuilt from the
              parsed options (project, port, host, db, logs) + `--no-open`. Commands run with
              Node's `execFile` (no shell). Old downloads are removed at the next start.
              Real check: a local binary built as 0.4.9 updates itself to the real v0.5.0 and
              comes back on the same port as 0.5.0. Homebrew: command order tested with a fake
              runner; the real brew path is first exercised by the release after this one.
              Checked: 0.4.9 (built from this code) → real v0.5.0, same PID, 0.5.0 on the port
              and on disk; again by clicking the button in a browser. Found and fixed on the way:
              `promisify(execFile)` returns no `stdout` inside the packaged binary.
        - [x] **3u5d. UI** (~190, owner, before 5b/5c; D61) — owner: reuse the version pill; it
              shows when an update is available; clicking opens a dialog to view the release,
              check again, and update — saying Kratos restarts by itself once every agent is
              done. Built from Claude's draft (the design artifact couldn't be opened here).
              - Pill: as today when up to date; mint tint + dot + "0.1.0 → 0.2.0" when available.
                Click = the dialog (the release/commit link moves into it).
              - Dialog: "Kratos 0.2.0 is available" / "Kratos 0.1.0 is up to date" + "checked 4
                minutes ago"; View release notes · Check again · Update & restart, with "Kratos
                restarts by itself once every agent is done (N working now)". Update & restart is
                disabled until 3u5c makes it work. Source runs: "Running from source", View commit.
              - Backend: `check_update` (client → server; the server answers that tab with the
                status even if nothing changed) and `checkedAt` in the status.
              - Local testing: `KRATOS_VERSION=0.0.9 pnpm dev` makes a source run act as release
                0.0.9, so it checks the real GitHub and sees v0.1.0.
              Accept: screenshots of the pill and dialog (available, up to date, source run);
              Check again updates "checked …"; tests for `check_update` and `KRATOS_VERSION`.
              Checked: screenshots of all three (servers run as 0.0.9, 0.1.0 and from source,
              against the real GitHub); Check again settled on "checked just now". Not seen yet:
              the "N sessions working now" wording with an agent running.
      - [x] **3u6. Busy port, clear error** (~10, owner, D60) — done: with 4399 held, kratos
            prints "Port 4399 is already in use (another kratos running?). Stop it, or pick
            another: kratos --port 4400" and exits 1; a free port starts as before. Planned as: a
            taken port crashed with Node's raw `EADDRINUSE` stack trace; instead one line naming
            the port, the likely cause and the fix, exit 1 with the database closed.
      - [x] **3u7. Claude Code in Kratos as able as in the terminal** (~20 + tests, owner, D62) —
            owner: the terminal's `claude` reads claude.ai artifacts (the design) and Kratos's
            can't; MCP is flaky in Kratos. Found (claude 2.1.308): artifacts are off by default
            for SDK/`-p` sessions (`CLAUDE_CODE_ARTIFACT=1` turns them on); claude.ai connectors
            connect in the background, so every new `claude` process (each Kratos start, each
            resume) runs its first turn with them "pending" — the in-and-out the owner saw
            (`CLAUDE_CODE_MCP_STARTUP_WAIT_MS` waits). The adapter sets both; your own
            environment wins. Accept: tests; through Kratos, a new session's first reply lists
            the Artifact tools and the Docs connector's. Checked: it does; through Kratos it also
            read the design (12 artboards) and called the Docs `guide` tool. Not tried: edits.
      - [x] **3u5e. Update popover** (~200, owner: "the download progress and the dialog don't
            look good — a popover from the pill, better progress and button placement") — the
            dialog becomes a popover under the version pill, like quick settings: title +
            versions + a check-again icon; one state line; a real progress bar while downloading
            (the server reports bytes, a few times a second); release notes on the left, the one
            main action on the right (Update & restart / Cancel while waiting / Try again after a
            failure). New: `cancel_update` backs out of waiting. Accept: screenshots of up to
            date, downloading (bar moving), ready, failed; tests for progress and cancel.
            Checked: screenshots of all six states (up to date, downloading 31 of 60 MB, ready,
            waiting with Cancel, failed with Try again, source run), from real flows. Then a code
            review round; its 9 findings fixed (D61).
      - [x] **3u8. Stale tabs reload** (~15) — a tab that reconnects to a Kratos of another
            version (after `brew upgrade` + restart, later after 3u5c) still runs the old page and
            rejects new messages ("unknown message from server", seen with 0.1.0 → 0.2.0). The
            page remembers the first `pong`'s `serverVersion`; a different one later → reload.
            Checked: after "Update & restart" the open tab reloaded itself onto 0.5.0.
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
            Keyboard hints as real key caps (shadcn `Kbd`, owner).
      - [x] **3d9. Two UX fixes** (~40, owner) — opening a session jumps to its bottom instead of
            scrolling through the whole chat: the log replays message by message, so the server now
            says when the replay is complete (`session_ready`, after the last replayed message) and
            the conversation mounts only then — its first size is the whole chat (instant), later
            messages glide in (owner rejected a first cut that guessed "done" from a 300 ms pause).
            Marking the open session done takes you Home. Checked: done → Home in the browser
            pane; opening at the bottom by the owner in `pnpm dev` (the pane got no animation
            frames, so it can't show scrolling).
      - [x] **3d8. Done at the bottom** (~10, owner, D49) — the sidebar's Done section is pinned
            to the bottom of the island (it needs the least attention); Working scrolls above it,
            Done scrolls on its own within half the height.
      - [x] **3d6. Working indicator** (~120, owner, D52) — while the agent works, a line under
            the conversation says what it is doing now, from its latest unfinished step
            ("Reading store.ts…", "Running the tests…"); between steps it cycles playful words
            (Thinking, Forging, Tempering…). Text shimmers (a light sweep), the logo's hammer
            strikes with sparks (owner, was a ✢✦ glyph), elapsed time on the right. Hidden while an ask waits (the ask dock shows)
            and when idle. Respects reduced motion. Elapsed counts from when this tab saw the
            turn start (the log has no timestamps). Accept: real `claude` turn with a tool call
            shows the step, then a word; it disappears when the turn ends.
            Done: checked with real `claude` (a word first, then "Sleep 10 seconds then echo
            done…" while the command ran, gone at idle); a 5-step run showed each step in turn,
            hid during the write's ask, and the timer kept counting the turn.
      - [x] **3d7. Quieter done button** (~40, owner, D49) — the header's "Mark as done" pill
            becomes a small ghost check icon (tooltip "Mark as done") beside the status; once
            done, the status becomes a green "✓ Done" chip — a red "↺ Reopen" on hover — that reopens on click.
      - [x] **3d5. One-click open** (~30, owner, D50) — the project pill is split: clicking the logo
            and name opens the project in the chip's editor (last used, else the first found;
            Finder if there's none); the chevron opens the menu to pick another. The connection
            dot sits between them, outside both buttons (its tooltip doesn't fight theirs).
            Accept: click opens the editor (log line); chevron opens the menu; typecheck, tests.
            Done: click → VS Code opened ("opened the project in an editor"); chevron → menu.
            Also (owner): the menu marks the pill's editor "Default" (was "Last used", shown only
            once you'd picked one); any pick from the list becomes the default, Finder included.
      - [x] **3d4. Sidebar hides fully** (~40, owner, D49) — closed, the sidebar island is gone
            (no 64px rail); a "Show sessions" button sits at the left of the main header, like
            the design. Open/closed is remembered per browser (in `kratos.sidebar`), closed by
            default as today. Accept: toggle both ways in the browser; typecheck, tests.
            Done: closed → no rail, header toggle; opened → survives reload; 63 tests pass.
      - [x] **3d3. Project chip + open in editor** (~150, owner, D50) — the header's raw path becomes a
            pill (folder icon, project name, chevron; full path in the menu). The menu opens the
            project in an installed editor (VS Code, Cursor, Zed, Windsurf, WebStorm, IntelliJ,
            Sublime, Xcode — whichever are found), reveals it in Finder/the file manager, or
            copies the path. Server detects editors at start (macOS: the .app in /Applications
            or ~/Applications; else the CLI via `which`) and sends them in `pong`; the browser
            sends `open_in {editor}` with an id from that list — only this project's folder is
            ever opened, no path or command comes from the browser. Launch via the `open`
            package. Accept: unit test for detection + id check; real run opens VS Code here.
            Done: found VS Code + Xcode here (VS Code via its .app, no `code` on PATH); opened it.
            Also (owner): real app logos (trimmed), last-used editor's logo on the chip (else the
            first found), connection dot inside the chip with an explaining tooltip.
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
- [ ] **3w. Quick settings** (owner, design: Home + Session boards' "Quick settings", Themes board)
      — a sliders button in the header (before the project pill) opens a popover: Theme (8
      swatches) and Notifications (Notify me → Needs your OK · Finished · Play a sound). Owner:
      settings saved by Kratos in `~/.kratos/settings.json`, shared by every tab and browser;
      notifications from the browser, only when you're not looking at Kratos; themes first.
  - [x] **3w1. Themes** (~250 logic + ~200 lines of theme colours) — core `Settings` (zod) +
        `settings` / `set_settings` messages; the CLI keeps `settings.json` (validated, written
        atomically) and sends changes to every tab. The 8 themes from the Themes board as CSS
        blocks (`[data-theme=…]`, every theme sets every app token; shadcn's names derived once).
        The page sets `data-theme` (+ `dark` for dark themes) on `<html>`, remembering the last
        one in the browser so a reload doesn't flash the default. Popover per the design (base-ui
        Popover via shadcn), each swatch drawn by its own theme's tokens (no hex in components).
        Accept: tests for the settings file and messages; screenshots of the popover and of the
        app in a light and a dark theme; a change in one tab shows in another.
        Checked: screenshots (popover in Kratos Dark and Paper, the app in Paper and Midnight); a
        second tab followed the pick without a reload; after a reload the theme is on <html> at
        DOMContentLoaded; settings.json holds the last pick. Code blocks stay github-dark (3w2).
  - [ ] **3w2. Code and diffs follow the theme** — Shiki on a CSS-variables theme bound to the
        Themes board's code tokens (plain, com, kw, str, num, fn, type, prop) instead of
        `github-dark`; diff tints from the board. Replaces `lib/appearance.ts`'s constant.
  - [x] **3w3. Notifications** (~200, before 3w2 — owner) — the popover's Notifications per the
        design: Notify me (on) → Needs your OK (on) · Finished (on) · Play a sound (on — owner; the design
        has it off), kept in
        `settings.json`. Builds on 3r3's `useAttention` (which already notifies on approvals and
        questions while the tab is hidden): adds Finished (working → idle), "away" = tab hidden or
        window in the background, the settings, one notification per event across tabs (a tab
        you're looking at marks it in localStorage; otherwise a Web Lock lets one tab notify), and
        a short chime (Web Audio, no file). Turning Notify me on asks the browser's permission;
        blocked shows how to unblock. Accept: tests for the settings; in a browser with granted
        permission, a hidden tab notifies on a question and on a finish, two tabs notify once,
        switches off → nothing.
        Done (D64). Not run: the end-to-end browser check (owner chose to release first).
- [x] **3k. Keyboard shortcuts** (owner, design: "Proposal · keyboard shortcuts" board, D66) —
      one list of shortcuts (`apps/web/src/lib/shortcuts.ts`, TanStack Hotkeys'
      `defineAppHotkeys`) drives both the keys and every hint: `<Shortcut id>` renders the
      binding as keycaps (⌘B on a Mac, Ctrl+B elsewhere), tooltips replace `title`. Hardcoded for
      now; user bindings later plug into the provider's `customHotkeys`, saved in `settings.json`.
      Owner: implement 3k1–3k3 in one go, with the review page's keys (after 3v3 landed).
  - [x] **3k0. Design** — the board: the keycap, tooltips with keys, hints in place (New session
        on hover, the ask's Deny/Allow, a faint / in the empty prompt), quick settings' Keyboard
        shortcuts row, the shortcuts sheet, and the review page (Back with Esc, P / N beside the
        neighbouring files, V inside Viewed, S on the layout switch). Platform tweak: Mac / Windows.
  - [x] **3k1. Foundation + ⌘B sidebar + ⌘, quick settings** (~150) — the library (exact
        version), the list, the provider, `<Shortcut>`, `<Hint>`; ⌘B toggles the sidebar
        (registered once in `Layout`), ⌘, opens quick settings (Popover made controlled);
        tooltips on both. Accept: ⌘B works from inside the prompt; ⌘, opens the popover;
        screenshots of the tooltips; typecheck, build, tests.
  - [x] **3k2. Shortcuts sheet ⌘/** (~120) — a dialog listing the list by group, including the
        prompt's and questions' own keys (display-only rows; their handlers stay where they
        are); quick settings' last row opens it. Accept: screenshot; every group shown.
  - [x] **3k3. Session and review actions** (~150) — ⇧⌘O new session; / focuses the prompt (not
        while typing); Esc stops a working turn (not while a question waits, or for an Esc that
        closed a menu); ⌘↵ / ⌘⌫ allow / deny the waiting ask (⌘↵ keeps meaning "send now" when the
        prompt has text; ⌘⌫ deletes the line while typing). Review: N / P, V, S, Esc back. Hints
        per the board. Accept: each in a real run, including the exceptions.
        Checked (3k1–3k3, built app, fake `claude`, headless Chromium as a Mac): 23 scripted
        checks pass — ⌘B from inside the prompt, its tooltip; ⌘, open/close; ⌘/ and the
        quick-settings row open the sheet with all 5 groups, Esc closes it; / focuses without
        typing, then types; ⌘⌫ with text deletes the line and the ask stays; ⌘↵ in the empty
        prompt allows; Esc closing the permission menu leaves the turn running, Esc in the prompt
        stops it; ⇧⌘O → Home; review N, P, V, S, N resting under the sheet, Esc closing the sheet
        stays, Esc → the session. Found and fixed on the way: an open tooltip swallowed Esc (over
        Stop it took two). Not checked: whether a real browser lets the page have ⌘, (owner);
        Windows labels (by the library's formatter only).
        Size: ~330 lines of code across 13 files (the three sub-steps together, + review keys).
- [ ] **3v. Reviewing changes (the diff)** (owner, design: Diff board "Proposal · reviewing
      changes", D65) — the core review flow: one file at a time, centred, in a full page that
      replaces the session view ("Back to the session"). Owner: diff = what this session changed,
      from per-turn git snapshots; drawn by us on jsdiff + Shiki; the review page first. Later,
      not in 3v (owner): "Why Claude Code changed this", files in Claude's order, ask/comment on
      lines, the request queue.
  - [x] **3v1. Snapshots + the diff over the wire** (~150 + tests) — at each turn's start and end
        the CLI records the working tree as a git tree object (a temporary index copied from the
        real one, `add -A`, `write-tree`: no change to your index, stash, branches or commits)
        and stores the ids per turn in SQLite. ClientMessage `get_changes {sessionId}` → server
        `changes`: the session's first-turn start tree vs the working tree now, per file: path,
        status (added / modified / deleted / renamed), +/− counts, old and new text (binary or
        too big → no text, says so). Not a git repo → `changes` says so. Git via `simple-git`.
        Scope: `apps/cli/src/changes/**`, store schema + migration, session-runtime hooks, core
        protocol. Accept: tests on a temp repo (edit, new file, delete, rename, binary,
        gitignored skipped, your index untouched, not a repo); real `claude` turn → `changes`
        lists the edit in the log.
        Checked: 6 git tests (incl. index/status/refs/stash byte-for-byte unchanged, subfolder,
        no-commit repo, no repo, pruned) + 3 hub tests (the agent hears the prompt only after the
        snapshot, in order; first snapshot → now; why-unavailable); 174 tests, build, typecheck.
        Real `claude` (Haiku) on a temp repo with a staged edit of mine: `changes` = greet.js
        modified +1 −1, farewell.js added; my staged notes.md not in it; index, refs, stash as
        before. Size: ~285 lines of code (over the ~150 guess) + ~190 of tests.
        Code review (owner asked) fixed: submodules/nested repos (`skipped: "submodule"`), Stop /
        remove / Send now during the start snapshot (now after the prompt), a failed repo lookup
        no longer remembered, the 16 MB cap in bytes, one `LogMessage` type in the web app.
        Owner accepted: blurry turn boundaries (revisit in 3v4); a failed start snapshot → the
        changes since the first good one + a `note`. 177 tests; real `claude` re-run passes.
  - [x] **3v2. Review page, unified** (~200) — route `/s/:id/review`, a header button on the
        session ("4 files +25 −5", per the design's way in). Left island: "Review changes",
        totals, the file list (name, dir, +/−, the 5-block bar). Main: the file's dir + name,
        "New file", the diff in a well: two line-number columns, +/− sign, tinted rows, Shiki
        syntax colour, word-level highlights inside changed lines (jsdiff `diffWordsWithSpace`),
        unchanged runs folded into "Show N unchanged lines" bars that expand. Theme tokens only.
        Accept: screenshots of a real session's changes (edit, new file, a fold opened);
        typecheck, tests for the row building (pure function).
        Checked: real `claude` (Haiku) renamed a method in a 300-line file, added a file, deleted
        one → screenshots at 1440 (session header "3 files +7 −5", deleted / new / long file with
        4 folds, one opened, the rename marked word by word) and 390 wide; 7 row tests, 184 in
        all, build, typecheck. Left for later: picking files at narrow width (3v3b), "Open in
        editor" for one file (the server opens only the project folder), the fold bar's
        enclosing-scope label ("class SessionHub"). Size: ~320 lines of code + 87 of tests.
  - [x] **3v3. Split / Unified + Viewed** (~300, owner: split the default) — a Split | Unified
        switch in the main header, split by default, remembered per browser; split pairs each
        removed line with its added one side by side (long lines wrap, an empty side hatched);
        below 1024px wide always unified (split needs the width; the switch hides). Viewed per
        file: the checkbox pill beside the file name, a tick in the file list, the progress
        meter + "2 of 4 viewed" under the totals. Kept by Kratos per session (SQLite), for one
        version of the change (`ChangedFile.version` = its before..after git blob ids): when the
        agent changes the file again it's unviewed. Every tab sees a change at once (`viewed`
        message). Accept: tests for pairing rows, viewed store/hub (incl. un-viewing on a new
        version); screenshots split + unified + narrow; viewed survives reload and resets after a
        new edit (real `claude`).
        Checked: fresh browser → Split; Unified picked survives a reload; two files marked
        viewed → "2 of 3 viewed", a second tab shows it without reloading, survives a reload; with
        the page left open, real `claude` edited one viewed file → 8 s later "1 of 3", that file
        unviewed, the other still viewed (owner: a changed file must unview); 390 wide → no
        switch, unified. Also (owner): only the file list scrolls (back link, title, progress
        stay), the back link hugs its text; the file's title + Viewed never move and the diff is
        a fixed-size box filling the rest of the island with its own scroll bars (checked: the
        only scroller in the main island, 684px showing 8450px; the title at the same y after
        scrolling; a short file sits at the top of the full box).
        Code review (owner asked) fixed: "earliest turns may be missing" is decided by log
        position, not time (a turn ending in the same ms as its snapshot gave a false note:
        `snapshots.log_seq`, migration 0009); split pairs exactly as the word marks do; a failed
        `get_changes` reply is logged, not an unhandled rejection; one in-project check in the
        hub. Left: a Viewed click undone within one round trip can flicker once. 187 tests, typecheck, build. Size: ~330 lines of code + ~90 of tests.
  - [ ] **3v3b. Moving through** (~100) — Previous / "Next · name" (marks viewed) / Finish
        review under the diff (N / P / V / S are in 3k's list already: the buttons show them),
        picking files at narrow width.
  - [ ] **3v4. Way in from the turn** (~120) — the turn's summary step "Changed 4 files
        +25 −5 · Review changes" (that turn's start → end snapshot), the header count updating
        live while the agent edits, a dot on files changed since you last looked. Accept: real
        `claude` multi-turn run.
- [x] **3x. Design review loop** (owner, D67) — screenshot every screen of the dev app (home,
      sidebar, session, questions, review split / unified, menus, quick settings, shortcuts, a
      light theme, narrow widths), review critically, score out of 10, fix, re-score, until ≥ 8.
      The design canvas stays the source of truth: its deliberate choices (30px diff lines, the
      34px file title, the faint `/`) are scored, not overridden. Scope: `apps/web/src/**`,
      PLAN/DECISIONS. Accept: before / after screenshots, typecheck, tests, build.
  - [x] **3x1. Rounds 1–3** (scores 6.5 → 7.4 → 7.8 → 8.0) — round 1: the diff's code and raw
        commands follow a light theme (they were always github-dark, unreadable on Light / Paper /
        Mist); no "✓ Done" chip on every command (not in the design; chips that say something
        stay: passed counts, Failed); the shortcuts sheet's columns stack on their own (no hole
        where rows lined up across); the header fits a narrow window (version pill hides, the
        project pill shrinks); a fade where the conversation scrolls under the title; empty and
        error states centred in the review island. Round 2: in a narrow window the agent chip is
        logo + model and the mode chip its icon (they truncated to "B", ","); a shortcut's "while
        working" and a file's "binary" are muted, not faint (faint is ~3:1). Round 3: split diff
        rows stay 30px but a wrapped line's next line is 22px down (wrapped prose read
        double-spaced); faint keycaps get a ring (the prompt's "/" read as a typo, the review's
        N / P as stray letters). Left, by design or another step: the copy row's air under each
        prompt, "Read after Read …", the 12px review title, picking files at narrow width (3v3b).
  - [x] **3x2. Rounds 4–5** (8.0 → 8.2) — the review counts only files changed during the
        session's turns (D67): the README test session went 44 → 2 files (the 2 were edited by
        someone else while its turns ran: D65's side-by-side limit). Live states reviewed for the
        first time, on a second Kratos (port 4400, a throwaway repo, a scripted stand-in for
        `claude` in the scratch folder): working, ask, allowed / denied, queue, questions, review,
        light theme, 600px. Fixed: "✓ 4 passed" for 18 passing tests (vitest prints its file count
        first: the last count wins now); a running step said "Searched …" while the working line
        said "Searching …" (unfinished steps show their intent, as asks already did); the copy
        button sits beside the prompt, not in an empty row under every one. Left: the sidebar's
        "Working" holding idle sessions (owner kept the names, 3d7), "store\.set" shown as the raw
        pattern.
        Code review fixes: a queued turn whose end snapshot failed is still counted (a turn_end
        logged inside a gap keeps it); the test chip prefers jest's / vitest's "Tests" line (not
        jest's "Snapshots: N passed"); `changedPaths` cached per tree pair (trees never change).
        Left from the review: paths git C-quotes (`"`, `\`, tab, newline in a name) can drop out
        of `only` (needs our own `-z` parse instead of simple-git's `diffSummary`); a slow start
        snapshot can briefly count between-turn edits; a whole-session rename can pair your
        deletion with the agent's new file. Released as v0.9.0.
- [ ] **3y. Architecture review fixes** (owner asked for the review, 2026-11-07) — what a broad
      review of the code found, as separate steps, most urgent first. 3y1 goes first and alone (it's
      a hole); 3y2 before more sessions pile up in the old shape; 3y3 before 3y4 (it shrinks what
      3y4 has to restructure); the rest whenever.
  - [ ] **3y1. Only Kratos's own page may connect** (~80 + tests) — today `/ws` takes any
        `Origin` (checked: a socket claiming `https://evil.example` got `pong`). Browsers don't
        apply same-origin rules to WebSockets, so any website open in your browser can connect to
        `ws://127.0.0.1:4317/ws`: it gets the latest session's replay (code, tool output, the
        project path) and can send a prompt in Bypass (`confirmDangerous` is a UI flag, not a
        control). Loopback binding doesn't stop it. Fix: refuse the upgrade unless `Origin` is
        Kratos's own (`http://localhost|127.0.0.1|[::1]:<port>`, the `--host` one, and in `pnpm
        dev` Vite's `:5173`, which its proxy forwards as-is); refuse HTTP requests whose `Host`
        isn't one of those (DNS rebinding, for `/attachments` and `/editor-icons`). No `Origin`
        (not a browser: the tests, curl) stays allowed — a local process can run code anyway.
        Owner: also a per-run secret (in the URL Kratos opens, then a cookie)? It would also cover
        another local user on a shared machine and `--host 0.0.0.0`, at the cost of links that
        stop working after a restart. Scope: `apps/cli/src/server.ts`, `index.ts`, its tests,
        `apps/web/vite.config.ts` if needed, DECISIONS. Accept: tests — foreign `Origin` refused
        (no replay, no `pong`), wrong `Host` → 403, own origin and no origin work; the built app
        and `pnpm dev` still work in a real browser; a page served from another port can't
        connect (checked by hand in the browser).
  - [ ] **3y2. The session log has its own schema, checked on load** (~150 + tests) — the
        `messages` table stores `ServerMessage` exactly as sent, and `store.load()` returns it
        unvalidated but typed as the current schema: so every field must stay optional forever
        ("absent in logs from before it existed"), a shape change has no migration path, and the
        database is the one boundary not checked with zod. And which messages are log entries is a
        hand-kept list (`LogMessage` excludes 11 types by name in `kratos-store.ts`): a new
        non-log message, list forgotten, lands in the chat. Fix: `LogEntry` (a zod union of the
        logged messages) in `packages/core`; `ServerMessage` = `LogEntry` ∪ the others, so the web
        app's `LogMessage` is just `LogEntry`; rows parsed with it on load, with a `format` column
        to upgrade old shapes when one changes. Owner: a row that doesn't parse — skipped and
        logged, or shown as "Kratos couldn't read this part"? Scope: core protocol, store +
        migration, `kratos-store.ts`, tests. Accept: today's rows (all 10 migrations' shapes) load;
        a broken row is handled as decided; typecheck proves a non-log message can't enter the log.
  - [ ] **3y3. Send now belongs to the adapter** (~150 moved, fewer lines overall) — the
        withdraw-the-others / send-now / re-queue-under-new-ids routine in `SessionRuntime`
        (`sendingNow`, `holding`, `agentIds`, `requeueHeld`) exists only because Claude's own Send
        now delivers *every* held prompt, and the generic `AgentSession` docs say so. Move it into
        the Claude adapter: `sendNow(id)` means "this one only" for any agent, and `prompt_state`
        reports Kratos's ids. Same look for `turnFromQueue` ("real CLI: B and D started at once"):
        can the adapter say it instead of the runtime guessing? Scope: `packages/core/src/agent.ts`
        (docs), the adapter, `session-runtime.ts`, tests. Accept: the hub's Send now tests pass
        unchanged; new adapter tests; real `claude` Send now with three queued prompts.
  - [ ] **3y4. The session's states, made explicit** (D68) — `SessionRuntime` (~600 lines)
        tracks a turn with ~8 flags that depend on each other: the place bugs will come from.
        Owner: a plain discriminated union (no XState); split in two, with 3y3 between them.
    - [x] **3y4a. The turn as a union** (~60) — `turnOpen`, `turnFromQueue`, `lastStep`,
          `runningStep` → `turn: idle | running { startedBy, lastStep?, runningStep? }`, set whole
          at each transition. Scope: `session-runtime.ts`, one hub test, DECISIONS. Accept: every
          existing test passes unchanged; a state diagram in the walkthrough.
          Done (owner approved): 191 existing tests pass unchanged, plus one new test for the bug the
          union fixed (a turn after the agent died mid-turn inherited its steps: fails on the old
          runtime with `after: "old"`, passes now). Size: +35 −28 in `session-runtime.ts`.
    - [ ] **3y4b. The queue as its own class** (~100 after 3y3) — `queue`, `agentIds`,
          `stopping` (and whatever 3y3 leaves of `sendingNow`) → `PromptQueue` in its own file.
          Accept: every hub and server test passes unchanged.
  - [ ] **3y5. Review code out of the hub; snapshots in log order** (~60) — `changes()` and
        `touched()` (~80 lines of review logic) move from `session-hub.ts` to `changes/`. Fix:
        the turn-end snapshot isn't awaited, so the next prompt's turn-start one can be stored
        first, and `snapshotsOf` orders by insert id: order by `log_seq` (id for old rows). The
        hub's message switch gets an exhaustive `default` (`satisfies never`), since the server
        handles half the types and the hub the rest. Scope: `apps/cli/src/session-hub.ts`,
        `changes/**`, `store.ts`, tests. Accept: a test where the start snapshot lands first;
        all tests pass.
  - [ ] **3y6. Long sessions stay fast** — the work grows with the square of a session's length:
        the web store copies the whole log per message and `buildTimeline` re-runs over all of it
        per message; connecting replays the latest session, then the tab's own on `open_session`
        (two replays off the latest); runtimes are never evicted (every session opened keeps its
        log in memory); every prompt waits on a whole-repo `git add --all`.
        **Numbers (2026-11-08, Node, the owner's biggest real session: 957 messages, 1.2 MB, 334
        chat items):** server side is cheap: SQLite load 5 ms, stringify 2 ms. Client: parse + zod
        8 ms, `buildTimeline` once 4 ms, **but once per replayed message 1,350 ms** (each WebSocket
        message is its own store update → `SessionPage` re-renders → timeline rebuilt; this is the
        blank screen). Rendering the chat (SSR as a proxy, no layout or Shiki) 120–230 ms, ~6,000
        elements. Server runtimes are already cached (`SessionHub.runtimes`); a client-side cache
        of the *data* would save ~15 ms, since the cost is building and drawing it, not fetching it.
    - [x] **3y6a. One update per replay + a spinner** (~40) — the web store collects a replay
          until `session_ready`, then sets the log once (live messages still append one at a
          time). While a session loads, the conversation area shows a spinner instead of nothing.
          Timing in the browser: open → `session_ready` → first paint, logged at debug. Scope:
          `lib/kratos-store.ts`, `pages/session.tsx`, a test. Accept: before / after browser
          numbers on the 957-message session; spinner seen on a slow open.
          **Proof (headless Chrome, deep link, warm runs):** chat drawn 1,530 → 260 ms after
          navigation; the replay itself 1,280 → 74 ms. D69.
    - [x] **3y6b. Connect straight to the tab's session** (~50) — e.g. `/ws?session=<id>`, so a
          deep link replays once, not the latest session first. Found in 3y6a: a deep link
          replays the latest session, then the tab's own **twice**. `SessionPage` sends
          `open_session` on connect (`viewing` still unset) and again when the connect's replay
          of the latest session arrives, so the chat is drawn, cleared and drawn again. Scope:
          `use-kratos-connection.ts`, `server.ts`, `session-hub.ts`, `pages/session.tsx`.
          Accept: one replay in the debug log on a deep link; `session drawn` measures the
          whole open.
          **Proof (headless Chrome, deep link, warm runs):** one `session` per load (was three);
          the chat mounts once, drawn at ~255 ms. On its own, the single replay made the first
          mount *slower* (~410 ms): the agent's name and `cwd` arrived after the replay and
          re-rendered the whole chat. Fixed by sending those first / waiting for `pong`. D70.
    - [x] **3y6c. Draw only what's near** (~120; after 3y6a's numbers) — draw the newest ~40
          items and more as you scroll up (keeping your place), or full virtualization
          (react-virtuoso, which handles variable heights and sticking to the bottom; it would
          replace use-stick-to-bottom). Windowing first: simpler, keeps find-in-page for what's
          drawn. Owner: is draw time still a problem after 3y6a? What's "fast enough" (e.g. a
          session opens in under 200 ms)? → Owner: go on. Windowing was built and measured, then
          the owner chose a library: react-virtuoso, "it works everywhere" (D71).
          **Proof (headless Chrome, 957-message session, warm):** switching to it 168 → ~80 ms
          (6,100 → ~50 elements in the chat); a link settles at the bottom in ~290 ms, as before
          (Virtuoso's measure passes cost what not drawing saves); wheel-scrolling reaches the
          first item, 0 remounts of items on screen, 2–6 jumps; a live turn follows the agent and
          leaves you in place (0 px) when you have scrolled up.
    - [x] **3y6e. Jump to the newest** (~40; owner, 2026-11-08) — scrolling up already stops the
          chat following the agent; now a round ↓ button floats over the bottom of the chat while
          you're away from the bottom, and takes you back there, where following resumes. Fades in
          late, so following a new message doesn't flash it. Not in the design canvas yet (the
          design has no such control): built from the composer's round buttons and the popovers'
          floating card. Scope: `components/conversation/conversation.tsx`. Accept (headless
          Chrome): shown after scrolling up, hidden at the bottom; a click lands at the very bottom
          (working indicator included) from far up; following resumes in a live turn; no flash
          while following at the bottom.
          **Proof (headless Chrome, scripted live turn, twice):** all six checks pass; a click
          from ~27,000 px up lands at 0 px. A plain smooth `scrollTo` landed 153 px short, so
          the button stayed and following didn't resume; a 200 ms fade-in flashed it 3 times in
          a live turn, 500 ms never.
    - [ ] **3y6d. Server memory and snapshots** (~60) — evict runtimes with no tab, no agent and
          nothing open; warn when a turn's snapshot is slow (synthetic 5,000-message session, big
          repo). Accept: before / after memory and snapshot numbers.
  - [ ] **3y7. Know which `claude` Kratos is driving** (~80 + a script) — the adapter relies on
        undocumented CLI internals (`cancel_async_message`, `interrupt {send_now}`,
        `apply_flag_settings`, `get_settings.applied`, two env vars read from claude 2.1.308), and
        the fake `claude` encodes our understanding of them, so tests stay green when the real one
        changes. Read `claude --version` once; log it; say so in the UI when it's outside the
        versions checked; a request the CLI no longer knows fails with a message naming its
        version. And the opt-in `pnpm smoke` promised under "Deliberately not tested": the main
        flows (prompt, allow / deny, queue, Send now, remove, model / effort / mode) on the real
        CLI in a temp repo. Scope: adapter, a `scripts/smoke` file, root `package.json`. Accept:
        the smoke run's output; a faked unknown version shows the warning.
- [x] **3z. Images the agent looked at** (~150; owner, 2026-11-08; BUGS "Screenshots viewed in
      the chat itself") — when a tool returns an image (Claude reads a screenshot to check its
      work; a browser MCP's screenshot), its step shows a small thumbnail; a click opens it large.
      Found on the real CLI (2.1.308, Haiku, $0.007): the tool_result's content is a list with
      `{type: "image", source: {type: "base64", media_type, data}}`, exactly what the agent saw
      (the CLI has already resized it). Today the adapter turns it into "[image]". Flow: the
      adapter keeps PNG/JPEG/GIF/WebP images on `tool_result.images` (base64); the runtime stores
      their bytes like prompt attachments (D55: by UUID, `attachments` table, served by
      `/attachments/:id` to this project only) and logs `attachments` refs instead, never bytes;
      the timeline puts them on the step; the step row draws thumbnails with the same lightbox as
      sent files. Scope: core `agent.ts` (+ `AttachmentRef` moves there), adapter `protocol.ts` +
      `map.ts`, `session-runtime.ts`, web `timeline.ts`, `step-group.tsx`, `attachments.tsx`,
      fake claude + tests. Accept: map, runtime (no bytes in the log) and timeline tests; in
      headless Chrome, a fake turn that reads an image shows the thumbnail and the lightbox.
      **Proof:** 3 new tests (201 pass). Headless Chrome with a fake turn answering exactly like
      the real CLI: the Read step shows a 96×64 thumbnail; a click opens the 1440×813 image,
      "Read shot.png", 96.9 kB, Open original; `/attachments/<id>` serves it as image/png; the
      97 KB image is in `attachments`, and no base64 is in the session log. D72.
- [x] **3z2. A big prompt stops auto-scroll** (~10; owner, 2026-11-08; BUGS) — found in headless
      Chrome (2 of ~10 scripted runs): the smooth follow to a big new prompt landed 48 px short,
      because the working indicator grew in the same update; Virtuoso counts > 4 px from the
      bottom as "scrolled up", and every later message is gated on that, so the chat stayed
      stuck. Fix (owner's): when a new prompt lands at the end, `scrollToIndex(LAST, end)` — a
      plain jump, wherever the view was. Scope: web `conversation.tsx`. Accept: the repro script
      ends at the bottom in 15 of 15 runs; typecheck, test, build.
      **Proof:** 15 of 15 at the bottom; the 48 px short landing still showed in 2 runs and was
      corrected within ~70 ms both times. Typecheck 7/7, 214 tests, build 5/5. D75.
- [x] **3z3. The chat follows until you scroll up** (~60; owner, 2026-11-08; BUGS, reopened) —
      3z2 didn't hold: with a stand-in `claude` that streams a real-looking turn (steps 400 ms
      apart, then a long reply), even a small prompt left the view at the prompt with the reply
      out of sight, 6 of 6 rounds. The jump lines the prompt up with the bottom, the working
      indicator appears under it, the view counts as "scrolled up", and nothing follows after
      that. Fix: `use-stick-to-bottom` (what bolt.new and AI Elements use; owner found a first,
      hand-written version too complicated): pinned until you scroll up, again at the bottom;
      Virtuoso virtualizes inside its scroll container. Scope: web `conversation.tsx`, the
      package. Accept: the stand-in repro ends at the bottom
      every round; scrolling up mid-turn stays put and the ↓ shows; ↓ resumes following;
      typecheck, test, build.
      **Proof:** before, 6 of 6 rounds stuck ~1000 px up with ↓ showing; after, 6 of 6 end at the
      bottom (1 px; sampled every frame in 3 more: off the bottom 1–2 samples, ~50–80 ms, while new
      content is measured). Its default spring glide trailed by ~850 px for ~1 s: `resize:
      "instant"`. Wheel up mid-turn: the view stays (gap 574 → 929 px as the turn went on), ↓
      shown; ↓ → bottom at the end, following again. Typecheck 7/7, 217 tests, build 5/5. D76.
- [ ] **4. Features and plans** (owner, 2026-11-08; design: "Proposal · features and plans" board,
      D73) — a feature is a folder in the sidebar that holds one plan and the sessions working on
      it; a session with no feature is a one-off. The plan is a document in the project, not a
      chat message: sessions update its steps and decisions, you tick steps done. Features first
      (4a–4c, no plans needed), then plans on top (4d–4k). Only 4a is specified in full; each
      later step gets its scope and acceptance when it's picked up.
  - [x] **4a. Features on the server** (~150 + tests) — the server knows features; no UI yet.
        A feature belongs to the project and has a title; a session belongs to at most one
        (none = a one-off). Store: a `features` table (id, project dir, title, done at, created,
        updated) and a nullable `sessions.feature_id`, with a drizzle migration. Protocol (core):
        `create_feature {title}`, `set_feature_done {id, done}`, `set_session_feature {sessionId,
        featureId | null}` (move to a feature, or back to one-off), and `featureId` on `prompt`
        (used when it starts a session, like `harness`); the server sends `features` (id, title,
        done, updatedAt) to each tab on connect and on every change, and `SessionSummary` gains
        `featureId`. Rules: titles are trimmed, 1–80 chars; a `featureId` must be one of this
        project's features and not done, else an `error`; marking a feature done leaves its
        sessions' own done alone. Scope: core `protocol.ts`, cli `store/schema.ts` + migration,
        `store.ts`, `session-hub.ts`, their tests. Accept: store + hub tests (create reaches every
        tab; a prompt with `featureId` starts a session listed with it; move in and back out;
        unknown or done feature refused; done flips); `pnpm dev` on the existing database
        migrates, and old sessions show as one-offs; build, typecheck, test pass.
        **Proof:** 7 new tests (208 pass); typecheck 7/7, build 5/5. A copy of the dev database
        migrated (11 migrations), its 15 sessions all one-offs; a feature made and a session
        moved into it there. ~160 lines of code + ~125 of tests. Also touched: the web store
        keeps `features` (else it would land in the chat log), `server.test.ts` filters it. D73.
  - [x] **4b. Folders in the sidebar** (~180; board §3–4) — Working lists features as folders
        first (most recently active first), then one-offs. A folder opens and closes
        (remembered); inside, its working sessions, and its done ones folded into "N done"
        (closed by default). A closed folder shows its most urgent status (needs you > working),
        so an ask can't hide in it; an empty one says "No sessions yet". The folder button by
        Working opens a name field: Enter creates, Esc cancels. A folder's hover check marks the
        feature done, like a session's; a done feature is one row in Done (Done mixes features
        and one-offs, newest first) that opens to all its sessions, with ↺ to reopen. The
        grouping is a pure function. Each section is a tree drawn with Headless Tree (owner:
        a library, not hand-rolled; D74): tree roles, ←/→ close / open, ↑/↓ move, Enter opens.
        Scope: web `sessions-sidebar.tsx`, `session-status.tsx` (the dot alone), new
        `lib/sidebar-tree.ts` + test, `lib/sidebar-prefs.ts`, the package. Accept: grouping
        tests; headless screenshots of an open folder, a closed one showing an ask, a done
        feature, and naming one; the keyboard walks and opens rows; typecheck, test, build.
        Review round (owner's picks): marking a feature done marks its sessions done, refused
        while one is busy, and new work reopens it (server + tests, D73); Working counts live
        sessions; row buttons are out of the Tab order. Then (owner): Done keeps the tree — a
        done session moves into its feature's folder in Done (no more "N done"), so a feature
        with live and done work has a folder in each section; features can be renamed (F2,
        double-click or the hover pencil; `rename_feature` on the server, Headless Tree's
        renaming in the sidebar). Board §4 updated to match.
        **Proof:** 214 tests pass (sidebar grouping and tree shape, rename, feature done with its
        sessions); typecheck 7/7, build 5/5. Headless Chrome on a copy of the dev database: open,
        closed-with-an-ask, done and Done-shaped folders, naming and renaming (F2 + Enter saves,
        Esc cancels), keyboard walk (←/→/↓/Enter), Tab enters each tree once. D73, D74.
  - [x] **4c. The shelf's feature pill** (~150; board §5) — the composer gets a shelf: a tray
        tucked under the card (the Worktrees proposal's), holding one pill for now. On Home it
        picks what the new session belongs to: One-off (the default, every time) or one of the
        working features; a Working folder's hover + opens Home with it picked (`/?feature=<id>`),
        and the prompt carries `featureId`. In a session the pill says which feature it's in
        (opening the plan comes with 4f); a one-off's opens "Move to a feature". No features yet:
        the menu says to make one with the folder button. "A new feature" waits for plans (4f);
        the git pills join the shelf with the worktree work. Scope: web `prompt-card.tsx` (shelf
        slot), new `feature-pill.tsx`, `pages/home.tsx`, `pages/session.tsx`,
        `sessions-sidebar.tsx` (the folder's +). Accept: screenshots of Home's shelf and menu,
        Home preset from a folder's +, a feature session's pill, a one-off's move menu; a prompt
        from Home with a feature lands in its folder; typecheck, test, build.
        **Proof:** 214 tests pass, typecheck 7/7, build 5/5 (UI only; the server side is 4a's,
        tested there). Headless Chrome on a copy of the dev database: the folder's + opened
        `/?feature=…` with the pill on Plans; Enter sent `featureId` with the prompt (held back
        in the browser, so no real `claude` ran); "Move to a feature" sent
        `set_session_feature` and the session showed in Plans, its pill now the feature's name.
        ~75 lines + the new `feature-pill.tsx` (~90).
  - [x] **4c2. New feature from the shelf** (~120; owner) — the pill's menu gets "New feature…":
        the pill becomes a name field (Enter or clicking away keeps it, Esc cancels). On Home
        the name rides on the prompt (`newFeatureTitle`, also kept in the URL as `?new=`) and
        the server makes the feature when the prompt starts the session, so an abandoned name
        leaves no empty folder; a one-off's shelf makes it and moves the session at once
        (`set_session_feature` with `newFeatureTitle`). Features get their own icon (owner
        picked Package: Package, PackageCheck done, PackagePlus new). Scope: core
        `protocol.ts`, `session-hub.ts` + tests, `feature-pill.tsx`, `home.tsx`, `session.tsx`,
        `sessions-sidebar.tsx` (icons). Accept: hub tests (made only by a session's first
        prompt; move into a new one; neither → error); live: Esc cancels, clicking away keeps,
        the prompt carries the name, a one-off moves into a new feature; typecheck, test, build.
        **Proof:** 216 tests pass (2 new hub tests), typecheck 7/7, build 5/5. Headless Chrome on
        a copy of the dev database: Esc left One-off (no `?new=`), clicking into the prompt kept
        the name, Enter sent `newFeatureTitle` (held back: no real `claude`), a one-off moved into
        a new "Reports" feature; Package icons throughout. ~175 lines incl. tests.
  - [x] **4c3. Drag sessions between features** (~120; owner) — drag a session onto a working
        feature's folder to move it there, or onto open space in a section to make it a one-off;
        a closed folder opens while you hover on it. Works within and across Working and Done
        (two trees: across them the drag carries the session ids); a done feature takes no drops
        (reopen it first, D73). Headless Tree's drag-and-drop, no reordering: a session's place
        is by activity. The folder under the drag lights up, the dragged row dims. The keyboard
        way stays the shelf's "Move to a feature". Scope: web `sessions-sidebar.tsx`,
        `lib/sidebar-tree.ts` (where a drop may land) + test. Accept: drop-rule tests; headless
        Chrome drags a session into a folder, between folders, out to a one-off, and from Done
        into a working feature; a drop on a done feature does nothing; typecheck, test, build.
        **Proof:** 217 tests pass (the drop rule), typecheck 7/7, build 5/5. Real drags in headless
        Chrome on a copy of the dev database: into another folder (moved), out to open space
        (one-off), Done → a Working folder (moved, the cross-tree path), onto a done feature and
        onto a sibling in its own folder (no move). The target folder and open space light up.
        No new package: Headless Tree's own drag-and-drop (D74). ~140 lines + ~20 of tests.
  - [x] **4c4. Review of features so far** (owner: "a good code review, fix the findings") — 10
        findings over 4a–4c3, all fixed: a one-off picked on Home now clears the feature of a
        reused empty session; reopening a session reopens its done feature; a later prompt's
        `featureId` is ignored, not refused; a drag from Done onto a session row lands in that
        row's folder; Done's open space takes no drops (it only removed the feature); on a
        one-off's page clicking away from a new feature's name cancels (only Enter makes it);
        the open-space highlight shows only when a drop would change something; renaming keeps
        a folder's place; one shared name field (`feature-name-field.tsx`); marking a feature
        done looks up only its sessions. **Proof:** 219 tests (2 new hub tests, store and drop
        rule extended); typecheck 7/7, build 5/5; live in headless Chrome: the drag cases (3, 5,
        D, E, A, B), the sidebar's name + Enter, and clicking away on a one-off's page.
  - [x] **4c5. Stop, then mark done** (~120; owner) — marking a session or a feature done while
        an agent in it is working (or waiting on you, or has prompts queued) asks first: "Stop and
        mark done?", saying the agent is stopped and anything queued dropped (a feature says how
        many of its sessions). On yes, the server stops each busy agent (`interrupt`, queue
        cancelled), then marks done. The server requires that consent (`stop: true`, like
        `confirmDangerous`): without it, a busy session or feature isn't marked done. Scope: core
        `protocol.ts`, `session-hub.ts` + tests, web `done-button.tsx`, `sessions-sidebar.tsx`,
        a shared dialog. Accept: hub tests (refused without `stop`; with it the agents are
        interrupted, queues cancelled, then done); live with the streaming stand-in: the dialog
        for a working session and a feature, Cancel leaves it working, confirm stops and marks
        done; typecheck, test, build.
        **Proof:** 221 tests (2 new hub tests: refused without consent and nothing stopped; with it
        only the busy agents are interrupted, queue cancelled, then done). Live, Kratos on the
        streaming stand-in: a working session's ✓ asked; "Keep working" left it working and
        didn't open anything under the dialog; "Stop and mark done" sent `stop: true`, the agent
        stopped (idle) and the session was done. Same for a feature ("1 of its sessions is still
        working…"): the folder stayed as it was on Keep working; confirm left feature and session
        done, agent idle. Typecheck 7/7, build 5/5.
  - [ ] **4d. Plan review card** (board §2) — `ExitPlanMode` shows the plan as a document beside
        the chat with Approve and build here / Keep planning (your note goes back); not saved yet.
  - [ ] **4e. Claude switches to plan by itself** (board §1) — a line in the chat with Claude's
        reason and Skip planning. First find out how `EnterPlanMode` reaches us (an ask or only
        a mode change).
  - [ ] **4f. Plans saved in features** (board §2, §6–7) — approving makes a feature (or fills
        the one the session is in) and writes `.kratos/features/<slug>/plan.md`; Approve, build
        later; the folder's Plan item opens the plan page, read-only; a new feature from the
        shelf can start in plan mode (4c2 makes it without a plan).
  - [ ] **4g. Edit before approving** (board §2) — Read / Edit in the review card; your edits go
        back to Claude as the approved plan (`updatedInput`).
  - [ ] **4h. Continue a plan in a new session** (board §3, §5) — the first prompt tells the agent
        about the plan; "Up next" step chips on Home; "Start in new session" on a step.
  - [ ] **4i. Plan changes per session** (board §3) — at turn end a changed plan is saved as a
        revision credited to the session and shown as "Updated the plan" with its diff; the
        session log on the plan page.
  - [ ] **4j. The gate and decisions** (board §3–4, §6) — a step Claude calls done waits for your
        tick; proposed decisions wait for Accept / Ask why; the right island shows the step in
        hand; "Mark feature done" when every step is ticked. Covers step 6.
  - [ ] **4k. Scope drift** (board §3) — files a turn changed outside the step's files are flagged
        with Show diff / Add to scope. The first piece of step 5's scope fence.
- [ ] **5. Step gates** — scope fence + budget enforced by Kratos itself (via
      `requestPermission`), using the D24 model: steps carry an estimate (agent must split before
      coding if it exceeds the budget); budget = review load (in-scope insertions, config/lockfiles/
      docs/excluded globs free); live budget meter in the UI; warn the agent at 80%; over budget →
      UI gate with **Extend** (+N lines, reason logged) / **Checkpoint** (commit what works, continue
      as a new step) / **Split** / **Revert**. Approve/reject between steps; checkpoints via git.
- [ ] **6. Decision ledger** — decisions captured as structured events, shown in UI, flippable.
      Now planned as part of 4j (decisions live in the feature's plan).
- [ ] **7. Dogfood** — build step 8+ of Kratos using Kratos.

## Website (distribution) — owner, D58

Kratos will ship as a CLI from Homebrew (`brew install ameerthehacker/kratos/kratos`, tap repo
`ameerthehacker/homebrew-kratos`; releases and the formula are step 3u). The site sells it: ultra minimal, built for mindful vibe coding, gives you a handle
on what's being built. Two gated slices (owner):

- [x] **W1. Astro site + one-page landing** (owner OK'd the size by picking two slices) — new
      `apps/site` (Astro, static, Tailwind v4, the app's design tokens and fonts). One page
      (owner: ultra simple, no "works with Claude Code"; it flaunts Kratos and gives the install
      command): logo + GitHub, headline, one line, the brew command (copy button), and a live
      replica of a Kratos session that plays a turn (prompt → working hammer → ask with diff →
      visitor clicks Allow or Deny, auto-allow if they don't → steps → reply, then loops).
      Mirrored on the design canvas as the "Website · one-pager" artboard (owner iterates there).
      Scope: `apps/site/**`, root `package.json` scripts, `pnpm-lock.yaml`, PLAN/DECISIONS.
      Accept: `pnpm --filter @kratos/site build` and `typecheck` pass; page checked in the
      browser at desktop and phone width; demo loops, Allow/Deny both work, copy button copies;
      reduced motion shows the finished turn without animation.
      Done (owner approved): build + `astro check` 0 errors; root typecheck 7/7, 83 tests pass;
      browser at 1440, 1024 and 375 wide, no sideways scroll; demo looped, auto-allowed, and Deny
      gave "You denied this" + the reply; copy → the copy event carried the exact command (the
      pane refuses the Clipboard API, so copy-to-clipboard as in D47); reduced motion (matchMedia
      overridden) → no auto-allow, Allow jumps to the end, no replay. First version also had
      feature tiles, a roadmap and a second install section — cut at the owner's request
      (`Features.astro` deleted). Also: `.claude/launch.json` (`site`) for the preview pane,
      auto-allow waits while the pointer or focus is on the ask, commands wrap at "/" on phones.
- [x] **W1b. README** (owner) — minimal: the logo from the site (`apps/site/public/favicon.svg`),
      the headline and one line, install, run.
- [ ] **W2. Install page** — `/install`: requirements (macOS + Homebrew, Claude Code installed
      and signed in), install, first run (`kratos [project-dir]`, the flags), update, uninstall,
      where data lives (`~/.kratos`), troubleshooting. Open question (owner): still wanted now that
      the one-pager carries the install command? If yes, the page gets one small link to it.

## Later ideas (not committed)

- Autonomy dial per path / action type
- "Predict" mode and "you write this" mode in the UI
- Data-flow walkthrough view per step
- Rewind / branch from any checkpoint
- More adapters (Codex CLI, Gemini CLI, Aider…). Before then (review, 2026-11-07): a tiny
  scripted in-memory adapter for the hub's tests, so `AgentAdapter` has a second implementation
  and stops taking Claude's shape (3y3 is one place it did)
- Worktree per session (review, 2026-11-07; D41's known limit): side-by-side sessions share one
  working tree today, so two agents can overwrite each other and a review counts the other's edits
- Plan step ids (`3u5c`, `3v3`) in code comments rot when steps are renumbered; D-numbers are
  stable. Owner's call whether to keep only D-numbers in code (then a CLAUDE.md line)
- Rebinding shortcuts (3k, D66): in the shortcuts sheet, `useHotkeyRecorder` + conflict check,
  saved as `Settings.keybindings`, passed to the provider's `customHotkeys`
- Track estimate vs actual per step to calibrate future estimates (step 2 missed by ~30%)
