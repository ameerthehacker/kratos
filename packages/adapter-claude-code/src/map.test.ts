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
      { kind: "tool_call", id: "t1", tool: "Write", input: { file_path: "a.txt" }, action: { type: "edit", target: "a.txt", edits: [{ before: "", after: "" }] } },
    ]);
  });

  it("describes Claude's tools in agent-neutral actions (D45)", () => {
    const action = (name: string, input: unknown) => {
      const [event] = map(assistant({ type: "tool_use", id: "t", name, input }));
      return event?.kind === "tool_call" ? event.action : undefined;
    };
    expect(action("Read", { file_path: "/r/a.ts" })).toEqual({ type: "read", target: "/r/a.ts" });
    expect(action("Edit", { file_path: "a.ts", old_string: "x", new_string: "y\nz" })).toEqual({
      type: "edit", target: "a.ts", added: 2, removed: 1, edits: [{ before: "x", after: "y\nz" }],
    });
    expect(action("Write", { file_path: "n.txt", content: "hello\n" })).toEqual({
      type: "edit", target: "n.txt", added: 1, edits: [{ before: "", after: "hello\n" }],
    });
    // A huge write keeps a capped preview, flagged as partial.
    const big = action("Write", { file_path: "big.txt", content: "x".repeat(20_000) });
    expect(big?.edits?.[0]).toMatchObject({ before: "", truncated: true });
    expect(big?.edits?.[0]?.after).toHaveLength(8000);
    expect(action("Bash", { command: "pnpm test", description: "Run tests" })).toEqual({
      type: "run", command: "pnpm test", description: "Run tests",
    });
    expect(action("Grep", { pattern: "TODO" })).toEqual({ type: "search", target: "TODO" });
    // Plan mode's end, as the real CLI sends it (4p6a): its own copy's path isn't Kratos's business.
    expect(action("ExitPlanMode", { plan: "# Plan\n\n## Steps\n", planFilePath: "/Users/x/.claude/plans/a.md" })).toEqual({
      type: "plan", plan: "# Plan\n\n## Steps\n",
    });
    // …and its start, when Claude decides to plan first (4p6c): it sends no input of its own.
    expect(action("EnterPlanMode", {})).toEqual({ type: "plan_mode" });
    expect(action("SomethingNew", {})).toEqual({ type: "other" });
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

  it("keeps the images a tool returned, as the real CLI sends them (3z); other types stay text", () => {
    const image = (media_type: string, data = "iVBORw0K") => ({ type: "image", source: { type: "base64", data, media_type } });
    const events = map(toolResults({ type: "tool_result", tool_use_id: "r", content: [image("image/png"), image("image/svg+xml", "PHN2Zz4=")] }));
    expect(events).toEqual([
      { kind: "tool_result", id: "r", output: "[image]\n[image]", isError: false, images: [{ mediaType: "image/png", base64: "iVBORw0K" }] },
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
