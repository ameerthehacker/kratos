import { randomUUID } from "node:crypto";
import type {
  AgentAdapter,
  AgentSession,
  ClientMessage,
  PermissionDecision,
  PermissionRequest,
  ServerMessage,
} from "@kratos/core";
import type { SessionStore } from "./store/store.js";

type Send = (message: ServerMessage) => void;
type Outcome = "allowed" | "denied" | "cancelled";

/**
 * The server's one shared agent session (D32). Browser tabs come and go; the hub keeps the
 * conversation's message log, replays it to every new tab, broadcasts new messages, and routes
 * permission asks to whichever tab answers first. Knows nothing about WebSockets.
 * The log lives in the store, so it survives restarts, and the agent resumes the same
 * conversation (D36).
 */
export class SessionHub {
  private readonly tabs = new Set<Send>();
  private readonly pending = new Map<string, (decision: PermissionDecision) => void>();
  private readonly log: ServerMessage[];
  private readonly sessionId: string;
  /** Has the agent ever been started for this conversation? Then every start must resume. */
  private agentStarted: boolean;
  private session: AgentSession | undefined;

  constructor(
    private readonly adapter: AgentAdapter,
    private readonly cwd: string,
    private readonly store: SessionStore,
  ) {
    const stored = store.latestOrCreate(cwd, adapter.displayName);
    this.sessionId = stored.id;
    this.agentStarted = stored.agentStartedAt !== null;
    this.log = store.load(stored.id);
    // Asks left open by a previous run can't be answered: the agent process that asked is gone.
    for (const id of unresolvedAsks(this.log)) this.publish({ type: "permission_resolved", id, outcome: "cancelled" });
  }

  /** A tab connected: replay the log so far, then keep it updated. Returns its disconnect. */
  connect(send: Send): () => void {
    for (const message of this.log) send(message);
    this.tabs.add(send);
    return () => this.tabs.delete(send);
  }

  /** Handle one (already validated) message from any tab. */
  receive(message: ClientMessage): void {
    switch (message.type) {
      case "prompt":
        this.publish({ type: "user_prompt", text: message.text });
        // Start the agent on the first prompt, and again after a session has ended.
        (this.session ??= this.start()).send(message.text);
        return;
      case "interrupt":
        void this.session?.interrupt();
        return;
      case "permission_decision":
        this.settle(message.id, message.decision.decision === "allow" ? "allowed" : "denied", message.decision);
        return;
    }
  }

  /** Server shutdown: withdraw open asks and stop the agent. */
  async close(): Promise<void> {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, "cancelled", { decision: "deny", message: "Kratos is shutting down" });
    }
    await this.session?.stop();
  }

  private start(): AgentSession {
    const session = this.adapter.startSession({
      cwd: this.cwd,
      conversation: { id: this.sessionId, resume: this.agentStarted },
      requestPermission: (request, { signal }) => this.ask(request, signal),
    });
    this.store.markAgentStarted(this.sessionId);
    this.agentStarted = true;
    void this.pump(session);
    return session;
  }

  /** Forward the session's events to the log until it ends; the next prompt then starts afresh. */
  private async pump(session: AgentSession): Promise<void> {
    try {
      for await (const event of session.events) this.publish({ type: "agent_event", event });
    } catch (err) {
      this.publish({ type: "error", message: `Agent session failed: ${String(err)}` });
    } finally {
      if (this.session === session) this.session = undefined;
    }
  }

  /** Called by the adapter before a tool runs: publish the ask, wait for a tab (or a withdrawal). */
  private ask(request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
    const id = randomUUID();
    const decision = new Promise<PermissionDecision>((resolve) => this.pending.set(id, resolve));
    this.publish({ type: "permission_request", id, request });
    signal.addEventListener(
      "abort",
      () => this.settle(id, "cancelled", { decision: "deny", message: "The agent withdrew this request" }),
      { once: true },
    );
    return decision;
  }

  /** Resolve an ask once; unknown or already-settled ids are ignored (first decision wins). */
  private settle(id: string, outcome: Outcome, decision: PermissionDecision): void {
    const resolve = this.pending.get(id);
    if (!resolve) return;
    this.pending.delete(id);
    this.publish({ type: "permission_resolved", id, outcome });
    resolve(decision);
  }

  private publish(message: ServerMessage): void {
    this.log.push(message);
    this.store.append(this.sessionId, message);
    for (const send of this.tabs) send(message);
  }
}

/** Ids of permission requests in the log that never got a permission_resolved. */
function unresolvedAsks(log: ServerMessage[]): string[] {
  const open = new Set<string>();
  for (const message of log) {
    if (message.type === "permission_request") open.add(message.id);
    else if (message.type === "permission_resolved") open.delete(message.id);
  }
  return [...open];
}
