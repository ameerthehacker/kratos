import { describe, expect, it } from "vitest";
import { toEvents } from "./map.js";
import { CliMessage } from "./protocol.js";

/** Same path as real CLI output: raw JSON → CliMessage schema → toEvents. */
const map = (raw: unknown, interrupted = false) => toEvents(CliMessage.parse(raw), interrupted);
const assistant = (...content: unknown[]) => ({ type: "assistant", message: { content } });
const toolResults = (...content: unknown[]) => ({ type: "user", message: { content } });

describe("toEvents: assistant messages", () => {
  it("maps text, non-empty thinking and tool_use in order; drops empty thinking", () => {
    const events = map(
      assistant(
        { type: "thinking", thinking: "" },
        { type: "thinking", thinking: "should use Write" },
        { type: "text", text: "Writing it now." },
        { type: "tool_use", id: "t1", name: "Write", input: { file_path: "a.txt" } },
      ),
    );
    expect(events).toEqual([
      { kind: "thinking", text: "should use Write" },
      { kind: "text", text: "Writing it now." },
      { kind: "tool_call", id: "t1", tool: "Write", input: { file_path: "a.txt" } },
    ]);
  });

  it("skips block kinds Kratos doesn't know, keeping the rest", () => {
    const events = map(
      assistant(
        { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
        { type: "text", text: "kept" },
        { type: "redacted_thinking", data: "…" },
      ),
    );
    expect(events).toEqual([{ kind: "text", text: "kept" }]);
  });
});

describe("toEvents: tool results", () => {
  it("handles string, text-array and missing content, and the error flag", () => {
    const events = map(
      toolResults(
        { type: "tool_result", tool_use_id: "a", content: "plain output" },
        {
          type: "tool_result",
          tool_use_id: "b",
          content: [{ type: "text", text: "line 1" }, { type: "image" }, { type: "text", text: "line 2" }],
        },
        { type: "tool_result", tool_use_id: "c" },
        { type: "tool_result", tool_use_id: "d", content: "denied: outside scope", is_error: true },
      ),
    );
    expect(events).toEqual([
      { kind: "tool_result", id: "a", output: "plain output", isError: false },
      { kind: "tool_result", id: "b", output: "line 1\n[image]\nline 2", isError: false },
      { kind: "tool_result", id: "c", output: "", isError: false },
      { kind: "tool_result", id: "d", output: "denied: outside scope", isError: true },
    ]);
  });

  it("ignores a user message that is plain text (not tool results)", () => {
    expect(map({ type: "user", message: { content: "hello" } })).toEqual([]);
  });
});

describe("toEvents: sub-agents", () => {
  it("skips assistant and user messages that come from a sub-agent", () => {
    const fromSubAgent = { parent_tool_use_id: "task_1" };
    expect(map({ ...assistant({ type: "text", text: "inner" }), ...fromSubAgent })).toEqual([]);
    expect(map({ ...toolResults({ type: "tool_result", tool_use_id: "x", content: "ok" }), ...fromSubAgent })).toEqual([]);
    expect(map({ ...assistant({ type: "text", text: "top" }), parent_tool_use_id: null })).toEqual([
      { kind: "text", text: "top" },
    ]);
  });
});

describe("toEvents: end of turn", () => {
  it("maps success to completed and any other subtype to error", () => {
    expect(map({ type: "result", subtype: "success" })).toEqual([{ kind: "turn_end", reason: "completed" }]);
    expect(map({ type: "result", subtype: "error_max_turns" })).toEqual([
      { kind: "turn_end", reason: "error", error: "error_max_turns" },
    ]);
  });

  it("reports interrupted when the session interrupted the turn, whatever the subtype", () => {
    expect(map({ type: "result", subtype: "error_during_execution" }, true)).toEqual([
      { kind: "turn_end", reason: "interrupted" },
    ]);
    expect(map({ type: "result", subtype: "success" }, true)).toEqual([{ kind: "turn_end", reason: "interrupted" }]);
  });
});
