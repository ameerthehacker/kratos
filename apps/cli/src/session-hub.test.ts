import { describe, expect, it, vi } from "vitest";
import type {
  AgentAdapter,
  AgentAttachment,
  AgentEvent,
  AgentModel,
  AgentPermissionMode,
  AttachmentPolicy,
  AgentSession,
  Harness,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  FeatureSummary,
  ServerMessage,
  SessionSummary,
} from "@kratos/core";
import type { Snapshots } from "./changes/git-snapshots.js";
import { memoryLogger } from "./logger.js";
import { SessionHub } from "./session-hub.js";
import { SessionStore } from "./store/store.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0)); // let event pumps run
const WRITE: PermissionRequest = { tool: "Write", input: { file_path: "a.txt" } };

/** In-memory agent session the test drives by hand: emit events, raise asks, end it. */
class FakeSession implements AgentSession {
  readonly prompts: string[] = [];
  readonly files: Array<readonly AgentAttachment[]> = [];
  interrupts = 0;
  stopped = false;
  private stream!: ReadableStreamDefaultController<AgentEvent>;
  readonly events = new ReadableStream<AgentEvent>({ start: (c) => void (this.stream = c) });

  constructor(readonly options: Parameters<AgentAdapter["startSession"]>[0]) {}
  readonly promptIds: (string | undefined)[] = [];
  send(prompt: string, attachments: readonly AgentAttachment[] = [], options: { id?: string } = {}) {
    this.prompts.push(prompt);
    this.files.push(attachments);
    this.promptIds.push(options.id);
  }
  readonly cancelled: string[] = [];
  async cancelPrompt(id: string) {
    this.cancelled.push(id);
    return true;
  }
  readonly sentNow: string[] = [];
  async sendNow(id: string) {
    this.sentNow.push(id);
  }
  readonly interruptOptions: Array<{ cancelQueued?: boolean } | undefined> = [];
  async interrupt(options?: { cancelQueued?: boolean }) {
    this.interrupts++;
    this.interruptOptions.push(options);
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
  /** Naming the session (3z4): each call waits here until the test answers it. */
  readonly titleCalls: Array<{ about: string; answer: (title: string) => void; fail: (err: Error) => void }> = [];
  title(about: string) {
    return new Promise<string>((answer, fail) => this.titleCalls.push({ about, answer, fail }));
  }
  async stop() {
    this.stopped = true;
    this.stream.close();
  }
  emit(event: AgentEvent) {
    this.stream.enqueue(event);
  }
  /** Ask questions the way an adapter would (D54); `withdraw` simulates the CLI cancelling them. */
  question(request: QuestionRequest) {
    const abort = new AbortController();
    return { reply: this.options.askQuestions!(request, { signal: abort.signal }), withdraw: () => abort.abort() };
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

const POLICY: AttachmentPolicy = {
  kinds: [
    { kind: "image", mediaTypes: ["image/png"], maxBytes: 100 },
    { kind: "text", mediaTypes: [], maxBytes: 100 },
  ],
  maxCount: 2,
  maxTotalBytes: 150,
};

const MODELS: AgentModel[] = [
  { id: "default", label: "Default", description: "recommended", group: "latest" },
  { id: "haiku", label: "Haiku", description: "fast", group: "latest" },
  { id: "claude-opus-4-8", label: "Opus 4.8", description: "older", group: "other" },
];

function setup(snapshots?: Snapshots) {
  const agents: FakeSession[] = [];
  const adapter: AgentAdapter = {
    id: "fake",
    displayName: "Fake",
    listModels: async () => MODELS,
    permissionModes: MODES,
    attachments: POLICY,
    startSession: (options) => {
      const agent = new FakeSession(options);
      agents.push(agent);
      return agent;
    },
  };
  const store = SessionStore.open(":memory:");
  let hub = new SessionHub(adapter, "/projects/demo", store, undefined, undefined, snapshots);

  /** A browser tab on the current hub. Like the real UI: its log clears when it switches session,
   * and `ready` says the replay is complete (`seenWhenReady`: how much of the log it had then).
   * `sessionId`: the session it connects on (3y6b). */
  const tab = (sessionId?: string) => {
    const state = {
      seen: [] as ServerMessage[],
      sessionIds: [] as string[],
      list: [] as SessionSummary[],
      features: [] as FeatureSummary[],
      harnesses: [] as Harness[],
      seenWhenReady: undefined as number | undefined,
    };
    const handle = hub.connect((m) => {
      if (m.type === "session") {
        state.sessionIds.push(m.id);
        state.seen = [];
        state.seenWhenReady = undefined;
      } else if (m.type === "session_ready") state.seenWhenReady = state.seen.length;
      else if (m.type === "sessions") state.list = m.list;
      else if (m.type === "features") state.features = m.list;
      else if (m.type === "harnesses") state.harnesses = m.list;
      else state.seen.push(m);
    }, sessionId);
    return {
      ...handle,
      get seen() {
        return state.seen;
      },
      get list() {
        return state.list;
      },
      get features() {
        return state.features;
      },
      get harnesses() {
        return state.harnesses;
      },
      get seenWhenReady() {
        return state.seenWhenReady;
      },
      /** Every session this tab was shown, in order. */
      get opened() {
        return state.sessionIds;
      },
      /** The session this tab views now. */
      get viewing() {
        return state.sessionIds.at(-1)!;
      },
      lastQuestionId: () => state.seen.findLast((m): m is Extract<ServerMessage, { type: "question_request" }> => m.type === "question_request")!.id,
      lastAskId: () => state.seen.findLast((m): m is Extract<ServerMessage, { type: "permission_request" }> => m.type === "permission_request")!.id,
    };
  };
  /** Simulate a kratos restart: a new hub over the same database; old agent processes are gone. */
  const restart = () => (hub = new SessionHub(adapter, "/projects/demo", store, undefined, undefined, snapshots));
  /** Another project's hub on the same database (its sessions aren't this project's). */
  const otherProject = () => new SessionHub(adapter, "/projects/other", store);
  return {
    agents,
    tab,
    restart,
    otherProject,
    store,
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

  it("connects a tab straight to the session it asks for, replaying only that one (3y6b)", () => {
    const { tab, otherProject } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first task" });
    const firstId = a.viewing;
    a.receive({ type: "prompt", text: "second task", newSession: true }); // now the latest

    const b = tab(firstId);
    expect(b.opened).toEqual([firstId]); // not the latest first
    expect(b.seen).toEqual([{ type: "user_prompt", text: "first task" }]);
    expect(b.seenWhenReady).toBe(1);

    // An unknown id, or another project's, gets the latest session, as with none.
    const elsewhere: ServerMessage[] = [];
    otherProject().connect((m) => elsewhere.push(m));
    const otherId = elsewhere.find((m) => m.type === "session")!.id;
    for (const id of ["nope", otherId]) expect(tab(id).viewing).toBe(a.viewing);
  });

  it("marks any session done by id, for every tab, without reordering; a new prompt reopens it (3d2)", () => {
    const { tab } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "prompt", text: "first task" });
    const firstId = a.viewing;
    a.receive({ type: "prompt", text: "second task", newSession: true }); // a now views the second
    const order = a.list.map((s) => s.id);

    b.receive({ type: "set_done", id: firstId, done: true, stop: true }); // from a tab not viewing it (still working: 4c5)
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

  it("marks a busy session done only with consent to stop it: then its agent and queue stop first (4c5)", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first task" });
    a.receive({ type: "prompt", text: "queued meanwhile" });
    const id = a.viewing;

    a.receive({ type: "set_done", id, done: true }); // no consent: refused, nothing stopped
    expect(a.seen.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/still working/) });
    expect(a.list.find((s) => s.id === id)?.done).toBe(false);
    expect(agents[0]!.interrupts).toBe(0);

    a.receive({ type: "set_done", id, done: true, stop: true });
    await tick();
    expect(agents[0]!.interrupts).toBe(1);
    expect(agents[0]!.interruptOptions[0]).toEqual({ cancelQueued: true }); // the queue goes too
    expect(a.list.find((s) => s.id === id)?.done).toBe(true);
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

describe("SessionHub: features (D73)", () => {
  const featureOf = (list: SessionSummary[], id: string) => list.find((s) => s.id === id)?.featureId;

  it("creates a feature for every tab, also tabs that connect later", () => {
    const { tab } = setup();
    const a = tab();
    const b = tab();
    expect(a.features).toEqual([]);
    a.receive({ type: "create_feature", title: "Plans" });
    for (const t of [a, b, tab()]) expect(t.features).toMatchObject([{ title: "Plans", done: false }]);
    expect(a.list.every((s) => s.featureId === null)).toBe(true); // sessions start as one-offs
  });

  it("starts a session from Home in the feature picked there", () => {
    const { tab } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "create_feature", title: "Plans" });
    const feature = a.features[0]!.id;
    a.receive({ type: "prompt", text: "first task" });
    a.receive({ type: "prompt", text: "save plans", newSession: true, featureId: feature });
    expect(featureOf(b.list, a.viewing)).toBe(feature);
    expect(featureOf(b.list, a.opened[0]!)).toBeNull();

    a.receive({ type: "prompt", text: "more", featureId: "ignored" }); // only a session's first prompt picks it
    expect(a.seen.at(-1)).not.toMatchObject({ type: "error" }); // ignored, not refused
    expect(featureOf(b.list, a.viewing)).toBe(feature);
  });

  it("starts a one-off from Home even in a reused empty session that was in a feature", () => {
    const { tab } = setup();
    const a = tab();
    a.receive({ type: "create_feature", title: "Plans" });
    a.receive({ type: "set_session_feature", sessionId: a.viewing, featureId: a.features[0]!.id });
    a.receive({ type: "prompt", text: "just this", newSession: true }); // still empty: reused
    expect(featureOf(a.list, a.viewing)).toBeNull();
  });

  it("reopening a session of a done feature reopens the feature", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "create_feature", title: "Plans" });
    const feature = a.features[0]!.id;
    a.receive({ type: "prompt", text: "task", featureId: feature });
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    a.receive({ type: "set_feature_done", id: feature, done: true });
    a.receive({ type: "set_done", id: a.viewing, done: false });
    expect(a.features[0]).toMatchObject({ id: feature, done: false });
  });

