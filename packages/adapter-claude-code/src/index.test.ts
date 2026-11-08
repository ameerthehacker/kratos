import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { hostTool, type AgentEvent, type AgentSession, type AskQuestions, type Conversation, type PermissionRequest, type QuestionRequest, type RequestPermission } from "@kratos/core";
import { cliEnv, createClaudeCodeAdapter } from "./index.js";

/** A fake `claude` that speaks the real control protocol, scripted by prompt (see the file). */
const FAKE_CLAUDE = fileURLToPath(new URL("../test/fake-claude.mjs", import.meta.url));
const WRITE_INPUT = { file_path: "a.txt", content: "hi" };

/** Run one turn against the fake and collect events until turn_end. */
async function runTurn(
  prompt: string,
  requestPermission: RequestPermission,
  onEvent?: (event: AgentEvent, session: AgentSession) => void,
  conversation?: Conversation,
): Promise<AgentEvent[]> {
  const session = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }).startSession({
    cwd: process.cwd(),
    requestPermission,
    conversation,
  });
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

    expect(seen).toEqual([
      {
        tool: "Write",
        input: WRITE_INPUT,
        reason: "edits need approval",
        toolCallId: "t1", // the CLI's tool_use_id: the ask names its call (3c4)
        action: { type: "edit", target: "a.txt", added: 1, edits: [{ before: "", after: "hi" }] },
      },
    ]);
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

describe("Claude Code adapter: conversations", () => {
  /** The CLI arguments the adapter started the (fake) claude with. */
  async function argsFor(conversation?: Conversation): Promise<string[]> {
    const events = await runTurn("args", async () => ({ decision: "allow" }), undefined, conversation);
    const result = events.find((e) => e.kind === "tool_result");
    return result?.kind === "tool_result" ? JSON.parse(result.output) : [];
  }
  const ID = "6f1c2b9e-0d4a-4c1e-9a77-3b1f1f2a9c10";

  it("starts claude with artifacts on and a wait for MCP connectors (D62)", async () => {
    const events = await runTurn("env", async () => ({ decision: "allow" }));
    const result = events.find((e) => e.kind === "tool_result");
    expect(result?.kind === "tool_result" && JSON.parse(result.output)).toEqual({ CLAUDE_CODE_ARTIFACT: "1", CLAUDE_CODE_MCP_STARTUP_WAIT_MS: "10000" });
  });

  it("leaves those to your own environment when it sets them", () => {
    expect(cliEnv({ CLAUDE_CODE_ARTIFACT: "0", CLAUDE_CODE_MCP_STARTUP_WAIT_MS: "0" })).toEqual({ CLAUDE_CODE_ARTIFACT: "0", CLAUDE_CODE_MCP_STARTUP_WAIT_MS: "0" });
  });

  it("names a new conversation with --session-id, continues one with --resume, else neither", async () => {
    const fresh = await argsFor();
    expect(fresh).not.toContain("--session-id");
    expect(fresh).not.toContain("--resume");

    const named = await argsFor({ id: ID, resume: false });
    expect(named.slice(named.indexOf("--session-id"), named.indexOf("--session-id") + 2)).toEqual(["--session-id", ID]);
    expect(named).not.toContain("--resume");

    const resumed = await argsFor({ id: ID, resume: true });
    expect(resumed.slice(resumed.indexOf("--resume"), resumed.indexOf("--resume") + 2)).toEqual(["--resume", ID]);
    expect(resumed).not.toContain("--session-id");
  });
});

