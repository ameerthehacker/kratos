# Kratos bugs and asks

The owner's issues, noted as they come up so nothing gets lost. Not a plan: when one is picked
up it becomes a step in `PLAN.md` (intent, scope, acceptance) and is marked here with that step.

Status: `[ ]` open · `[~]` planned (step in PLAN.md) · `[x]` done (step)

## Open

- [~] **Screenshots viewed in the chat itself** (step 3z) (owner, 2026-11-07) — see a screenshot right in
      the conversation instead of having to open it elsewhere.
- [ ] **Skills invocation** (owner, 2026-11-07) — invoke the agent's skills from Kratos.
- [ ] **File mentions** (owner, 2026-11-07) — mention files in a prompt.
- [x] **A big prompt stops auto-scroll** (step 3z3) (owner, 2026-11-08; reopened 2026-11-08) — after sending a long message to the
      agent, the chat no longer follows new output; the message's size seems to knock it out of
      "stuck to the bottom". Step 3z2 (D75: a new prompt jumps to the bottom) didn't fix it for
      the owner: still happens in real use, and even a small prompt does it. D75's known gap
      (another short landing, e.g. a big reply, knocks the chat out of following) is a suspect.
- [ ] **Marking a file viewed with its shortcut should go to the next file** (owner, 2026-11-08)
      — in the changes review, marking viewed from the keyboard leaves you on the same file.
- [ ] **Unviewed files first when moving between files** (owner, 2026-11-08) — next / previous
      file in the review should prefer files not yet viewed.
- [ ] **Shades of change in the diff** (owner, 2026-11-08) — in the review, one color for what
      the whole session changed and another for what changed since you last viewed the file; and
      the file list marks files that changed since you last viewed them.