  it("marks a feature done with consent to stop its busy sessions: only those are stopped (4c5)", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "create_feature", title: "Plans" });
    const feature = a.features[0]!.id;
    a.receive({ type: "prompt", text: "idle one", featureId: feature });
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    a.receive({ type: "prompt", text: "busy one", newSession: true, featureId: feature });

    a.receive({ type: "set_feature_done", id: feature, done: true, stop: true });
    await tick();
    expect(agents.map((g) => g.interrupts)).toEqual([0, 1]); // the idle one isn't touched
    expect(a.features[0]?.done).toBe(true);
    expect(a.list.filter((s) => s.featureId === feature).every((s) => s.done)).toBe(true);
  });

    it("renames a feature for every tab; another project's can't be", () => {
    const { tab, otherProject } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "create_feature", title: "Plans" });
    b.receive({ type: "rename_feature", id: a.features[0]!.id, title: "Plans as first-class" });
    expect(a.features[0]?.title).toBe("Plans as first-class");

    let theirs: FeatureSummary[] = [];
    otherProject().connect((m) => void (m.type === "features" && (theirs = m.list))).receive({ type: "create_feature", title: "Not yours" });
    a.receive({ type: "rename_feature", id: theirs[0]!.id, title: "Mine now" });
    expect(a.seen.at(-1)).toMatchObject({ type: "error" });
  });

  it("makes a feature named on the shelf when the prompt starts its session — not before, not after", () => {
    const { tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "csv export", newSession: true, newFeatureTitle: "CSV export" });
    expect(a.features).toMatchObject([{ title: "CSV export", done: false }]);
    expect(featureOf(a.list, a.viewing)).toBe(a.features[0]!.id);

    a.receive({ type: "prompt", text: "a reply", newFeatureTitle: "Never made" }); // not a first prompt
    expect(a.features.map((f) => f.title)).toEqual(["CSV export"]);
  });

  it("moves a session into a new feature named on its shelf", () => {
    const { tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "a one-off that grew" });
    a.receive({ type: "set_session_feature", sessionId: a.viewing, newFeatureTitle: "Reports" });
    expect(a.features).toMatchObject([{ title: "Reports" }]);
    expect(featureOf(a.list, a.viewing)).toBe(a.features[0]!.id);

    a.receive({ type: "set_session_feature", sessionId: a.viewing }); // neither: refused
    expect(a.seen.at(-1)).toMatchObject({ type: "error" });
  });

  it("moves a session into a feature and back to a one-off, for every tab", () => {
    const { tab } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "prompt", text: "a one-off that grew" });
    a.receive({ type: "create_feature", title: "Plans" });
    const feature = a.features[0]!.id;

    b.receive({ type: "set_session_feature", sessionId: a.viewing, featureId: feature });
    expect(featureOf(a.list, a.viewing)).toBe(feature);
    b.receive({ type: "set_session_feature", sessionId: a.viewing, featureId: null });
    expect(featureOf(a.list, a.viewing)).toBeNull();
  });

  it("marks a feature done with its sessions, only once none is busy; new work reopens both", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "create_feature", title: "Plans" });
    const feature = a.features[0]!.id;
    a.receive({ type: "prompt", text: "task", featureId: feature });
    const doneOf = () => a.list.find((s) => s.id === a.viewing)?.done;

    a.receive({ type: "set_feature_done", id: feature, done: true }); // still working: refused
    expect(a.seen.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/still working or waiting on you/) });
    expect(a.features[0]?.done).toBe(false);
    expect(agents[0]!.interrupts).toBe(0);

    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    a.receive({ type: "set_feature_done", id: feature, done: true });
    expect(a.features[0]).toMatchObject({ id: feature, done: true });
    expect(doneOf()).toBe(true); // the whole folder is finished

    a.receive({ type: "set_feature_done", id: feature, done: false }); // reopening leaves sessions done
    expect(a.features[0]?.done).toBe(false);
    expect(doneOf()).toBe(true);

    a.receive({ type: "set_feature_done", id: feature, done: true });
    a.receive({ type: "prompt", text: "one more thing" }); // new work: neither is done any more
    expect(a.features[0]?.done).toBe(false);
    expect(doneOf()).toBe(false);
  });

  it("refuses a feature that's unknown, another project's, or done — and starts nothing", () => {
    const { agents, tab, otherProject } = setup();
    const a = tab();
    let theirs: FeatureSummary[] = [];
    const other = otherProject().connect((m) => void (m.type === "features" && (theirs = m.list)));
    other.receive({ type: "create_feature", title: "Not yours" });
    a.receive({ type: "create_feature", title: "Finished" });
    const done = a.features[0]!.id;
    a.receive({ type: "set_feature_done", id: done, done: true });

    for (const featureId of ["nope", theirs[0]!.id, done]) {
      a.receive({ type: "prompt", text: "task", newSession: true, featureId });
      expect(a.seen.at(-1)).toMatchObject({ type: "error" });
      a.receive({ type: "set_session_feature", sessionId: a.viewing, featureId });
      expect(a.seen.at(-1)).toMatchObject({ type: "error" });
    }
    expect(a.seen.at(-1)).toMatchObject({ message: expect.stringMatching(/reopen it/) });
    expect(agents).toHaveLength(0);
    expect(a.list.every((s) => s.featureId === null)).toBe(true);

    a.receive({ type: "set_feature_done", id: theirs[0]!.id, done: true });
    expect(a.seen.at(-1)).toMatchObject({ type: "error" });
    a.receive({ type: "set_session_feature", sessionId: "nope", featureId: null });
    expect(a.seen.at(-1)).toMatchObject({ type: "error" });
  });
});