describe("Claude Code adapter: models (D43)", () => {
  it("lists the CLI's models, aliases as 'latest' and pinned ids as 'other', asking only once", async () => {
    const adapter = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE });
    const first = adapter.listModels();
    expect(adapter.listModels()).toBe(first); // cached: no second CLI start
    const all = ["low", "medium", "high", "xhigh", "max"];
    expect(await first).toEqual([
      { id: "default", label: "Default (recommended)", description: "Best for everyday tasks", group: "latest", isDefault: true, efforts: all },
      { id: "haiku", label: "Haiku 5.5", description: "Fastest", group: "latest", efforts: all },
      { id: "claude-opus-4-6", label: "Opus 4.6", description: "No xhigh", group: "other", efforts: ["low", "medium", "high", "max"] },
      { id: "claude-haiku-4-5", label: "Haiku 4.5", description: "No effort control", group: "other" }, // no efforts
    ]);
  });

  it("starts on the chosen model (--model), switches it live (set_model), and back to the default", async () => {
    const session = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }).startSession({
      cwd: process.cwd(),
      requestPermission: async () => ({ decision: "allow" }),
      model: "haiku",
    });
    // Keep consuming events like the hub does: the CLI confirms set_model on its output.
    const seen: AgentEvent[] = [];
    const pump = (async () => {
      for await (const event of session.events) seen.push(event);
    })();
    const nthReport = async (n: number) => {
      await vi.waitFor(() => expect(seen.filter((e) => e.kind === "tool_result").length).toBeGreaterThanOrEqual(n));
      const result = seen.filter((e) => e.kind === "tool_result")[n - 1];
      return result?.kind === "tool_result" ? result.output : undefined;
    };
    try {
      session.send("model");
      expect(await nthReport(1)).toBe("haiku");
      await session.setModel("claude-opus-4-6"); // resolves once the CLI confirms
      session.send("model");
      expect(await nthReport(2)).toBe("claude-opus-4-6");
      await session.setModel(null); // Kratos's "agent default" → Claude's own name for it (3c4)
      session.send("model");
      expect(await nthReport(3)).toBe("default");
    } finally {
      await session.stop();
      await pump;
    }
  });
});

describe("Claude Code adapter: effort (D51)", () => {
  /** A session kept running like the hub does: the CLI answers control requests on its output. */
  function running(options: { model?: string; effort?: string } = {}) {
    const session = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }).startSession({
      cwd: process.cwd(),
      requestPermission: async () => ({ decision: "allow" }),
      ...options,
    });
    const pump = (async () => {
      for await (const _ of session.events);
    })();
    return { session, done: async () => (await session.stop(), await pump) };
  }

  it("asks the CLI to name the session (generate_session_title, 3z4)", async () => {
    const { session, done } = running();
    try {
      expect(await session.title!("Reports page needs a CSV export\nwith filters")).toBe("Title: Reports page needs a CSV expor"); // the fake keeps 30 characters
    } finally {
      await done();
    }
  });

  it("starts at the chosen level (--effort), switches it live, and reads back the level in use", async () => {
    const { session, done } = running({ effort: "low" });
    try {
      expect(await session.effort()).toBe("low");
      await session.setEffort("max");
      expect(await session.effort()).toBe("max");
    } finally {
      await done();
    }
  });

  it("reports the agent's own default when nothing was chosen", async () => {
    const { session, done } = running({ model: "haiku" });
    try {
      expect(await session.effort()).toBe("medium");
    } finally {
      await done();
    }
  });

  it("refuses a level the current model doesn't list (the CLI would 'succeed' and ignore it)", async () => {
    const { session, done } = running();
    try {
      await expect(session.setEffort("turbo")).rejects.toThrow(/no effort level "turbo"/);
      await session.setModel("claude-opus-4-6");
      await expect(session.setEffort("xhigh")).rejects.toThrow(/claude-opus-4-6 has no effort level "xhigh"/);
      await session.setModel("claude-haiku-4-5");
      await expect(session.setEffort("low")).rejects.toThrow(/has: none/);
      expect(await session.effort()).toBeNull(); // a model without effort control
    } finally {
      await done();
    }
  });

  it("shows what the CLI really uses after a model switch: its level is clamped, then restored", async () => {
    const { session, done } = running({ effort: "xhigh" });
    try {
      await session.setModel("claude-opus-4-6"); // has no xhigh
      expect(await session.effort()).toBe("high");
      await session.setModel(null);
      expect(await session.effort()).toBe("xhigh");
    } finally {
      await done();
    }
  });
});

