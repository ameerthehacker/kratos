import { describe, expect, it } from "vitest";
import type { AgentEvent, ServerMessage } from "@kratos/core";
import { buildTimeline, currentActivity, openAsks, openQuestions, openQueue } from "./timeline";

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

  it("a command's result: the test count (vitest's last line, not its file count), else nothing (3x1)", () => {
    const run = (id: string, output: string) => [
      agent({ kind: "tool_call", id, tool: "Bash", input: {}, action: { type: "run", command: "pnpm test" } }),
      agent({ kind: "tool_result", id, output, isError: false }),
    ];
    const [, group] = buildTimeline(
      [
        { type: "user_prompt", text: "go" },
        ...run("v", " Test Files  4 passed (4)\n      Tests  2 skipped | 18 passed (20)"),
        ...run("j", "Test Suites: 4 passed, 4 total\nTests:       18 passed, 18 total\nSnapshots:   3 passed, 3 total"),
        ...run("p", "18 passed in 0.52s"),
        ...run("l", "ok"),
      ],
      "/repo",
    );
    if (group?.type !== "steps") throw new Error("expected steps");
    expect(group.steps.map((s) => s.chips.map((c) => c.text))).toEqual([["✓ 18 passed"], ["✓ 18 passed"], ["✓ 18 passed"], []]);
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

  it("a step of Kratos's own tools reads in words, and so does its ask (4m3)", () => {
    const description = "Create the feature “Reports” and move this session into it";
    const items = buildTimeline([
      agent({ kind: "tool_call", id: "k1", tool: "mcp__kratos__file_session", input: {}, action: { type: "other", description } }),
      { type: "permission_request", id: "ask-k1", request: { tool: "file_session", input: {}, toolCallId: "k1", reason: "It's the CSV work" } },
    ]);
    const [step] = openAsks(items);
    expect(step).toMatchObject({ intent: description, title: description, ask: { id: "ask-k1", reason: "It's the CSV work" } });
  });
});