describe("SessionHub: sessions name themselves (3z4)", () => {
  const titleOf = (list: SessionSummary[], id: string) => list.find((s) => s.id === id);

  it("the agent names a session from its first prompt; meanwhile it's marked as being named", async () => {
    const { agents, tab } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "prompt", text: "users want the reports page as a CSV" });
    await tick();
    expect(titleOf(b.list, a.viewing)).toMatchObject({ title: "users want the reports page as a CSV", titling: true });
    expect(agents[0]!.titleCalls.map((c) => c.about)).toEqual(["users want the reports page as a CSV"]);

    agents[0]!.titleCalls[0]!.answer("  Reports page CSV export ");
    await tick();
    expect(titleOf(b.list, a.viewing)).toMatchObject({ title: "Reports page CSV export", titling: false });

    a.receive({ type: "prompt", text: "and add a date filter" }); // later prompts don't rename it
    await tick();
    expect(agents[0]!.titleCalls).toHaveLength(1);
  });

  it("Regenerate names it from the conversation so far; a failure keeps the title", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first ask" });
    await tick();
    agents[0]!.titleCalls[0]!.answer("First title");
    agents[0]!.emit({ kind: "text", text: "Done: the CSV button is in." });
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();

    a.receive({ type: "regenerate_title", sessionId: a.viewing });
    await tick();
    expect(agents[0]!.titleCalls[1]!.about).toBe("User: first ask\nAgent: Done: the CSV button is in.");
    agents[0]!.titleCalls[1]!.fail(new Error("no answer"));
    await tick();
    expect(titleOf(a.list, a.viewing)).toMatchObject({ title: "First title", titling: false });

    a.receive({ type: "regenerate_title", sessionId: "nope" });
    expect(a.seen.at(-1)).toMatchObject({ type: "error" });
  });

  it("renames a session by hand, for every tab, without moving it in the list", async () => {
    const { tab } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "prompt", text: "one" });
    a.receive({ type: "prompt", text: "two", newSession: true });
    const order = b.list.map((s) => s.id);
    a.receive({ type: "rename_session", sessionId: order[1]!, title: "My own name" });
    expect(titleOf(b.list, order[1]!)?.title).toBe("My own name");
    expect(b.list.map((s) => s.id)).toEqual(order);
  });
});

