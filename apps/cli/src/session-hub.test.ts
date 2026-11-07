import { describe, expect, it, vi } from "vitest";
import type {
  AgentAdapter,
  AgentEvent,
  AgentModel,
  AgentPermissionMode,
  AgentSession,
  Harness,
  PermissionRequest,
  ServerMessage,
  SessionSummary,
} from "@kratos/core";
import { memoryLogger } from "./logger.js";
import { SessionHub } from "./session-hub.js";
import { SessionStore } from "./store/store.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0)); // let event pumps run
const WRITE: PermissionRequest = { tool: "Write", input: { file_path: "a.txt" } };

/** In-memory agent session the test drives by hand: emit events, raise asks, end it. */
class FakeSession implements AgentSession {
  readonly prompts: string[] = [];
  interrupts = 0;
  stopped = false;
  private stream!: ReadableStreamDefaultController<AgentEvent>;
  readonly events = new ReadableStream<AgentEvent>({ start: (c) => void (this.stream = c) });

  constructor(readonly options: Parameters<AgentAdapter["startSession"]>[0]) {}
  send(prompt: string) {
    this.prompts.push(prompt);
  }
  async interrupt() {
    this.interrupts++;
  }
  readonly modelSwitches: (string | null)[] = [];
  async setModel(model: string | null) {
    this.modelSwitches.push(model);
  }
  readonly effortSwitches: string[] = [];
  /** What the agent says it really uses; tests change it to mimic e.g. clamping on a model switch. */
  applied: string | null | undefined; // undefined = the start level, else the agent's default "high"
  async setEffort(effort: string) {
    if (effort === "turbo") throw new Error('no effort level "turbo"');
    this.effortSwitches.push(effort);
    this.applied = effort;
  }
  async effort() {
    return this.applied !== undefined ? this.applied : (this.options.effort ?? "high");
  }
  readonly modeSwitches: string[] = [];
  async setPermissionMode(mode: string) {
    this.modeSwitches.push(mode);
    return mode;
  }
  async stop() {
    this.stopped = true;
    this.stream.close();
  }
  emit(event: AgentEvent) {
    this.stream.enqueue(event);
  }
  /** Ask permission the way an adapter would; `withdraw` simulates the CLI cancelling it. */
  ask(request: PermissionRequest) {
    const abort = new AbortController();
    return { decision: this.options.requestPermission(request, { signal: abort.signal }), withdraw: () => abort.abort() };
  }
  get id() {
    return this.options.conversation!.id;
  }
}

const MODES: AgentPermissionMode[] = [
  { id: "default", label: "Ask", shortLabel: "Ask", kind: "ask", description: "asks", isDefault: true },
  { id: "acceptEdits", label: "Accept edits", shortLabel: "Edits", kind: "edits", description: "edits freely" },
  { id: "bypassPermissions", label: "Bypass", shortLabel: "Bypass", kind: "bypass", description: "no checks", dangerous: true },
];

const MODELS: AgentModel[] = [
  { id: "default", label: "Default", description: "recommended", group: "latest" },
  { id: "haiku", label: "Haiku", description: "fast", group: "latest" },
  { id: "claude-opus-4-8", label: "Opus 4.8", description: "older", group: "other" },
];