describe("Claude Code adapter: permission modes (D53)", () => {
  /** A session kept running like the hub does; collects every event. */
  function running(options: { permissionMode?: string } = {}, requestPermission: RequestPermission = async () => ({ decision: "allow" })) {
    const session = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }).startSession({ cwd: process.cwd(), requestPermission, ...options });
    const seen: AgentEvent[] = [];
    const pump = (async () => {
      for await (const event of session.events) seen.push(event);
    })();
    const reports = () => seen.flatMap((e) => (e.kind === "tool_result" ? [e.output] : []));
    const modes = () => seen.flatMap((e) => (e.kind === "permission_mode" ? [e.mode] : []));
    const turn = async (prompt: string) => {
      const before = seen.filter((e) => e.kind === "turn_end").length;
      session.send(prompt);
      await vi.waitFor(() => expect(seen.filter((e) => e.kind === "turn_end").length).toBe(before + 1));
    };
    return { session, turn, reports, modes, done: async () => (await session.stop(), await pump) };
  }

  it("lists Claude's six modes, Bypass marked dangerous and Ask as the default", () => {
    const { permissionModes } = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE });
    expect(permissionModes.map((m) => m.id)).toEqual(["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"]);
    expect(permissionModes.filter((m) => m.dangerous).map((m) => m.id)).toEqual(["bypassPermissions"]);
    expect(permissionModes.find((m) => m.isDefault)?.id).toBe("default");
  });

  it("starts in the chosen mode, switches live (also to Bypass), and reports each change once", async () => {
    const { session, turn, reports, modes, done } = running({ permissionMode: "acceptEdits" });
    try {
      await turn("mode");
      expect(reports()).toEqual(["acceptEdits"]);
      expect(modes()).toEqual([]); // the turn's init line repeats the start mode: not a change
      expect(await session.setPermissionMode("manual")).toBe("default"); // the CLI's applied mode
      expect(await session.setPermissionMode("bypassPermissions")).toBe("bypassPermissions"); // allow flag passed
      await turn("mode");
      expect(reports()).toEqual(["acceptEdits", "bypassPermissions"]);
      expect(modes()).toEqual(["default", "bypassPermissions"]);
    } finally {
      await done();
    }
  });

  it("passes the CLI's refusal of an unknown mode through", async () => {
    const { session, done } = running();
    try {
      await expect(session.setPermissionMode("turbo")).rejects.toThrow(/must be one of/);
    } finally {
      await done();
    }
  });

  it("follows the agent's own switch: approving a plan leaves plan mode", async () => {
    const { turn, reports, modes, done } = running({ permissionMode: "plan" });
    try {
      await turn("plan");
      expect(reports()).toEqual(["default"]);
      expect(modes()).toEqual(["default"]);
    } finally {
      await done();
    }
  });
});

describe("Claude Code adapter: questions (D54)", () => {
  /** Run the fake's question turn; what the CLI got back, and what Kratos was asked. */
  async function questionTurn(askQuestions?: AskQuestions) {
    const asked: QuestionRequest[] = [];
    const permission = vi.fn<RequestPermission>();
    const session = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }).startSession({
      cwd: process.cwd(),
      requestPermission: permission,
      askQuestions: askQuestions && (async (request, options) => (asked.push(request), askQuestions(request, options))),
    });
    session.send("question");
    let response: { behavior: string; updatedInput?: { answers?: Record<string, string> }; message?: string } | undefined;
    for await (const event of session.events) {
      if (event.kind === "tool_result") response = JSON.parse(event.output);
      if (event.kind === "turn_end") break;
    }
    await session.stop();
    expect(permission).not.toHaveBeenCalled(); // questions never go to the permission gate
    return { response, asked };
  }

  it("asks Kratos in agent-neutral terms and answers with the CLI's labels, joined picks and own text", async () => {
    const { response, asked } = await questionTurn(async () => ({
      outcome: "answered",
      answers: [{ selected: ["Opus"] }, { selected: ["Red", "Blue"], other: "  teal  " }],
    }));
    expect(asked).toEqual([
      {
        toolCallId: "t1",
        questions: [
          {
            header: "Model",
            question: "Which model?",
            multiSelect: false,
            options: [{ label: "Opus", description: "Smartest", recommended: true }, { label: "Haiku" }],
          },
          { header: "Colors", question: "Which colors?", multiSelect: true, options: [{ label: "Red" }, { label: "Blue" }, { label: "Green" }] },
        ],
      },
    ]);
    expect(response?.behavior).toBe("allow");
    expect(response?.updatedInput?.answers).toEqual({ "Which model?": "Opus (Recommended)", "Which colors?": "Red, Blue, teal" });
  });

  it("tells the agent to decide for itself when the owner skips", async () => {
    const { response } = await questionTurn(async () => ({ outcome: "skipped" }));
    expect(response).toMatchObject({ behavior: "deny", message: expect.stringContaining("Make your own call") });
  });

  it("refuses the questions (never a bare allow) when nobody can answer them", async () => {
    const { response } = await questionTurn(undefined);
    expect(response).toMatchObject({ behavior: "deny", message: expect.stringContaining("couldn't show these questions") });
  });
});

