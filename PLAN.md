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
- More adapters (Codex CLI, Gemini CLI, Aider…)
- Track estimate vs actual per step to calibrate future estimates (step 2 missed by ~30%)