function setup() {
  const agents: FakeSession[] = [];
  const adapter: AgentAdapter = {
    id: "fake",
    displayName: "Fake",
    listModels: async () => MODELS,
    permissionModes: MODES,
    startSession: (options) => {
      const agent = new FakeSession(options);
      agents.push(agent);
      return agent;
    },
  };
  const store = SessionStore.open(":memory:");
  let hub = new SessionHub(adapter, "/projects/demo", store);

  /** A browser tab on the current hub. Like the real UI: its log clears when it switches session. */
  const tab = () => {
    const state = { seen: [] as ServerMessage[], sessionIds: [] as string[], list: [] as SessionSummary[], harnesses: [] as Harness[] };
    const handle = hub.connect((m) => {
      if (m.type === "session") {
        state.sessionIds.push(m.id);
        state.seen = [];
      } else if (m.type === "sessions") state.list = m.list;
      else if (m.type === "harnesses") state.harnesses = m.list;
      else state.seen.push(m);
    });
    return {
      ...handle,
      get seen() {
        return state.seen;
      },
      get list() {
        return state.list;
      },
      get harnesses() {
        return state.harnesses;
      },
      /** The session this tab views now. */
      get viewing() {
        return state.sessionIds.at(-1)!;
      },
      lastAskId: () => state.seen.findLast((m): m is Extract<ServerMessage, { type: "permission_request" }> => m.type === "permission_request")!.id,
    };
  };
  /** Simulate a kratos restart: a new hub over the same database; old agent processes are gone. */
  const restart = () => (hub = new SessionHub(adapter, "/projects/demo", store));
  return {
    agents,
    tab,
    restart,
    get hub() {
      return hub;
    },
  };
}

const status = (list: SessionSummary[], id: string) => list.find((s) => s.id === id)?.status;

describe("SessionHub: one session", () => {
  it("starts the agent on the first prompt and streams to every tab viewing the session", async () => {
    const { agents, tab } = setup();
    const a = tab();
    const b = tab();
    expect(a.viewing).toBe(b.viewing); // new tabs open the most recent session
    expect(agents).toHaveLength(0);

    a.receive({ type: "prompt", text: "hi" });
    agents[0]!.emit({ kind: "text", text: "hello" });
    await tick();

    expect(agents[0]!.options).toMatchObject({ cwd: "/projects/demo", conversation: { id: a.viewing, resume: false } });
    const expected = [
      { type: "user_prompt", text: "hi" },
      { type: "agent_event", event: { kind: "text", text: "hello" } },
    ];
    expect(a.seen).toEqual(expected);
    expect(b.seen).toEqual(expected);

    a.receive({ type: "prompt", text: "again" }); // same conversation, same agent
    expect(agents).toHaveLength(1);
    expect(agents[0]!.prompts).toEqual(["hi", "again"]);
  });

  it("replays the log to a late tab, incl. an ask that waited while no tab was open", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "edit a.txt" });
    const { decision } = agents[0]!.ask(WRITE);
    a.disconnect();

    const late = tab();
    expect(late.seen.map((m) => m.type)).toEqual(["user_prompt", "permission_request"]);
    late.receive({ type: "permission_decision", id: late.lastAskId(), decision: { decision: "allow" } });
    await expect(decision).resolves.toEqual({ decision: "allow" });
  });

  it("first decision wins, everyone sees one resolution, stale and unknown answers are ignored", async () => {
    const { agents, tab } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "prompt", text: "edit" });
    const { decision } = agents[0]!.ask(WRITE);
    const id = a.lastAskId();

    a.receive({ type: "permission_decision", id, decision: { decision: "deny", message: "not there" } });
    b.receive({ type: "permission_decision", id, decision: { decision: "allow" } });
    b.receive({ type: "permission_decision", id: "no-such-ask", decision: { decision: "allow" } });

    await expect(decision).resolves.toEqual({ decision: "deny", message: "not there" });
    for (const t of [a, b]) {
      expect(t.seen.filter((m) => m.type === "permission_resolved")).toEqual([{ type: "permission_resolved", id, outcome: "denied" }]);
    }
  });

  it("marks an ask withdrawn by the agent as cancelled and ignores answers to it", () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "edit" });
    const { withdraw } = agents[0]!.ask(WRITE);
    const id = a.lastAskId();
    withdraw();
    a.receive({ type: "permission_decision", id, decision: { decision: "allow" } });
    expect(a.seen.filter((m) => m.type === "permission_resolved")).toEqual([{ type: "permission_resolved", id, outcome: "cancelled" }]);
  });

  it("forwards interrupts, and resumes the same conversation after the agent ended", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "interrupt" }); // nothing running yet: ignored
    a.receive({ type: "prompt", text: "one" });
    a.receive({ type: "interrupt" });
    expect(agents[0]!.interrupts).toBe(1);

    await agents[0]!.stop(); // e.g. the CLI crashed
    await tick();
    a.receive({ type: "prompt", text: "two" });
    expect(agents[1]!.options.conversation).toEqual({ id: a.viewing, resume: true });
  });

  it("reports a failing interrupt instead of crashing the server", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "one" });
    agents[0]!.interrupt = async () => {
      throw new Error("process stuck");
    };
    a.receive({ type: "interrupt" });
    await tick();
    expect(a.seen).toContainEqual({ type: "error", message: "Interrupt failed: Error: process stuck" });
  });
});