describe("Claude Code adapter: attachments (D55)", () => {
  it("says what it accepts: images, PDFs and text, with the API's limits", () => {
    const { attachments } = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE });
    expect(attachments.kinds.map((k) => k.kind)).toEqual(["image", "pdf", "text"]);
    expect(attachments.maxCount).toBe(10);
  });

  it("sends files as content blocks before the prompt: images and PDFs base64, text as a titled document", async () => {
    const session = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }).startSession({
      cwd: process.cwd(),
      requestPermission: async () => ({ decision: "allow" }),
    });
    const bytes = (text: string) => new TextEncoder().encode(text);
    session.send("blocks", [
      { name: "red.png", kind: "image", mediaType: "image/png", data: new Uint8Array([137, 80, 78, 71]) },
      { name: "spec.pdf", kind: "pdf", mediaType: "application/pdf", data: bytes("%PDF-1.4") },
      { name: "notes.md", kind: "text", mediaType: "text/plain", data: bytes("# Notes\n4711") },
    ]);
    let blocks: unknown;
    for await (const event of session.events) {
      if (event.kind === "tool_result") blocks = JSON.parse(event.output);
      if (event.kind === "turn_end") break;
    }
    await session.stop();
    expect(blocks).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", length: 8 } }, // 4 bytes → 8 base64 chars
      { type: "document", title: "spec.pdf", source: { type: "base64", media_type: "application/pdf", length: 12 } },
      { type: "document", title: "notes.md", source: { type: "text", media_type: "text/plain", length: 12, data: "# Notes\n4711" } },
      { type: "text" },
    ]);
  });
});

describe("Claude Code adapter: steering (D56)", () => {
  /** A running session; `log` lists what Kratos saw, compactly. */
  function running() {
    const session = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }).startSession({
      cwd: process.cwd(),
      requestPermission: async () => ({ decision: "allow" }),
    });
    const log: string[] = [];
    const pump = (async () => {
      for await (const e of session.events) {
        if (e.kind === "prompt_state") log.push(`${e.id}:${e.state}`);
        if (e.kind === "text") log.push(`text:${e.text}`);
        if (e.kind === "turn_end") log.push(`end:${e.reason}`);
      }
    })();
    const ends = () => log.filter((l) => l.startsWith("end:")).length;
    return { session, log, waitForEnds: (n: number) => vi.waitFor(() => expect(ends()).toBe(n)), done: async () => (await session.stop(), await pump) };
  }

  it("holds a prompt sent mid-turn and reads it at the next step, in the same turn", async () => {
    const { session, log, waitForEnds, done } = running();
    try {
      session.send("steps", [], { id: "A" });
      session.send("also B", [], { id: "B" });
      await waitForEnds(1);
      expect(log).toEqual(["A:queued", "A:started", "B:queued", "B:started", "text:read: also B", "end:completed", "A:completed", "B:completed"]);
    } finally {
      await done();
    }
  });

  it("runs a prompt held through a reply with no step left as the next turn", async () => {
    const { session, log, waitForEnds, done } = running();
    try {
      session.send("slow", [], { id: "A" });
      session.send("model", [], { id: "B" });
      await waitForEnds(2);
      expect(log.indexOf("B:started")).toBeGreaterThan(log.indexOf("end:completed")); // after A's turn
    } finally {
      await done();
    }
  });

  it("withdraws one held prompt, or all of them with Stop", async () => {
    const one = running();
    try {
      one.session.send("steps", [], { id: "A" });
      one.session.send("also B", [], { id: "B" });
      expect(await one.session.cancelPrompt("B")).toBe(true);
      expect(await one.session.cancelPrompt("B")).toBe(false); // already gone
      await one.waitForEnds(1);
      expect(one.log).toContain("B:cancelled");
      expect(one.log).toContain("text:read: nothing");
    } finally {
      await one.done();
    }
    const all = running();
    try {
      all.session.send("steps", [], { id: "A" });
      all.session.send("also B", [], { id: "B" });
      all.session.send("also C", [], { id: "C" });
      await vi.waitFor(() => expect(all.log).toContain("C:queued"));
      await all.session.interrupt({ cancelQueued: true });
      await all.waitForEnds(1);
      expect(all.log).toEqual(expect.arrayContaining(["B:cancelled", "C:cancelled", "end:interrupted"]));
      expect(all.log.some((l) => l.endsWith(":started") && !l.startsWith("A"))).toBe(false);
    } finally {
      await all.done();
    }
  });

  it("Send now stops the step and the held prompt runs right away", async () => {
    const { session, log, waitForEnds, done } = running();
    try {
      session.send("steps", [], { id: "A" });
      session.send("model", [], { id: "B" });
      await vi.waitFor(() => expect(log).toContain("B:queued"));
      await session.sendNow("B");
      await waitForEnds(2);
      expect(log).toEqual(expect.arrayContaining(["end:interrupted", "A:cancelled", "B:started", "end:completed"]));
      expect(log.indexOf("B:started")).toBeGreaterThan(log.indexOf("end:interrupted"));
    } finally {
      await done();
    }
  });

  it("ignores lifecycle lines for prompts it didn't tag", async () => {
    const { session, log, waitForEnds, done } = running();
    try {
      session.send("model"); // no id
      await waitForEnds(1);
      expect(log.filter((l) => !l.startsWith("end:") && !l.startsWith("text:"))).toEqual([]);
    } finally {
      await done();
    }
  });
});