describe("SessionHub: harness & model (D43)", () => {
  it("tells every tab the harness and its models, also tabs that connect later", async () => {
    const { tab } = setup();
    const early = tab(); // connected before the models are known
    await tick();
    expect(early.harnesses).toEqual([{ id: "fake", name: "Fake", models: MODELS, permissionModes: MODES, attachments: POLICY }]);
    expect(tab().harnesses).toEqual([{ id: "fake", name: "Fake", models: MODELS, permissionModes: MODES, attachments: POLICY }]);
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

describe("SessionHub: agent questions (D54)", () => {
  const REQUEST: QuestionRequest = {
    toolCallId: "t1",
    questions: [
      { header: "Model", question: "Which model?", multiSelect: false, options: [{ label: "Opus", recommended: true }, { label: "Haiku" }] },
      { header: "Colors", question: "Which colors?", multiSelect: true, options: [{ label: "Red" }, { label: "Blue" }] },
    ],
  };
  const status = (t: { list: SessionSummary[]; viewing: string }) => t.list.find((s) => s.id === t.viewing)?.status;
  const resolved = (t: { seen: ServerMessage[] }) => t.seen.filter((m) => m.type === "question_resolved");

  it("shows the questions to every tab, marks the session as needing an answer, and passes the answer on", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    const { reply } = agents[0]!.question(REQUEST);
    expect(a.seen.at(-1)).toEqual({ type: "question_request", id: a.lastQuestionId(), request: REQUEST });
    expect(status(a)).toBe("needs_answer");

    const answers = [{ selected: ["Opus"] }, { selected: ["Red"], other: "teal" }];
    a.receive({ type: "question_answer", id: a.lastQuestionId(), reply: { outcome: "answered", answers } });
    expect(await reply).toEqual({ outcome: "answered", answers });
    expect(resolved(a)).toEqual([{ type: "question_resolved", id: a.lastQuestionId(), outcome: "answered", answers }]);
    expect(status(a)).toBe("working");
  });

  it("refuses answers that don't fit the questions, and keeps them open", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    agents[0]!.question(REQUEST);
    const id = a.lastQuestionId();
    const tries: Array<[QuestionAnswer[], string]> = [
      [[{ selected: ["Opus"] }], "Expected 2 answers, got 1"],
      [[{ selected: ["Sonnet"] }, { selected: ["Red"] }], '"Sonnet" is not an option of "Model"'],
      [[{ selected: ["Opus"], other: "mine" }, { selected: ["Red"] }], '"Model" takes one answer'],
      [[{ selected: ["Opus"] }, { selected: [], other: "  " }], '"Colors" has no answer'],
    ];
    for (const [answers, problem] of tries) {
      a.receive({ type: "question_answer", id, reply: { outcome: "answered", answers } });
      expect(a.seen.at(-1)).toEqual({ type: "error", message: `Couldn't send your answer: ${problem}` });
    }
    expect(resolved(a)).toEqual([]);
    expect(status(a)).toBe("needs_answer");
  });

  it("takes the first answer from any tab, skips included, and ignores a late one quietly", async () => {
    const { agents, tab } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "prompt", text: "first" });
    const { reply } = agents[0]!.question(REQUEST);
    const id = a.lastQuestionId();
    b.receive({ type: "question_answer", id, reply: { outcome: "skipped" } });
    a.receive({ type: "question_answer", id, reply: { outcome: "answered", answers: [{ selected: ["Opus"] }, { selected: ["Red"] }] } });
    expect(await reply).toEqual({ outcome: "skipped" });
    expect(resolved(a)).toEqual([{ type: "question_resolved", id, outcome: "skipped" }]);
    expect(a.seen.some((m) => m.type === "error")).toBe(false);
  });

  it("marks questions the agent withdrew, or a restart left open, as cancelled", async () => {
    const { agents, tab, restart } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    const first = agents[0]!.question(REQUEST);
    first.withdraw();
    expect(await first.reply).toEqual({ outcome: "skipped" }); // the agent no longer reads it
    expect(resolved(a)).toEqual([{ type: "question_resolved", id: a.lastQuestionId(), outcome: "cancelled" }]);

    agents[0]!.question(REQUEST); // still open when Kratos restarts
    const openId = a.lastQuestionId();
    restart();
    const late = tab();
    expect(late.seen.filter((m) => m.type === "question_resolved").at(-1)).toEqual({ type: "question_resolved", id: openId, outcome: "cancelled" });
    expect(status(late)).toBe("idle");
  });
});