describe("buildTimeline: images a tool returned (3z)", () => {
  it("puts them on the step that returned them", () => {
    const shot = { id: "img1", name: "image.png", kind: "image" as const, mediaType: "image/png", size: 6 };
    const items = buildTimeline(
      [
        agent({ kind: "tool_call", id: "r", tool: "Read", input: {}, action: { type: "read", target: "/repo/shot.png" } }),
        agent({ kind: "tool_result", id: "r", output: "[image]", isError: false, attachments: [shot] }),
        agent({ kind: "tool_call", id: "s", tool: "Read", input: {}, action: { type: "read", target: "/repo/a.ts" } }),
        agent({ kind: "tool_result", id: "s", output: "code", isError: false }),
      ],
      "/repo",
    );
    const steps = items[0]?.type === "steps" ? items[0].steps : [];
    expect(steps.map((step) => step.images)).toEqual([[shot], undefined]);
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

describe("buildTimeline: agent questions (D54, 3r2)", () => {
  const request = {
    toolCallId: "t1",
    questions: [
      { header: "Placement", question: "Where?", multiSelect: false, options: [{ label: "Above" }, { label: "Below" }] },
      { header: "Mention", question: "Which?", multiSelect: true, options: [{ label: "Hub" }, { label: "Strings" }] },
    ],
  };
  const asked = [
    { type: "user_prompt", text: "go" },
    agent({ kind: "tool_call", id: "t1", tool: "AskUserQuestion", input: {} }),
    { type: "question_request", id: "q1", request },
  ] as const;
  const step = (items: ReturnType<typeof buildTimeline>) => {
    const group = items.find((i) => i.type === "steps");
    if (group?.type !== "steps") throw new Error("no steps");
    return group.steps[0]!;
  };

  it("turns the agent's tool call into a waiting question step, open for the card", () => {
    const items = buildTimeline([...asked], "", "Claude Code");
    expect(step(items)).toMatchObject({ kind: "question", title: "Asking 2 questions", question: { id: "q1" } });
    expect(openQuestions(items)).toEqual([{ id: "q1", request }]);
    expect(currentActivity(items)).toBeNull(); // the indicator pauses: it waits for you
  });

  it("shows the outcome as chips: answers (own text quoted), a skip, or not answered", () => {
    const answered = buildTimeline(
      [...asked, { type: "question_resolved", id: "q1", outcome: "answered", answers: [{ selected: ["Above"] }, { selected: ["Hub", "Strings"], other: "Docs" }] }],
      "",
      "Claude Code",
    );
    expect(step(answered)).toMatchObject({ title: "Asked 2 questions", question: { outcome: "answered" } });
    expect(step(answered).chips).toEqual([
      { label: "Placement", text: "Above", tone: "plain" },
      { label: "Mention", text: "Hub, Strings, “Docs”", tone: "plain" },
    ]);
    expect(openQuestions(answered)).toEqual([]);

    const skipped = buildTimeline(
      [...asked, { type: "question_resolved", id: "q1", outcome: "skipped" }, agent({ kind: "tool_result", id: "t1", output: "skipped", isError: true })],
      "",
      "Claude Code",
    ); // the skip comes back as an error result: no "Failed" chip
    expect(step(skipped).chips).toEqual([{ text: "You skipped · Claude Code decides", tone: "note" }]);
    const cancelled = buildTimeline([...asked, { type: "question_resolved", id: "q1", outcome: "cancelled" }], "", "Claude Code");
    expect(step(cancelled).chips).toEqual([{ text: "Not answered", tone: "note" }]);
  });
});

describe("buildTimeline: steering prompts (D56)", () => {
  it("a queued prompt joins the chat where the agent read it; a removed one never does", () => {
    const items = buildTimeline([
      { type: "user_prompt", text: "first" },
      { type: "prompt_queued", id: "q1", text: "also this" },
      { type: "prompt_queued", id: "q2", text: "never mind" },
      agent({ kind: "text", text: "working on it" }),
      { type: "prompt_read", id: "q1", how: "step" },
      { type: "prompt_removed", id: "q2", reason: "removed" },
      agent({ kind: "text", text: "done, with that too" }),
    ]);
    expect(items).toEqual([
      { type: "prompt", text: "first" },
      { type: "reply", text: "working on it" },
      { type: "prompt", text: "also this", read: { how: "step" } },
      { type: "reply", text: "done, with that too" },
    ]);
  });

  it("marks where each was read; a step Send now cut short reads as stopped; the queue lists the rest", () => {
    const run = (id: string, command: string) => agent({ kind: "tool_call", id, tool: "Bash", input: {}, action: { type: "run", command, description: undefined } });
    const log = [
      { type: "user_prompt", text: "first" },
      run("t1", "pnpm test"),
      agent({ kind: "tool_result", id: "t1", output: "ok", isError: false }),
      { type: "prompt_queued", id: "q1", text: "after tests" },
      { type: "prompt_queued", id: "q2", text: "urgent" },
      { type: "prompt_queued", id: "q3", text: "later" },
      { type: "prompt_read", id: "q1", how: "step", after: "t1" },
      run("t2", "pnpm test"),
      agent({ kind: "tool_result", id: "t2", output: "The user doesn't want to proceed", isError: true }),
      agent({ kind: "turn_end", reason: "interrupted" }),
      { type: "prompt_read", id: "q2", how: "now", stopped: "t2" },
    ] as const;
    const items = buildTimeline([...log]);
    const prompts = items.filter((i) => i.type === "prompt");
    expect(prompts.map((p) => p.type === "prompt" && p.read)).toEqual([
      undefined,
      { how: "step", after: "Ran the tests" },
      { how: "now", stopped: "running the tests" },
    ]);
    const stoppedStep = items.flatMap((i) => (i.type === "steps" ? i.steps : [])).find((s) => s.id === "t2");
    expect(stoppedStep).toMatchObject({ title: "Stopped running the tests", stopped: true, chips: [] });
    expect(openQueue([...log]).map((q) => q.text)).toEqual(["later"]);
    expect(items.some((i) => i.type === "event" && i.text === "Stopped")).toBe(false); // the step says it
  });
});

describe("buildTimeline: plan updates (4p3a)", () => {
  it("shows a turn's change to a plan as an edit step: its diff, its counts, what was put back", () => {
    const [prompt, group] = buildTimeline([
      { type: "user_prompt", text: "tick P1" },
      {
        type: "plan_updated",
        owner: { kind: "feature", id: "f" },
        path: ".kratos/features/reports/plan.md",
        before: "# R\n- [ ] **P1. A**\n",
        after: "# R\n- [?] **P1. A**\n  Proof: ran it\n",
        undone: ["P1: only you tick a step; marked [?] for you to check."],
        intentChanged: true,
      },
    ]);
    expect(prompt).toMatchObject({ type: "prompt" });
    expect(group).toMatchObject({ type: "steps", by: "kratos" }); // headed "Kratos", not the agent (4p3b)
    const step = group!.type === "steps" ? group!.steps[0]! : undefined;
    expect(step).toMatchObject({
      kind: "edit",
      title: "Updated the plan",
      chips: [
        { text: "+2 −1", tone: "muted" },
        { text: "1 put back", tone: "wait" },
        { text: "Intent changed", tone: "wait" },
      ],
      edit: { path: ".kratos/features/reports/plan.md", changes: [{ before: "# R\n- [ ] **P1. A**\n", after: "# R\n- [?] **P1. A**\n  Proof: ran it\n" }] },
      raw: { output: "Put back by Kratos:\nP1: only you tick a step; marked [?] for you to check." },
    });
    const [, written] = buildTimeline([
      { type: "user_prompt", text: "plan" },
      { type: "plan_updated", owner: { kind: "session", id: "s" }, path: "p", before: null, after: "# S\n", undone: [], intentChanged: false },
    ]);
    expect(written!.type === "steps" && written!.steps[0]!.title).toBe("Wrote the session plan");

    // Between the agent's steps: a group of its own, the agent's next steps another.
    const read = (id: string) => ({ type: "agent_event" as const, event: { kind: "tool_call" as const, id, tool: "Read", input: { file_path: "a" }, action: { type: "read" as const, path: "a" } } });
    const items = buildTimeline([
      { type: "user_prompt", text: "go" },
      read("r1"),
      { type: "plan_updated", owner: { kind: "session", id: "s" }, path: "p", before: "a\n", after: "b\n", undone: [], intentChanged: false },
      read("r2"),
    ]);
    expect(items.map((i) => (i.type === "steps" ? `${i.by ?? "agent"}:${i.steps.length}` : i.type))).toEqual(["prompt", "agent:1", "kratos:1", "agent:1"]);
  });
});

describe("buildTimeline: a proposed plan (4p6a)", () => {
  it("is a plan step carrying the plan, its ask the review card's", () => {
    const plan = "# Sketchpad\n\n## Steps\n- [ ] **P1. Draw**\n";
    const items = buildTimeline([
      { type: "user_prompt", text: "plan it" },
      { type: "agent_event", event: { kind: "tool_call", id: "p1", tool: "ExitPlanMode", input: { plan }, action: { type: "plan", plan } } },
      { type: "permission_request", id: "ask1", request: { tool: "ExitPlanMode", input: { plan }, toolCallId: "p1", action: { type: "plan", plan } } },
    ]);
    const [step] = items[1]!.type === "steps" ? items[1]!.steps : [];
    expect(step).toMatchObject({ kind: "plan", title: "Proposed a plan", intent: "Get your OK on its plan", plan, ask: { id: "ask1" } });
    expect(openAsks(items)[0]?.plan).toBe(plan);
  });
});

describe("buildTimeline: the agent plans first by itself (4p6c)", () => {
  const call = (id: string, tool: string, type: "plan_mode" | "read") => ({ type: "agent_event" as const, event: { kind: "tool_call" as const, id, tool, input: {}, action: { type } } });
  it("is a line of its own, not a step, with its reason just before it and the mode it left", () => {
    const items = buildTimeline([
      { type: "user_prompt", text: "turn math.js into a library" },
      { type: "agent_event", event: { kind: "permission_mode", mode: "acceptEdits" } },
      call("r1", "Read", "read"),
      { type: "agent_event", event: { kind: "text", text: "This touches many files, so I'll plan first." } },
      call("p1", "EnterPlanMode", "plan_mode"),
      { type: "agent_event", event: { kind: "permission_mode", mode: "plan" } },
      { type: "agent_event", event: { kind: "tool_result", id: "p1", output: "Entered plan mode.", isError: false } },
      call("r2", "Read", "read"),
    ]);
    expect(items.map((i) => i.type)).toEqual(["prompt", "steps", "plan_switch", "steps"]); // the reason moved into the line
    expect(items[2]).toEqual({ type: "plan_switch", id: "p1", reason: "This touches many files, so I'll plan first.", before: "acceptEdits", open: true });
  });

  it("is over once plan mode ends, or a later switch comes: plan mode you pick yourself later isn't its", () => {
    const log = [
      { type: "user_prompt" as const, text: "go" },
      call("p1", "EnterPlanMode", "plan_mode"),
      { type: "agent_event" as const, event: { kind: "permission_mode" as const, mode: "plan" } },
    ];
    expect(buildTimeline(log)[1]).toMatchObject({ open: true });
    const left = [...log, { type: "agent_event" as const, event: { kind: "permission_mode" as const, mode: "default" } }];
    expect(buildTimeline(left)[1]).toMatchObject({ open: false });
    const yours = [...left, { type: "agent_event" as const, event: { kind: "permission_mode" as const, mode: "plan" } }];
    expect(buildTimeline(yours)[1]).toMatchObject({ open: false });
    const again = buildTimeline([...left, call("p2", "EnterPlanMode", "plan_mode")]);
    expect(again.filter((i) => i.type === "plan_switch").map((i) => i.type === "plan_switch" && i.open)).toEqual([false, true]);
  });

  it("with nothing said first: no reason; no mode in the log: null", () => {
    const [, line] = buildTimeline([{ type: "user_prompt", text: "go" }, call("p1", "EnterPlanMode", "plan_mode")]);
    expect(line).toEqual({ type: "plan_switch", id: "p1", before: null, open: true });
  });
});

describe("buildTimeline: scope drift (4p7a)", () => {
  it("is a notice of its own under the turn", () => {
    const items = buildTimeline([
      { type: "user_prompt", text: "do P1" },
      { type: "agent_event", event: { kind: "tool_call", id: "w", tool: "Write", input: {}, action: { type: "edit", target: "package.json" } } },
      { type: "agent_event", event: { kind: "turn_end", reason: "completed" } },
      { type: "scope_drift", owner: { kind: "feature", id: "f" }, stepId: "P1", paths: ["package.json"] },
    ]);
    expect(items.map((i) => i.type)).toEqual(["prompt", "steps", "scope_drift"]);
    expect(items.at(-1)).toEqual({ type: "scope_drift", owner: { kind: "feature", id: "f" }, stepId: "P1", paths: ["package.json"] });
  });

  it("logged once the next turn started, it still goes under its own turn, in order, and the new turn's group goes on", () => {
    const write = (id: string, target: string) => ({ type: "agent_event" as const, event: { kind: "tool_call" as const, id, tool: "Write", input: {}, action: { type: "edit" as const, target } } });
    const items = buildTimeline([
      { type: "user_prompt", text: "one" },
      write("w1", "a.ts"),
      { type: "agent_event", event: { kind: "turn_end", reason: "completed" } },
      { type: "user_prompt", text: "two" }, // a queued prompt: its turn started at once
      write("w2", "b.ts"),
      { type: "scope_drift", owner: { kind: "feature", id: "f" }, stepId: "P1", paths: ["a.ts"], turn: 1 },
      { type: "plan_updated", owner: { kind: "feature", id: "f" }, path: ".kratos/features/f/plan.md", before: "# F\n", after: "# F\n\nmore\n", undone: [], intentChanged: false, turn: 1 },
      write("w3", "c.ts"),
    ]);
    expect(items.map((i) => i.type)).toEqual(["prompt", "steps", "scope_drift", "steps", "prompt", "steps"]);
    expect(items[3]).toMatchObject({ by: "kratos" });
    expect(items[5]).toMatchObject({ steps: [{ id: "w2" }, { id: "w3" }] });
  });
});