describe("SessionHub: sessions side by side (D41)", () => {
  it("a new session from Home leaves the running one untouched and keeps their logs apart", async () => {
    const { agents, tab } = setup();
    const a = tab();
    const watcher = tab(); // stays on the first session
    a.receive({ type: "prompt", text: "first task" });
    const first = agents[0]!;
    const { decision } = first.ask(WRITE);
    const firstAsk = a.lastAskId();
    const firstId = a.viewing;

    a.receive({ type: "prompt", text: "second task", newSession: true });
    expect(a.viewing).not.toBe(firstId); // only this tab moved…
    expect(watcher.viewing).toBe(firstId); // …the other keeps watching its session
    expect(first.stopped).toBe(false); // the first agent keeps running
    expect(agents[1]!.options.conversation).toEqual({ id: a.viewing, resume: false });
    expect(a.seen).toEqual([{ type: "user_prompt", text: "second task" }]);

    first.emit({ kind: "text", text: "still working on the first task" });
    await tick();
    expect(watcher.seen).toContainEqual({ type: "agent_event", event: { kind: "text", text: "still working on the first task" } });
    expect(a.seen).toEqual([{ type: "user_prompt", text: "second task" }]); // nothing leaked across

    // The first session's ask is still open and can be answered from any tab.
    a.receive({ type: "permission_decision", id: firstAsk, decision: { decision: "allow" } });
    await expect(decision).resolves.toEqual({ decision: "allow" });
  });

  it("opens any session of the project in a tab, replaying its log; rejects unknown ids", () => {
    const { tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first task" });
    const firstId = a.viewing;
    a.receive({ type: "prompt", text: "second task", newSession: true });

    a.receive({ type: "open_session", id: firstId });
    expect(a.viewing).toBe(firstId);
    expect(a.seen).toEqual([{ type: "user_prompt", text: "first task" }]);

    a.receive({ type: "open_session", id: "nope" });
    expect(a.viewing).toBe(firstId);
    expect(a.seen.at(-1)).toMatchObject({ type: "error" });
  });

  it("marks any session done by id, for every tab, without reordering; a new prompt reopens it (3d2)", () => {
    const { tab } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "prompt", text: "first task" });
    const firstId = a.viewing;
    a.receive({ type: "prompt", text: "second task", newSession: true }); // a now views the second
    const order = a.list.map((s) => s.id);

    b.receive({ type: "set_done", id: firstId, done: true }); // from a tab not viewing it
    for (const t of [a, b]) expect(t.list.find((s) => s.id === firstId)?.done).toBe(true);
    expect(a.list.map((s) => s.id)).toEqual(order); // housekeeping: Recent order unchanged

    b.receive({ type: "open_session", id: firstId });
    b.receive({ type: "prompt", text: "one more thing" }); // new work: not done any more
    expect(a.list.find((s) => s.id === firstId)?.done).toBe(false);

    b.receive({ type: "set_done", id: "nope", done: true });
    expect(b.seen.at(-1)).toMatchObject({ type: "error" });
  });

  it("keeps every tab's session list current: titles, newest first, live status", async () => {
    const { agents, tab } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "prompt", text: "first task" });
    const firstId = a.viewing;
    expect(status(b.list, firstId)).toBe("working");

    agents[0]!.ask(WRITE);
    expect(status(b.list, firstId)).toBe("needs_approval");
    a.receive({ type: "permission_decision", id: a.lastAskId(), decision: { decision: "allow" } });
    expect(status(b.list, firstId)).toBe("working");
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    expect(status(b.list, firstId)).toBe("idle");

    a.receive({ type: "prompt", text: "second task", newSession: true });
    expect(b.list.map((s) => s.title)).toEqual(["second task", "first task"]);
  });

  it("uses the viewed session when it has no prompts yet, instead of creating another", () => {
    const { agents, tab } = setup();
    const a = tab();
    const id = a.viewing;
    a.receive({ type: "prompt", text: "hello", newSession: true });
    expect(a.viewing).toBe(id);
    expect(agents[0]!.id).toBe(id);
  });

  it("close() withdraws every session's asks and stops every agent", async () => {
    const t = setup();
    const a = t.tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "prompt", text: "second", newSession: true });
    const asks = t.agents.map((agent) => agent.ask(WRITE).decision);

    await t.hub.close();
    for (const decision of asks) await expect(decision).resolves.toMatchObject({ decision: "deny" });
    expect(t.agents.map((agent) => agent.stopped)).toEqual([true, true]);
  });
});