describe("Claude Code adapter: host tools (D77)", () => {
  const calls: Array<string | undefined> = [];
  const echo = hostTool({
    name: "echo",
    description: "Says the text back",
    input: z.object({ text: z.string() }),
    async call({ text }, { toolCallId }) {
      calls.push(toolCallId);
      return { text: `echo: ${text}` };
    },
  });
  const boom = hostTool({ name: "boom", description: "Always fails", input: z.object({}), call: async () => Promise.reject(new Error("nope")) });

  const withdrawn: string[] = [];
  const slow = hostTool({
    name: "slow",
    description: "Waits until withdrawn",
    input: z.object({}),
    call: (_, { signal }) => new Promise((done) => signal.addEventListener("abort", () => (withdrawn.push("slow"), done({ text: "stopped" })))),
  });

  async function useTool(prompt: string) {
    const asked: string[] = [];
    const session = createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }).startSession({
      cwd: process.cwd(),
      requestPermission: async (request) => (asked.push(request.tool), { decision: "allow" }),
      tools: [echo, boom, slow],
    });
    session.send(prompt); // sent before `initialize` is answered: held until then
    let report = "";
    for await (const event of session.events) {
      if (event.kind === "tool_result") report = event.output;
      if (event.kind === "turn_end") break;
    }
    await session.stop();
    return { report: JSON.parse(report), asked };
  }

  it("serves them in-process: declared and named, listed with their schemas, called with the tool call's id", async () => {
    const { report, asked } = await useTool('hosttool echo {"text":"hi"}');
    expect(report.servers).toEqual(["kratos"]);
    expect(JSON.parse(report.mcpConfig)).toEqual({ mcpServers: { kratos: { type: "sdk", name: "kratos" } } });
    expect(report.tools.map((t: { name: string }) => t.name)).toEqual(["echo", "boom", "slow"]);
    expect(report.tools[0].schema).toMatchObject({ type: "object", properties: { text: { type: "string" } }, required: ["text"] });
    expect(report.result).toEqual({ content: [{ type: "text", text: "echo: hi" }] });
    expect(calls.at(-1)).toBe("t1");
    // Not put through the permission gate: a tool that needs the owner asks in its own call.
    expect(report.permission).toBe("allow");
    expect(asked).toEqual([]);
  });

  it("answers bad input, a failing tool and an unknown one as tool errors the agent sees, never by crashing", async () => {
    const error = async (prompt: string) => (await useTool(prompt)).report.result;
    expect(await error('hosttool echo {"text":5}')).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/Invalid arguments for tool echo/) }] });
    expect(await error("hosttool boom {}")).toEqual({ isError: true, content: [{ type: "text", text: "nope" }] });
    expect(await error("hosttool nope {}")).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/Tool nope not found/) }] });
  });

  it("holds the first prompt until `initialize` is answered, so the first turn has the tools", async () => {
    process.env.FAKE_CLAUDE_INIT_DELAY_MS = "300"; // the fake answers late; the child inherits it
    try {
      const { report } = await useTool('hosttool echo {"text":"late"}');
      expect(report.promptBeforeInit).toBe(false);
      expect(report.result).toEqual({ content: [{ type: "text", text: "echo: late" }] });
    } finally {
      delete process.env.FAKE_CLAUDE_INIT_DELAY_MS;
    }
  });

  it("a call the CLI withdraws is cancelled: the tool's signal aborts, and no answer is sent", async () => {
    const { report } = await useTool("hosttool-withdraw slow");
    expect(withdrawn).toEqual(["slow"]);
    expect(report.responsesAfterCancel).toBe(0);
  });

  it("declares nothing without tools", async () => {
    const events = await runTurn("args", async () => ({ decision: "allow" }));
    const args = events.flatMap((e) => (e.kind === "tool_result" ? [e.output] : []))[0]!;
    expect(JSON.parse(args)).not.toContain("--mcp-config");
  });
});
