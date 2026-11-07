import { describe, expect, it } from "vitest";
import type { AgentEvent, ServerMessage } from "@kratos/core";
import { buildTimeline, currentActivity, openAsks } from "./timeline";

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
      ["edit", "Edit a.ts", ["src", "+2 −1", "You denied this"], undefined], // denied: never happened
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

  it("attaches asks to their call by id, even two asks for the same tool out of order (3c4)", () => {
    const call = (id: string, command: string) =>
      agent({ kind: "tool_call", id, tool: "Bash", input: { command }, action: { type: "run", command } });
    const ask = (id: string, toolCallId: string) =>
      ({ type: "permission_request", id, request: { tool: "Bash", input: {}, toolCallId } }) as const;
    const items = buildTimeline([call("c1", "rm a"), call("c2", "rm b"), ask("ask-for-c1", "c1"), ask("ask-for-c2", "c2")]);
    expect(openAsks(items).map((s) => [s.id, s.ask?.id])).toEqual([
      ["c1", "ask-for-c1"],
      ["c2", "ask-for-c2"],
    ]);
  });
});

describe("currentActivity (3d6)", () => {
  const prompt = { type: "user_prompt", text: "go" } as const;
  const read = agent({ kind: "tool_call", id: "r", tool: "Read", input: {}, action: { type: "read", target: "/repo/src/store.ts" } });
  const activity = (...log: Parameters<typeof buildTimeline>[0]) => currentActivity(buildTimeline(log, "/repo"));

  it("says what the newest unfinished step is doing", () => {
    expect(activity(prompt, read)).toBe("Reading store.ts");
    const test = agent({ kind: "tool_call", id: "t", tool: "Bash", input: {}, action: { type: "run", command: "pnpm test" } });
    expect(activity(prompt, test)).toBe("Running the tests");
  });

  it("is null between steps, after thinking, after the reply, and while an ask waits for you", () => {
    expect(activity(prompt)).toBeNull(); // nothing yet: the indicator shows a word
    expect(activity(prompt, read, agent({ kind: "tool_result", id: "r", output: "", isError: false }))).toBeNull();
    expect(activity(prompt, agent({ kind: "thinking", text: "hmm" }))).toBeNull();
    expect(activity(prompt, read, agent({ kind: "text", text: "Here it is" }))).toBeNull();
    expect(activity(prompt, read, { type: "permission_request", id: "a", request: { tool: "Read", input: {}, toolCallId: "r" } })).toBeNull();
  });
});
