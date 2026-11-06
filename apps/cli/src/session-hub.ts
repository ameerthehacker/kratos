import type { AgentAdapter, ClientMessage, ServerMessage } from "@kratos/core";
import { SessionRuntime } from "./session-runtime.js";
import type { SessionStore } from "./store/store.js";

type Send = (message: ServerMessage) => void;

/** A connected browser tab, as the server sees it. */
export type Tab = {
  receive(message: ClientMessage): void;
  disconnect(): void;
};

/**
 * All of a project's sessions (D41). Sessions run side by side — each SessionRuntime keeps its
 * own agent, log and asks — and every tab views one of them. The hub routes: a tab's prompts and
 * interrupts go to the session it views, decisions go to whichever session owns the ask, and
 * each session's new messages go to the tabs viewing it. Knows nothing about WebSockets.
 */
export class SessionHub {
  private readonly runtimes = new Map<string, SessionRuntime>();
  /** Which session each connected tab is viewing. */
  private readonly views = new Map<Send, string>();

  constructor(
    private readonly adapter: AgentAdapter,
    private readonly cwd: string,
    private readonly store: SessionStore,
  ) {}

  /** A tab connected: show it the most recent session and the session list. */
  connect(send: Send): Tab {
    this.view(send, this.store.latestOrCreate(this.cwd, this.adapter.displayName).id);
    send(this.sessionList());
    return {
      receive: (message) => this.receive(send, message),
      disconnect: () => this.views.delete(send),
    };
  }

  /** Server shutdown: withdraw every session's open asks and stop every agent. */
  async close(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.close()));
  }

  private receive(send: Send, message: ClientMessage): void {
    const viewing = this.runtime(this.views.get(send)!);
    switch (message.type) {
      case "prompt": {
        // From Home: new work gets a new session, unless the viewed one is still empty anyway.
        // Whatever this tab was viewing keeps running (D41).
        let target = viewing;
        if (message.newSession && viewing.hasPrompts) {
          target = this.runtime(this.store.create(this.cwd, this.adapter.displayName).id);
          this.view(send, target.id);
        }
        target.prompt(message.text);
        return;
      }
      case "open_session":
        if (this.store.get(message.id)?.projectDir === this.cwd) this.view(send, message.id);
        else send({ type: "error", message: `No session ${message.id} in this project` });
        return;
      case "interrupt":
        viewing.interrupt();
        return;
      case "permission_decision":
        // Ask ids are unique across sessions: let the owner take it (first decision wins).
        for (const runtime of this.runtimes.values()) if (runtime.decide(message.id, message.decision)) return;
        return;
      case "ping":
        return; // answered by the server itself
    }
  }

  /** Point a tab at a session: announce it, then replay its log. */
  private view(send: Send, sessionId: string): void {
    const runtime = this.runtime(sessionId);
    this.views.set(send, sessionId);
    send({ type: "session", id: sessionId });
    for (const message of runtime.messages) send(message);
  }

  /** The session's runtime, loaded from the store on first use. */
  private runtime(sessionId: string): SessionRuntime {
    let runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      runtime = new SessionRuntime(sessionId, {
        adapter: this.adapter,
        cwd: this.cwd,
        store: this.store,
        onMessage: (message) => this.forward(sessionId, message),
        onChange: () => this.broadcastSessionList(),
      });
      this.runtimes.set(sessionId, runtime);
      this.broadcastSessionList(); // a new session (or one just loaded) may change the list
    }
    return runtime;
  }

  private forward(sessionId: string, message: ServerMessage): void {
    for (const [send, viewing] of this.views) if (viewing === sessionId) send(message);
  }

  private sessionList(): ServerMessage {
    return {
      type: "sessions",
      list: this.store.list(this.cwd).map((s) => ({
        id: s.id,
        title: s.title,
        status: this.runtimes.get(s.id)?.status ?? "idle",
        updatedAt: s.updatedAt.getTime(),
      })),
    };
  }

  private broadcastSessionList(): void {
    const list = this.sessionList();
    for (const send of this.views.keys()) send(list);
  }
}
