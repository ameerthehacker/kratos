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
- [ ] **1. Agent interface review** — owner reviews and finalizes the draft `AgentAdapter` /
      `AgentEvent` types in `packages/core/src/agent.ts`. Scope: `packages/core/**`.
      Accept: owner can explain each type; decisions logged.
- [ ] **2. Claude Code adapter** — drive the Claude Code CLI via the official
      `@anthropic-ai/claude-agent-sdk` (it spawns `claude` for us and gives typed messages,
      permission callbacks and hooks) instead of parsing `stream-json` ourselves; map its
      messages to `AgentEvent`s. New package `packages/adapter-claude-code`. Accept: a script
      sends a prompt and prints normalized events.
- [ ] **3. Session over WebSocket** — UI sends a prompt, server runs the adapter, streams events
      back; UI renders a raw event log. Accept: live demo in the browser.
- [ ] **4. Plan artifact** — plan file model + UI to view/edit steps; agent must write a plan
      before code.
- [ ] **5. Step gates** — scope fence + diff budget enforced by Kratos (not just Claude Code
      hooks); approve/reject between steps; checkpoints via git commits.
- [ ] **6. Decision ledger** — decisions captured as structured events, shown in UI, flippable.
- [ ] **7. Dogfood** — build step 8+ of Kratos using Kratos.

## Later ideas (not committed)

- Autonomy dial per path / action type
- "Predict" mode and "you write this" mode in the UI
- Data-flow walkthrough view per step
- Rewind / branch from any checkpoint
- More adapters (Codex CLI, Gemini CLI, Aider…)