describe("SessionHub: attachments (D55)", () => {
  const upload = (name: string, mediaType: string, bytes: Uint8Array | string) => ({
    name,
    mediaType,
    data: Buffer.from(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes).toString("base64"),
  });

  it("stores the files, logs only what they are, and passes them to the agent", () => {
    const { agents, tab, hub, otherProject } = setup();
    const a = tab();
    a.receive({
      type: "prompt",
      text: "look",
      newSession: true,
      attachments: [upload("red.png", "image/png", new Uint8Array([137, 80, 78, 71])), upload("notes.ts", "", "export {}")],
    });
    const sent = a.seen.find((m) => m.type === "user_prompt");
    expect(sent).toMatchObject({
      type: "user_prompt",
      text: "look",
      attachments: [
        { name: "red.png", kind: "image", mediaType: "image/png", size: 4 },
        { name: "notes.ts", kind: "text", mediaType: "text/plain", size: 9 },
      ],
    });
    expect(agents[0]!.files[0]!.map((f) => [f.name, f.kind, f.data.byteLength])).toEqual([
      ["red.png", "image", 4],
      ["notes.ts", "text", 9],
    ]);
    const refs = sent?.type === "user_prompt" ? sent.attachments! : [];
    expect(Buffer.from(hub.readAttachment(refs[1]!.id)!.data).toString()).toBe("export {}");
    expect(otherProject().readAttachment(refs[1]!.id)).toBeUndefined(); // only this project's
    expect(hub.readAttachment("not-an-id")).toBeUndefined();
  });

  it("stores images a tool returned like files; the log and the tabs get refs, never bytes (3z)", async () => {
    const { agents, tab, hub, otherProject, store } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "check the screenshot" });
    const png = Buffer.from([137, 80, 78, 71, 13, 10]);
    agents[0]!.emit({ kind: "tool_call", id: "t1", tool: "Read", input: { file_path: "/tmp/shot.png" } });
    agents[0]!.emit({ kind: "tool_result", id: "t1", output: "[image]", isError: false, images: [{ mediaType: "image/png", base64: png.toString("base64") }] });
    await tick();

    const result = a.seen.find((m) => m.type === "agent_event" && m.event.kind === "tool_result");
    expect(result).toEqual({
      type: "agent_event",
      event: { kind: "tool_result", id: "t1", output: "[image]", isError: false, attachments: [expect.objectContaining({ name: "image.png", kind: "image", mediaType: "image/png", size: 6 })] },
    });
    const ref = result?.type === "agent_event" && result.event.kind === "tool_result" ? result.event.attachments![0]! : undefined;
    expect(Buffer.from(hub.readAttachment(ref!.id)!.data)).toEqual(png);
    expect(otherProject().readAttachment(ref!.id)).toBeUndefined(); // only this project's
    expect(JSON.stringify(store.load(a.viewing))).not.toContain(png.toString("base64")); // no bytes in the log
  });

  it("refuses the whole prompt — nothing starts — if any file doesn't fit", () => {
    const { agents, tab } = setup();
    const a = tab();
    const tries: Array<[ReturnType<typeof upload>[], string]> = [
      [[upload("a.zip", "application/zip", new Uint8Array([80, 75, 0, 3]))], "a.zip: application/zip file can't be attached"],
      [[upload("big.png", "image/png", new Uint8Array(101))], "big.png is too big"],
      [[upload("1.txt", "", "a"), upload("2.txt", "", "b"), upload("3.txt", "", "c")], "Up to 2 files per prompt (got 3)"],
    ];
    for (const [attachments, problem] of tries) {
      a.receive({ type: "prompt", text: "look", newSession: true, attachments });
      expect(a.seen.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining(`Couldn't send your prompt: ${problem}`) });
    }
    expect(agents).toHaveLength(0);
    expect(a.seen.some((m) => m.type === "user_prompt")).toBe(false);
  });
});

describe("SessionHub: replay complete (3d9)", () => {
  it("tells a tab when a session's whole log has been replayed, so it can show it at once", () => {
    const { tab } = setup();
    const a = tab();
    expect(a.seenWhenReady).toBe(0); // a new, empty session: ready straight away
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "prompt", text: "second" });
    const late = tab();
    expect(late.seen.filter((m) => m.type === "user_prompt" || m.type === "prompt_queued")).toHaveLength(2); // the 2nd was queued (D56)
    expect(late.seenWhenReady).toBe(late.seen.length); // after the last replayed message
  });
});

