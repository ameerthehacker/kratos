import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentSession, PermissionRequest, RequestPermission } from "@kratos/core";
import { createClaudeCodeAdapter } from "./index.js";

/** A fake `claude` that speaks the real control protocol, scripted by prompt (see the file). */
const FAKE_CLAUDE = fileURLToPath(new URL("../test/fake-claude.mjs", import.meta.url));
const WRITE_INPUT = { file_path: "a.txt", content: "hi" };

/** Run one turn against the fake and collect events until turn_end. */
async function runTurn(
  prompt: string,
  requestPermission: RequestPermission,
  onEvent?: (event: AgentEvent, session: AgentSession) => void,
): Promise<AgentEvent[]> {
  const session = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }).startSession({ cwd: process.cwd(), requestPermission });
  session.send(prompt);
  const events: AgentEvent[] = [];
  for await (const event of session.events) {
    events.push(event);
    onEvent?.(event, session);
    if (event.kind === "turn_end") break;
  }
  await session.stop();
  return events;
}

/** What the fake CLI received as the answer to its ask, reported back via tool_result. */
function answerSeenByCli(events: AgentEvent[]) {
  const result = events.find((e) => e.kind === "tool_result");
  if (result?.kind !== "tool_result") throw new Error("no tool_result in " + JSON.stringify(events));
  return { ...JSON.parse(result.output), isError: result.isError };
}

/**
 * A permission callback that only answers once it's cancelled — like a UI that answers too late.
 * Records whether the cancel arrived before the turn ended (stop() also aborts, so check earlier).
 */
function lateAnsweringPermission() {
  const state = { aborted: false, abortedBeforeTurnEnd: false };
  const callback: RequestPermission = (_req, { signal }) =>
    new Promise((resolve) =>
      signal.addEventListener("abort", () => {
        state.aborted = true;
        resolve({ decision: "allow" });
      }),
    );
  const onEvent = (event: AgentEvent) => {
    if (event.kind === "turn_end") state.abortedBeforeTurnEnd = state.aborted;
  };
  return { state, callback, onEvent };
}

describe("Claude Code adapter: permission gate", () => {
  it("passes the ask to Kratos and forwards allow with the original input", async () => {
    const seen: PermissionRequest[] = [];
    const events = await runTurn("ask", async (req) => (seen.push(req), { decision: "allow" }));

    expect(seen).toEqual([{ tool: "Write", input: WRITE_INPUT, reason: "edits need approval" }]);
    expect(answerSeenByCli(events)).toMatchObject({
      subtype: "success",
      request_id: "r1",
      response: { behavior: "allow", updatedInput: WRITE_INPUT },
      isError: false,
    });
    expect(events.at(-1)).toEqual({ kind: "turn_end", reason: "completed" });
  });

  it("forwards input edited by the owner", async () => {
    const edited = { file_path: "src/a.txt", content: "hi" };
    const events = await runTurn("ask", async () => ({ decision: "allow", updatedInput: edited }));
    expect(answerSeenByCli(events).response).toEqual({ behavior: "allow", updatedInput: edited });
  });

  it("forwards deny with the owner's message", async () => {
    const events = await runTurn("ask", async () => ({ decision: "deny", message: "outside step scope" }));
    expect(answerSeenByCli(events)).toMatchObject({
      response: { behavior: "deny", message: "outside step scope" },
      isError: true,
    });
  });

  it("fails closed: if the permission callback throws, the tool is denied", async () => {
    const events = await runTurn("ask", async () => {
      throw new Error("policy crashed");
    });
    const { response } = answerSeenByCli(events);
    expect(response.behavior).toBe("deny");
    expect(response.message).toContain("policy crashed");
  });

  it("aborts the callback and sends no answer when the CLI withdraws the ask", async () => {
    const { state, callback, onEvent } = lateAnsweringPermission();
    const events = await runTurn("cancel", callback, onEvent);
    expect(state.abortedBeforeTurnEnd).toBe(true);
    // The callback did answer (late); the adapter must not forward it to the CLI.
    expect(events.find((e) => e.kind === "tool_result")).toMatchObject({ output: "responses after cancel: 0" });
  });

  it("answers control requests it doesn't handle with an error, without asking Kratos", async () => {
    const permission = vi.fn<RequestPermission>();
    const events = await runTurn("unknown", permission);
    expect(permission).not.toHaveBeenCalled();
    const answer = answerSeenByCli(events);
    expect(answer).toMatchObject({ subtype: "error", request_id: "r1" });
    expect(answer.error).toContain("mcp_message");
  });
});

describe("Claude Code adapter: turn control", () => {
  it("interrupt() during a pending ask cancels it and ends the turn as interrupted", async () => {
    const { state, callback, onEvent } = lateAnsweringPermission();
    const events = await runTurn("hang", callback, (event, session) => {
      onEvent(event);
      if (event.kind === "tool_call") void session.interrupt();
    });
    expect(state.abortedBeforeTurnEnd).toBe(true);
    expect(events.at(-1)).toEqual({ kind: "turn_end", reason: "interrupted" });
  });

  it("reports a CLI crash mid-turn as turn_end error", async () => {
    const events = await runTurn("crash", async () => ({ decision: "allow" }));
    expect(events.at(-1)).toMatchObject({ kind: "turn_end", reason: "error" });
    expect((events.at(-1) as { error: string }).error).toMatch(/claude exited unexpectedly/);
  });
});