describe("SessionHub across restarts (D36, D41)", () => {
  it("restores the session list and the latest session; the agent resumes its conversation", async () => {
    const { agents, tab, restart } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first task" });
    a.receive({ type: "prompt", text: "second task", newSession: true });
    agents[1]!.emit({ kind: "text", text: "ok" });
    await tick();
    const secondId = a.viewing;

    restart();
    const late = tab();
    expect(late.viewing).toBe(secondId);
    expect(late.seen).toEqual([
      { type: "user_prompt", text: "second task" },
      { type: "agent_event", event: { kind: "text", text: "ok" } },
    ]);
    expect(late.list.map((s) => [s.title, s.status])).toEqual([
      ["second task", "idle"],
      ["first task", "idle"],
    ]);
    late.receive({ type: "prompt", text: "what was it?" });
    expect(agents.at(-1)!.options.conversation).toEqual({ id: secondId, resume: true });
  });

  it("cancels asks a previous run left open, once, and ignores answers to them", () => {
    const { agents, tab, restart } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "edit" });
    agents[0]!.ask(WRITE);

    restart();
    const late = tab();
    const id = late.lastAskId();
    expect(late.seen.at(-1)).toEqual({ type: "permission_resolved", id, outcome: "cancelled" });
    late.receive({ type: "permission_decision", id, decision: { decision: "allow" } });
    expect(late.seen.filter((m) => m.type === "permission_resolved")).toHaveLength(1);

    restart();
    expect(tab().seen.filter((m) => m.type === "permission_resolved")).toHaveLength(1);
  });

  describe("cleanup doesn't count as activity (Recent order)", () => {
    /** Session A waits on an ask, session B is newer. Clock ticks between steps. */
    function twoSessions() {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const later = () => vi.setSystemTime(Date.now() + 1000);
      const t = setup();
      const a = t.tab();
      a.receive({ type: "prompt", text: "session A" });
      t.agents[0]!.ask(WRITE);
      const aId = a.viewing;
      later();
      a.receive({ type: "prompt", text: "session B", newSession: true });
      later();
      return { ...t, aId, bId: a.viewing, later };
    }

    it("after shutdown withdrew A's ask, B is still the latest", async () => {
      try {
        const t = twoSessions();
        await t.hub.close(); // withdraws A's ask
        t.later();
        t.restart();
        const late = t.tab();
        expect(late.viewing).toBe(t.bId);
        expect(late.list.map((s) => s.title)).toEqual(["session B", "session A"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancelling A's stale ask when it's reopened after a restart doesn't move it up", () => {
      try {
        const t = twoSessions();
        t.restart(); // no clean shutdown: A's ask is still open in the log
        const late = t.tab();
        late.receive({ type: "open_session", id: t.aId }); // loading A cancels the stale ask
        expect(late.seen.at(-1)).toMatchObject({ type: "permission_resolved", outcome: "cancelled" });
        expect(late.list.map((s) => s.title)).toEqual(["session B", "session A"]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("SessionHub: harness & model (D43)", () => {
  it("tells every tab the harness and its models, also tabs that connect later", async () => {
    const { tab } = setup();
    const early = tab(); // connected before the models are known
    await tick();
    expect(early.harnesses).toEqual([{ id: "fake", name: "Fake", models: MODELS, permissionModes: MODES }]);
    expect(tab().harnesses).toEqual([{ id: "fake", name: "Fake", models: MODELS, permissionModes: MODES }]);
  });

  it("starts a session with the model picked on Home and shows it in the list", () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first", newSession: true, harness: "fake", model: "haiku" });
    expect(agents[0]!.options.model).toBe("haiku");
    expect(a.list.find((s) => s.id === a.viewing)).toMatchObject({ harness: "fake", model: "haiku" });

    a.receive({ type: "prompt", text: "later prompt", model: "claude-opus-4-8" }); // not a session start
    expect(a.list.find((s) => s.id === a.viewing)?.model).toBe("haiku");
  });

  it("switches a running session's model live, and keeps it when the agent resumes", async () => {
    const { agents, tab, restart } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first", model: "haiku" });
    a.receive({ type: "set_model", model: "claude-opus-4-8" });
    expect(agents[0]!.modelSwitches).toEqual(["claude-opus-4-8"]);
    expect(a.list.find((s) => s.id === a.viewing)?.model).toBe("claude-opus-4-8");

    restart();
    const late = tab();
    late.receive({ type: "prompt", text: "after restart" });
    expect(agents.at(-1)!.options).toMatchObject({ model: "claude-opus-4-8", conversation: { resume: true } });

    // Back to the agent's default: null all the way through (3c4) — the next start passes no model.
    late.receive({ type: "set_model", model: null });
    expect(agents.at(-1)!.modelSwitches).toEqual([null]);
    expect(late.list.find((s) => s.id === late.viewing)?.model).toBeNull();
    restart();
    tab().receive({ type: "prompt", text: "after second restart" });
    expect(agents.at(-1)!.options.model).toBeUndefined();
  });

  it("rejects a harness it doesn't run, without starting anything", () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "hi", harness: "codex" });
    expect(agents).toHaveLength(0);
    expect(a.seen.at(-1)).toMatchObject({ type: "error", message: "Unknown harness codex" });
  });

  it("still lists the harness (no models) when the agent can't report its models", async () => {
    const store = SessionStore.open(":memory:");
    const failing: AgentAdapter = {
      id: "fake",
      displayName: "Fake",
      listModels: async () => {
        throw new Error("claude not logged in");
      },
      permissionModes: [],
      startSession: () => {
        throw new Error("unused");
      },
    };
    const { log, lines } = memoryLogger();
    const hub = new SessionHub(failing, "/projects/demo", store, log);
    await tick();
    const got: ServerMessage[] = [];
    hub.connect((m) => got.push(m));
    expect(got.find((m) => m.type === "harnesses")).toEqual({ type: "harnesses", list: [{ id: "fake", name: "Fake", models: [], permissionModes: [] }] });
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 40, component: "hub", err: expect.objectContaining({ message: "claude not logged in" }) }),
    );
  });
});

describe("SessionHub: effort (D51)", () => {
  const listed = (t: { list: SessionSummary[]; viewing: string }) => t.list.find((s) => s.id === t.viewing)?.effort;

  it("starts with the level picked on Home, then lists the level the agent really uses", async () => {
    const { agents, tab } = setup();
    const a = tab();
    expect(listed(a)).toBeNull(); // nothing chosen, agent never ran
    a.receive({ type: "prompt", text: "first", newSession: true, effort: "low" });
    expect(agents[0]!.options.effort).toBe("low");
    await tick();
    expect(listed(a)).toBe("low");
  });

  it("lists the agent's own default when nothing was chosen", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    expect(agents[0]!.options.effort).toBeUndefined();
    await tick();
    expect(listed(a)).toBe("high");
  });

  it("switches a running session's level live, and passes it when the agent resumes", async () => {
    const { agents, tab, restart } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "set_effort", effort: "max" });
    await tick();
    expect(agents[0]!.effortSwitches).toEqual(["max"]);
    expect(listed(a)).toBe("max");

    restart();
    const late = tab();
    expect(listed(late)).toBe("max"); // from the store, before any agent runs
    late.receive({ type: "prompt", text: "after restart" });
    expect(agents.at(-1)!.options).toMatchObject({ effort: "max", conversation: { resume: true } });
  });

  it("keeps the old level when the agent refuses one, and says why", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first", effort: "low" });
    a.receive({ type: "set_effort", effort: "turbo" });
    await tick();
    expect(agents[0]!.effortSwitches).toEqual([]);
    expect(listed(a)).toBe("low");
    expect(a.seen.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining('Switching effort failed: Error: no effort level "turbo"') });
  });

  it("asks again after a model switch: the level in use may change with the model", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first", effort: "xhigh" });
    await tick();
    expect(listed(a)).toBe("xhigh");
    agents[0]!.applied = "high"; // the new model has no xhigh: the agent clamps it
    a.receive({ type: "set_model", model: "claude-opus-4-8" });
    await tick();
    expect(listed(a)).toBe("high");
  });

  it("stores a level chosen while no agent runs, for its next start", () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "set_effort", effort: "medium" });
    expect(listed(a)).toBe("medium");
    a.receive({ type: "prompt", text: "first" });
    expect(agents[0]!.options.effort).toBe("medium");
  });
});