describe("SessionHub: steering prompts (D56)", () => {
  const queuedIds = (t: { seen: ServerMessage[] }) => t.seen.flatMap((m) => (m.type === "prompt_queued" ? [m.id] : []));
  const count = (t: { list: SessionSummary[]; viewing: string }) => t.list.find((s) => s.id === t.viewing)?.queued;
  const status = (t: { list: SessionSummary[]; viewing: string }) => t.list.find((s) => s.id === t.viewing)?.status;

  it("queues a prompt sent while the agent works, and marks where the agent read it", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "prompt", text: "also this" });
    const [id] = queuedIds(a);
    expect(a.seen.at(-1)).toEqual({ type: "prompt_queued", id, text: "also this" });
    expect(agents[0]!.promptIds.at(-1)).toBe(id); // sent at once, tagged: the agent holds it
    expect(count(a)).toBe(1);

    agents[0]!.emit({ kind: "tool_result", id: "t1", output: "ok", isError: false });
    agents[0]!.emit({ kind: "prompt_state", id: id!, state: "started" }); // taken at the step boundary
    await tick();
    expect(a.seen.at(-1)).toEqual({ type: "prompt_read", id, how: "step", after: "t1" });
    expect(count(a)).toBe(0);
    expect(a.seen.some((m) => m.type === "agent_event" && m.event.kind === "prompt_state")).toBe(false); // not logged
  });

  it("a prompt read after the turn ended starts a new turn", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "prompt", text: "next" });
    const [id] = queuedIds(a);
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    expect(status(a)).toBe("idle");
    agents[0]!.emit({ kind: "prompt_state", id: id!, state: "started" });
    await tick();
    expect(a.seen.at(-1)).toEqual({ type: "prompt_read", id, how: "next_turn" });
    expect(status(a)).toBe("working");
  });

  it("prompts the agent takes together to start a new turn are all next_turn", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "prompt", text: "B" });
    a.receive({ type: "prompt", text: "D" });
    const [b, d] = queuedIds(a);
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    agents[0]!.emit({ kind: "prompt_state", id: b!, state: "started" });
    agents[0]!.emit({ kind: "prompt_state", id: d!, state: "started" });
    await tick();
    expect(a.seen.filter((m) => m.type === "prompt_read").map((m) => m.type === "prompt_read" && m.how)).toEqual(["next_turn", "next_turn"]);
  });

  it("takes a queued prompt back on request", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "prompt", text: "never mind" });
    const [id] = queuedIds(a);
    a.receive({ type: "remove_queued", id: id! });
    expect(agents[0]!.cancelled).toEqual([id]);
    agents[0]!.emit({ kind: "prompt_state", id: id!, state: "cancelled" });
    await tick();
    expect(a.seen.at(-1)).toEqual({ type: "prompt_removed", id, reason: "removed" });
    expect(count(a)).toBe(0);
  });

  it("Stop with a queue stops everything and gives the queued text back to that tab only", async () => {
    const { agents, tab } = setup();
    const a = tab();
    const b = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "prompt", text: "fix tests" });
    a.receive({ type: "prompt", text: "rename file" });
    const ids = queuedIds(a);
    a.receive({ type: "interrupt" });
    expect(agents[0]!.interruptOptions).toEqual([{ cancelQueued: true }]);
    for (const id of ids) agents[0]!.emit({ kind: "prompt_state", id, state: "cancelled" });
    await tick();
    expect(a.seen.filter((m) => m.type === "prompt_removed")).toEqual(ids.map((id) => ({ type: "prompt_removed", id, reason: "stopped" })));
    expect(a.seen.at(-1)).toEqual({ type: "prompts_returned", text: "fix tests\n\nrename file" });
    expect(b.seen.some((m) => m.type === "prompts_returned")).toBe(false);
  });

  it("a plain Stop with nothing queued doesn't touch the queue", () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "interrupt" });
    expect(agents[0]!.interruptOptions).toEqual([{ cancelQueued: false }]);
  });

  it("drops a queue the agent can no longer read: it exited, or Kratos restarted", async () => {
    const { agents, tab, restart } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "prompt", text: "queued 1" });
    await agents[0]!.stop(); // the agent's events end
    await tick();
    expect(a.seen.filter((m) => m.type === "prompt_removed")).toEqual([{ type: "prompt_removed", id: queuedIds(a)[0], reason: "stopped" }]);

    a.receive({ type: "prompt", text: "again" }); // starts a new agent
    a.receive({ type: "prompt", text: "queued 2" });
    const second = queuedIds(a)[1];
    restart();
    const late = tab();
    expect(late.seen.filter((m) => m.type === "prompt_removed").at(-1)).toEqual({ type: "prompt_removed", id: second, reason: "stopped" });
    expect(count(late)).toBe(0);
  });

  it("a turn after the agent died mid-turn knows none of the dead turn's steps (D68)", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    agents[0]!.emit({ kind: "tool_result", id: "old", output: "ok", isError: false });
    await agents[0]!.stop(); // its events end without a turn_end
    await tick();
    a.receive({ type: "prompt", text: "again" }); // a new agent, a new turn
    a.receive({ type: "prompt", text: "queued" });
    const [id] = queuedIds(a);
    agents[1]!.emit({ kind: "prompt_state", id: id!, state: "started" });
    await tick();
    expect(a.seen.at(-1)).toEqual({ type: "prompt_read", id, how: "step" }); // not after "old"
  });
});

describe("SessionHub: Send now (D56, 3t2)", () => {
  const queuedIds = (t: { seen: ServerMessage[] }) => t.seen.flatMap((m) => (m.type === "prompt_queued" ? [m.id] : []));
  const count = (t: { list: SessionSummary[]; viewing: string }) => t.list.find((s) => s.id === t.viewing)?.queued;

  it("sends only the chosen prompt now; the others are withdrawn, then queued again unseen", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    agents[0]!.emit({ kind: "tool_call", id: "t1", tool: "Bash", input: {} }); // a step is running
    for (const text of ["B", "C", "D"]) a.receive({ type: "prompt", text });
    const [b, c, d] = queuedIds(a);
    await tick();

    a.receive({ type: "send_now", id: c! });
    await tick();
    expect(agents[0]!.cancelled).toEqual([b, d]); // the others leave the agent's queue…
    expect(agents[0]!.sentNow).toEqual([c]);
    agents[0]!.emit({ kind: "prompt_state", id: b!, state: "cancelled" });
    agents[0]!.emit({ kind: "prompt_state", id: d!, state: "cancelled" });
    agents[0]!.emit({ kind: "turn_end", reason: "interrupted" });
    await tick();
    expect(a.seen.some((m) => m.type === "prompt_removed")).toBe(false); // …but not ours
    expect(count(a)).toBe(3);

    agents[0]!.emit({ kind: "prompt_state", id: c!, state: "started" });
    await tick();
    expect(a.seen.find((m) => m.type === "prompt_read")).toEqual({ type: "prompt_read", id: c, how: "now", stopped: "t1" });
    // Sent again under new agent ids, in order; still the same prompts in the queue.
    const resent = agents[0]!.promptIds.slice(-2);
    expect(agents[0]!.prompts.slice(-2)).toEqual(["B", "D"]);
    expect(resent).not.toContain(b);
    expect(count(a)).toBe(2);

    agents[0]!.emit({ kind: "prompt_state", id: b!, state: "cancelled" }); // a stale line for the old id
    agents[0]!.emit({ kind: "prompt_state", id: resent[0]!, state: "started" });
    await tick();
    expect(a.seen.filter((m) => m.type === "prompt_read").at(-1)).toMatchObject({ type: "prompt_read", id: b });
    expect(a.seen.some((m) => m.type === "prompt_removed")).toBe(false);
    expect(count(a)).toBe(1);
  });

  it("⌘↵ sends a new prompt now instead of queueing it", async () => {
    const { agents, tab } = setup();
    const a = tab();
    a.receive({ type: "prompt", text: "first" });
    a.receive({ type: "prompt", text: "urgent", sendNow: true });
    await tick();
    const [id] = queuedIds(a);
    expect(agents[0]!.sentNow).toEqual([id]);
  });
});

