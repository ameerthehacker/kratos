import { describe, expect, it } from "vitest";
import type { AgentAdapter, AgentEvent, AgentSession, PermissionRequest, RequestPermission, ServerMessage } from "@kratos/core";
import { SessionHub } from "./session-hub.js";

/** In-memory agent session the test drives by hand: emit events, raise asks, end it. */
class FakeSession implements AgentSession {
  readonly prompts: string[] = [];
  interrupts = 0;
  stopped = false;
  private stream!: ReadableStreamDefaultController<AgentEvent>;
  readonly events = new ReadableStream<AgentEvent>({ start: (c) => void (this.stream = c) });

  constructor(readonly options: { cwd: string; requestPermission: RequestPermission }) {}
  send(prompt: string) {
    this.prompts.push(prompt);
  }
  async interrupt() {
    this.interrupts++;
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
}

function setup() {
  const sessions: FakeSession[] = [];
  const adapter: AgentAdapter = {
    id: "fake",
    displayName: "Fake",
    startSession: (options) => {
      const session = new FakeSession(options);
      sessions.push(session);
      return session;
    },
  };
  const hub = new SessionHub(adapter, "/projects/demo");
  const tab = () => {
    const seen: ServerMessage[] = [];
    const disconnect = hub.connect((m) => seen.push(m));
    return { seen, disconnect };
  };
  return { hub, sessions, tab };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0)); // let the event pump run
const WRITE: PermissionRequest = { tool: "Write", input: { file_path: "a.txt" } };
const lastRequestId = (seen: ServerMessage[]) => {
  const ask = seen.findLast((m) => m.type === "permission_request");
  return ask?.type === "permission_request" ? ask.id : "";
};

describe("SessionHub", () => {
  it("starts the agent on the first prompt in the project dir and broadcasts to every tab", async () => {
    const { hub, sessions, tab } = setup();
    const a = tab();
    const b = tab();
    expect(sessions).toHaveLength(0);

    hub.receive({ type: "prompt", text: "hi" });
    sessions[0]!.emit({ kind: "text", text: "hello" });
    await tick();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.options.cwd).toBe("/projects/demo");
    expect(sessions[0]!.prompts).toEqual(["hi"]);
    const expected = [
      { type: "user_prompt", text: "hi" },
      { type: "agent_event", event: { kind: "text", text: "hello" } },
    ];
    expect(a.seen).toEqual(expected);
    expect(b.seen).toEqual(expected);

    // Later prompts continue the same conversation (same agent session).
    hub.receive({ type: "prompt", text: "again" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.prompts).toEqual(["hi", "again"]);
  });

  it("replays the whole log to a tab that connects later, including a pending ask it can answer", async () => {
    const { hub, sessions, tab } = setup();
    const a = tab();
    hub.receive({ type: "prompt", text: "edit a.txt" });
    const { decision } = sessions[0]!.ask(WRITE);
    a.disconnect(); // every tab gone: the ask must stay pending (no auto-deny)

    const late = tab();
    expect(late.seen.map((m) => m.type)).toEqual(["user_prompt", "permission_request"]);
    hub.receive({ type: "permission_decision", id: lastRequestId(late.seen), decision: { decision: "allow" } });
    await expect(decision).resolves.toEqual({ decision: "allow" });
  });

  it("first decision wins, everyone sees one resolution, and stale or unknown answers are ignored", async () => {
    const { hub, sessions, tab } = setup();
    const a = tab();
    const b = tab();
    hub.receive({ type: "prompt", text: "edit" });
    const { decision } = sessions[0]!.ask(WRITE);
    const id = lastRequestId(a.seen);

    hub.receive({ type: "permission_decision", id, decision: { decision: "deny", message: "not there" } });
    hub.receive({ type: "permission_decision", id, decision: { decision: "allow" } }); // too late
    hub.receive({ type: "permission_decision", id: "no-such-ask", decision: { decision: "allow" } });

    await expect(decision).resolves.toEqual({ decision: "deny", message: "not there" });
    for (const seen of [a.seen, b.seen]) {
      expect(seen.filter((m) => m.type === "permission_resolved")).toEqual([
        { type: "permission_resolved", id, outcome: "denied" },
      ]);
    }
  });

  it("marks an ask withdrawn by the agent as cancelled and ignores answers to it", async () => {
    const { hub, sessions, tab } = setup();
    const a = tab();
    hub.receive({ type: "prompt", text: "edit" });
    const { withdraw } = sessions[0]!.ask(WRITE);
    const id = lastRequestId(a.seen);

    withdraw();
    hub.receive({ type: "permission_decision", id, decision: { decision: "allow" } });
    expect(a.seen.filter((m) => m.type === "permission_resolved")).toEqual([
      { type: "permission_resolved", id, outcome: "cancelled" },
    ]);
  });

  it("close() withdraws open asks and stops the agent session", async () => {
    const { hub, sessions, tab } = setup();
    const a = tab();
    hub.receive({ type: "prompt", text: "edit" });
    const { decision } = sessions[0]!.ask(WRITE);

    await hub.close();
    await expect(decision).resolves.toMatchObject({ decision: "deny" });
    expect(a.seen.at(-1)).toMatchObject({ type: "permission_resolved", outcome: "cancelled" });
    expect(sessions[0]!.stopped).toBe(true);
  });

  it("forwards interrupts, and starts a fresh agent session after the old one ended", async () => {
    const { hub, sessions } = setup();
    hub.receive({ type: "interrupt" }); // nothing running yet: ignored
    hub.receive({ type: "prompt", text: "one" });
    hub.receive({ type: "interrupt" });
    expect(sessions[0]!.interrupts).toBe(1);

    await sessions[0]!.stop(); // e.g. the CLI crashed
    await tick();
    hub.receive({ type: "prompt", text: "two" });
    expect(sessions).toHaveLength(2);
    expect(sessions[1]!.prompts).toEqual(["two"]);
  });
});