describe("SessionHub: permission modes (D53)", () => {
  const listed = (t: { list: SessionSummary[]; viewing: string }) => t.list.find((s) => s.id === t.viewing)?.permissionMode;

  it("tells tabs the harness's modes, and starts a session in the mode picked on Home", async () => {
    const { agents, tab } = setup();
    const a = tab();
    await tick();
    expect(a.harnesses[0]?.permissionModes).toEqual(MODES);
    expect(listed(a)).toBeNull(); // never chosen: the agent's default
    a.receive({ type: "prompt", text: "first", newSession: true, permissionMode: "acceptEdits" });
    expect(agents[0]!.options.permissionMode).toBe("acceptEdits");
    expect(listed(a)).toBe("acceptEdits");
  });

  it("switches a running session live, follows the agent's own switches, and resumes in the mode", async () => {
    const { agents, tab, restart } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "set_permission_mode", mode: "acceptEdits" });
    await tick();
    expect(agents[0]!.modeSwitches).toEqual(["acceptEdits"]);
    expect(listed(a)).toBe("acceptEdits");

    agents[0]!.emit({ kind: "permission_mode", mode: "default" }); // e.g. the agent left plan mode
    await tick();
    expect(listed(a)).toBe("default");

    restart();
    const late = tab();
    late.receive({ type: "prompt", text: "after restart" });
    expect(agents.at(-1)!.options).toMatchObject({ permissionMode: "default", conversation: { resume: true } });
  });

  it("refuses Bypass without explicit consent — live or from Home — and allows it with consent", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first", newSession: true, permissionMode: "bypassPermissions" });
    expect(agents).toHaveLength(0); // nothing started in some other mode instead
    expect(a.seen.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("needs your explicit consent") });

    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "set_permission_mode", mode: "bypassPermissions" });
    await tick();
    expect(agents[0]!.modeSwitches).toEqual([]);
    expect(a.seen.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("needs your explicit consent") });

    a.receive({ type: "set_permission_mode", mode: "bypassPermissions", confirmDangerous: true });
    await tick();
    expect(agents[0]!.modeSwitches).toEqual(["bypassPermissions"]);
    expect(listed(a)).toBe("bypassPermissions");
  });

  it("refuses a mode the harness doesn't have", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "set_permission_mode", mode: "turbo" });
    await tick();
    expect(agents[0]!.modeSwitches).toEqual([]);
    expect(a.seen.at(-1)).toMatchObject({ type: "error", message: 'Fake has no permission mode "turbo"' });
  });
});