/** Snapshots the test controls (3v1): `take` waits until released, files "change" by hand —
 * `edit(path)` puts a change into the next snapshot taken. */
class FakeSnapshots implements Snapshots {
  repo = true;
  taken = 0;
  private pending: string[] = [];
  /** tree number → the paths changed since the one before it. */
  private changes = new Map<number, string[]>();
  edit(path: string) {
    this.pending.push(path);
  }
  gone = new Set<string>();
  private waiting: Array<() => void> = [];
  /** Hold every `take` until `release()` (to see what waits for it). */
  hold = false;
  /** Fail the next `take`s (git broke). */
  failing = 0;
  async take() {
    if (this.hold) await new Promise<void>((resolve) => this.waiting.push(resolve));
    if (this.failing > 0 && this.failing--) throw new Error("git timed out");
    if (!this.repo) return null;
    this.changes.set(++this.taken, this.pending.splice(0));
    return `tree${this.taken}`;
  }
  release() {
    this.hold = false;
    this.waiting.splice(0).forEach((resolve) => resolve());
  }
  async exists(id: string) {
    return !this.gone.has(id);
  }
  async changedPaths(from: string, to: string) {
    const [a, b] = [from, to].map((tree) => Number(tree.slice(4)));
    return [...new Set([...this.changes].filter(([n]) => n > a! && n <= b!).flatMap(([, paths]) => paths))];
  }
  async diff(from: string, to: string, only?: ReadonlySet<string>) {
    const paths = (await this.changedPaths(from, to)).filter((path) => !only || only.has(path));
    return paths.map((path) => ({ path, version: `${from}..${to}`, status: "modified" as const, additions: 1, deletions: 0, before: "", after: "x\n" }));
  }
}

