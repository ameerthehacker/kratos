import { describe, expect, it } from "vitest";
import type { AgentEvent, ServerMessage } from "@kratos/core";
import { buildTimeline, openAsks } from "./timeline";

const agent = (event: AgentEvent): Extract<ServerMessage, { type: "agent_event" }> => ({ type: "agent_event", event });

describe("buildTimeline (D45)", () => {
  it("groups consecutive tool calls into plain-words steps, with results and asks folded in", () => {
    const items = buildTimeline(
      [
        { type: "user_prompt", text: "fix the test" },
        agent({ kind: "thinking", text: "look first" }),
        agent({ kind: "tool_call", id: "r", tool: "Read", input: {}, action: { type: "read", target: "/repo/src/a.ts" } }),
        agent({ kind: "tool_result", id: "r", output: "code", isError: false }),
        agent({
          kind: "tool_call",
          id: "e",
          tool: "Edit",
          input: {},
          action: { type: "edit", target: "/repo/src/a.ts", added: 2, removed: 1, edits: [{ before: "x", after: "y\nz" }] },
        }),
        { type: "permission_request", id: "ask1", request: { tool: "Edit", input: {} } },
        { type: "permission_resolved", id: "ask1", outcome: "denied" },
        agent({ kind: "tool_result", id: "e", output: "denied", isError: true }), // no extra "Failed"
        agent({ kind: "tool_call", id: "b", tool: "Bash", input: {}, action: { type: "run", command: "pnpm test" } }),
        { type: "permission_request", id: "ask2", request: { tool: "Bash", input: {} } },
        agent({ kind: "text", text: "Done." }),
        agent({ kind: "tool_call", id: "x", tool: "Mystery", input: { a: 1 } }), // old log: no action
        agent({ kind: "tool_result", id: "x", output: "nope", isError: true }),
        agent({ kind: "turn_end", reason: "interrupted" }),
      ],
      "/repo",
    );

    expect(items.map((i) => i.type)).toEqual(["prompt", "steps", "reply", "steps", "event"]);
    const [, first, , second, stopped] = items;
    if (first?.type !== "steps" || second?.type !== "steps") throw new Error("expected step groups");
    expect(first.steps.map((s) => [s.kind, s.title, s.chips.map((c) => c.text), s.ask?.id])).toEqual([
      ["think", "Thought it through", [], undefined],
      ["read", "Read a.ts", ["src"], undefined],
      ["edit", "Edited a.ts", ["src", "+2 −1", "You denied this"], undefined],
      ["run", "Ran the tests", [], "ask2"], // its ask is still open
    ]);
    expect(first.steps[3]?.intent).toBe("Run the tests");
    expect(first.steps[2]?.edit).toEqual({ path: "src/a.ts", changes: [{ before: "x", after: "y\nz" }] });
    expect(openAsks(items).map((s) => s.ask?.id)).toEqual(["ask2"]); // what the dock shows
    expect(first.steps[3]?.raw).toEqual({ command: "pnpm test" });
    expect(second.steps[0]).toMatchObject({ kind: "other", title: "Used Mystery", raw: { call: 'Mystery {"a":1}', output: "nope" } });
    expect(second.steps[0]?.chips).toEqual([{ text: "Failed", tone: "bad" }]);
    expect(stopped).toEqual({ type: "event", text: "Stopped" });
  });
});