describe("SessionHub: reviewing changes (3v1, D65)", () => {
  const changesOf = (seen: ServerMessage[]) => seen.findLast((m) => m.type === "changes");

  it("snapshots before the agent gets the prompt, and again when the turn ends", async () => {
    const snapshots = new FakeSnapshots();
    snapshots.hold = true;
    const { agents, tab } = setup(snapshots);
    const a = tab();
    a.receive({ type: "prompt", text: "edit a.txt" });
    expect(agents).toHaveLength(1); // the process starts at once…
    a.receive({ type: "prompt", text: "and b.txt" }); // (queued: the turn is open)
    await tick();
    expect(agents[0]!.prompts).toEqual([]); // …but hears nothing until the files are recorded
    snapshots.release();
    await tick();
    expect(agents[0]!.prompts).toEqual(["edit a.txt", "and b.txt"]); // in order
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    expect(snapshots.taken).toBe(2);
  });

  it("Stop and remove wait for the prompts they're about: the agent never hears of them first", async () => {
    const snapshots = new FakeSnapshots();
    snapshots.hold = true;
    const { agents, tab } = setup(snapshots);
    const a = tab();
    a.receive({ type: "prompt", text: "edit a.txt" });
    a.receive({ type: "prompt", text: "never mind" });
    const queued = a.seen.find((m) => m.type === "prompt_queued");
    a.receive({ type: "remove_queued", id: queued!.type === "prompt_queued" ? queued!.id : "" });
    a.receive({ type: "interrupt" });
    await tick();
    expect([agents[0]!.cancelled, agents[0]!.interrupts]).toEqual([[], 0]); // nothing sent yet
    snapshots.release();
    await tick();
    expect(agents[0]!.prompts).toEqual(["edit a.txt", "never mind"]);
    expect(agents[0]!.cancelled).toHaveLength(1);
    expect(agents[0]!.interrupts).toBe(1);
  });

  it("answers get_changes with the session's first snapshot vs now", async () => {
    const snapshots = new FakeSnapshots();
    const { agents, tab } = setup(snapshots);
    const a = tab();
    a.receive({ type: "get_changes", sessionId: a.viewing });
    await tick();
    expect(changesOf(a.seen)).toEqual({ type: "changes", sessionId: a.viewing, files: [] }); // no turn yet

    a.receive({ type: "prompt", text: "edit" });
    await tick();
    snapshots.edit("a.txt"); // the agent, during the turn
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    snapshots.edit("a.txt"); // you, after it: the same file again…
    snapshots.edit("mine.txt"); // …and one only you touched
    a.receive({ type: "get_changes", sessionId: a.viewing });
    await tick();
    // tree1 was "now" for the first get_changes; tree2 = turn start, tree3 = turn end, tree4 = now
    expect(changesOf(a.seen)).toMatchObject({ files: [{ path: "a.txt", version: "tree2..tree4" }] });
    expect(changesOf(a.seen)).not.toHaveProperty("note"); // turn 1 ended after its snapshot, even in the same ms
  });

  it("counts only files changed during the agent's turns, and the open turn's so far (D67)", async () => {
    const snapshots = new FakeSnapshots();
    const { agents, tab } = setup(snapshots);
    const a = tab();
    a.receive({ type: "prompt", text: "one" });
    await tick();
    snapshots.edit("one.txt");
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    snapshots.edit("between.txt"); // between turns: not the agent's
    a.receive({ type: "prompt", text: "two" });
    await tick();
    snapshots.edit("two.txt"); // the turn is still open
    a.receive({ type: "get_changes", sessionId: a.viewing });
    await tick();
    const paths = (m?: ServerMessage) => (m?.type === "changes" ? m.files.map((f) => f.path).sort() : []);
    expect(paths(changesOf(a.seen))).toEqual(["one.txt", "two.txt"]);

    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    snapshots.edit("later.txt"); // after the last turn, the session idle
    a.receive({ type: "get_changes", sessionId: a.viewing });
    await tick();
    expect(paths(changesOf(a.seen))).toEqual(["one.txt", "two.txt"]);
  });

  it("a queued turn whose end snapshot failed still counts: it has no start snapshot of its own (D67)", async () => {
    const snapshots = new FakeSnapshots();
    const { agents, tab } = setup(snapshots);
    const a = tab();
    a.receive({ type: "prompt", text: "one" });
    await tick();
    a.receive({ type: "prompt", text: "two" }); // queued: the turn is open
    snapshots.edit("one.txt");
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    const [queued] = a.seen.flatMap((m) => (m.type === "prompt_queued" ? [m.id] : []));
    agents[0]!.emit({ kind: "prompt_state", id: queued!, state: "started" }); // the agent starts turn 2 itself
    await tick();
    snapshots.edit("two.txt");
    snapshots.failing = 1; // turn 2's end snapshot
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    const paths = (m?: ServerMessage) => (m?.type === "changes" ? m.files.map((f) => f.path).sort() : []);
    a.receive({ type: "get_changes", sessionId: a.viewing });
    await tick();
    expect(paths(changesOf(a.seen))).toEqual(["one.txt", "two.txt"]);

    a.receive({ type: "prompt", text: "three" }); // a turn of yours, with its own start snapshot
    await tick();
    a.receive({ type: "get_changes", sessionId: a.viewing });
    await tick();
    expect(paths(changesOf(a.seen))).toEqual(["one.txt", "two.txt"]);
  });

  it("a failed start snapshot: the changes since the first one, with a note that some may be missing", async () => {
    const snapshots = new FakeSnapshots();
    snapshots.failing = 2; // turn 1's start and end both fail
    const { agents, tab } = setup(snapshots);
    const a = tab();
    a.receive({ type: "prompt", text: "one" });
    await tick();
    agents[0]!.emit({ kind: "turn_end", reason: "completed" });
    await tick();
    a.receive({ type: "get_changes", sessionId: a.viewing });
    await tick();
    expect(changesOf(a.seen)).toMatchObject({ files: [], unavailable: expect.stringContaining("couldn't record the files") });

    a.receive({ type: "prompt", text: "two" }); // its start snapshot works
    await tick();
    snapshots.edit("b.txt");
    a.receive({ type: "get_changes", sessionId: a.viewing });
    await tick();
    const changes = changesOf(a.seen);
    expect(changes).toMatchObject({ files: [{ path: "b.txt", version: "tree2..tree3" }], note: expect.stringContaining("earliest turns may be missing") });
    expect(changes).not.toHaveProperty("unavailable");
  });

  it("keeps viewed files per session, tells every tab, and still has them after a restart (3v3)", async () => {
    const { tab, restart, otherProject } = setup(new FakeSnapshots());
    const a = tab();
    const b = tab();
    const viewedOf = (seen: ServerMessage[]) => seen.findLast((m) => m.type === "viewed");
    a.receive({ type: "set_viewed", sessionId: a.viewing, path: "src/x.ts", version: "v1", viewed: true });
    expect(viewedOf(b.seen)).toEqual({ type: "viewed", sessionId: a.viewing, files: { "src/x.ts": "v1" } });
    a.receive({ type: "set_viewed", sessionId: a.viewing, path: "src/x.ts", version: "v2", viewed: true }); // viewed again after a new edit
    a.receive({ type: "set_viewed", sessionId: a.viewing, path: "b.md", version: "v1", viewed: true });
    a.receive({ type: "set_viewed", sessionId: a.viewing, path: "b.md", version: "v1", viewed: false });
    expect(viewedOf(b.seen)).toEqual({ type: "viewed", sessionId: a.viewing, files: { "src/x.ts": "v2" } });

    restart();
    const c = tab();
    c.receive({ type: "get_changes", sessionId: c.viewing });
    await tick();
    expect(c.seen.slice(-2).map((m) => m.type)).toEqual(["changes", "viewed"]); // in that order
    expect(viewedOf(c.seen)).toMatchObject({ files: { "src/x.ts": "v2" } });

    const seen: ServerMessage[] = [];
    otherProject().connect((m) => seen.push(m)).receive({ type: "set_viewed", sessionId: c.viewing, path: "a", version: "v", viewed: true });
    expect(seen.at(-1)).toEqual({ type: "error", message: `No session ${c.viewing} in this project` });
  });

  it("says why when there's nothing to show: no git, a pruned snapshot, another project's id", async () => {
    const snapshots = new FakeSnapshots();
    const { tab, otherProject } = setup(snapshots);
    const a = tab();
    a.receive({ type: "prompt", text: "edit" });
    await tick();
    snapshots.gone.add("tree1");
    a.receive({ type: "get_changes", sessionId: a.viewing });
    await tick();
    expect(changesOf(a.seen)).toMatchObject({ files: [], unavailable: expect.stringContaining("snapshot is gone") });

    snapshots.repo = false;
    a.receive({ type: "get_changes", sessionId: a.viewing });
    await tick();
    expect(changesOf(a.seen)).toMatchObject({ files: [], unavailable: expect.stringContaining("isn't in a git repository") });

    const seen: ServerMessage[] = [];
    otherProject().connect((m) => seen.push(m)).receive({ type: "get_changes", sessionId: a.viewing });
    expect(seen.at(-1)).toEqual({ type: "error", message: `No session ${a.viewing} in this project` });
  });
});
