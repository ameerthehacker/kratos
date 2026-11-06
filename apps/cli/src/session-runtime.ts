import { randomUUID } from "node:crypto";
import type {
  AgentAdapter,
  AgentSession,
  PermissionDecision,
  PermissionRequest,
  ServerMessage,
  SessionSummary,
} from "@kratos/core";
import type { SessionStore } from "./store/store.js";

type Outcome = "allowed" | "denied" | "cancelled";

/**
 * One session (D41): its stored log, its agent process, its open permission asks and its live
 * status. Knows nothing about tabs — it reports every new log message via `onMessage` and every
 * status/title change via `onChange`; the SessionHub routes them.
 */
export class SessionRuntime {
  private readonly pending = new Map<string, (decision: PermissionDecision) => void>();
  private readonly log: ServerMessage[];
  /** Has the agent ever been started for this conversation? Then every start must resume (D36). */
  private agentStarted: boolean;
  private session: AgentSession | undefined;
  /** A prompt was sent and its turn hasn't ended yet. */
  private turnOpen = false;

  constructor(
    readonly id: string,
    private readonly deps: {
      adapter: AgentAdapter;
      cwd: string;
      store: SessionStore;
      onMessage: (message: ServerMessage) => void;
      onChange: () => void;
    },
  ) {
    const stored = deps.store.get(id);
    if (!stored) throw new Error(`Unknown session ${id}`);
    this.agentStarted = stored.agentStartedAt !== null;
    this.log = deps.store.load(id);
    // Asks left open by a previous run can't be answered: the agent process that asked is gone.
    for (const askId of unresolvedAsks(this.log)) this.publish({ type: "permission_resolved", id: askId, outcome: "cancelled" });
  }

  /** The log so far, for replaying to a tab that opens this session. */
  get messages(): readonly ServerMessage[] {
    return this.log;
  }

  get hasPrompts(): boolean {
    return this.log.some((m) => m.type === "user_prompt");
  }

  get status(): SessionSummary["status"] {
    return this.pending.size > 0 ? "needs_approval" : this.turnOpen ? "working" : "idle";
  }

  prompt(text: string): void {
    this.deps.store.setTitle(this.id, text);
    this.publish({ type: "user_prompt", text });
    this.turnOpen = true;
    // Start the agent on the first prompt, and again (resuming) after it has ended.
    (this.session ??= this.start()).send(text);
    this.deps.onChange();
  }

  interrupt(): void {
    this.session?.interrupt().catch(this.reportFailure("Interrupt"));
  }

  /** Answer one of this session's asks. Returns false if the ask isn't (or no longer) ours. */
  decide(askId: string, decision: PermissionDecision): boolean {
    return this.settle(askId, decision.decision === "allow" ? "allowed" : "denied", decision);
  }

  /** Server shutdown: withdraw open asks and stop the agent. */
  async close(): Promise<void> {
    for (const askId of [...this.pending.keys()]) {
      this.settle(askId, "cancelled", { decision: "deny", message: "Kratos is shutting down" });
    }
    await this.session?.stop();
  }

  private start(): AgentSession {
    const session = this.deps.adapter.startSession({
      cwd: this.deps.cwd,
      conversation: { id: this.id, resume: this.agentStarted },
      requestPermission: (request, { signal }) => this.ask(request, signal),
    });
    this.deps.store.markAgentStarted(this.id);
    this.agentStarted = true;
    void this.pump(session);
    return session;
  }

  /** Forward the agent's events to the log until it ends; the next prompt then starts afresh. */
  private async pump(session: AgentSession): Promise<void> {
    try {
      for await (const event of session.events) {
        this.publish({ type: "agent_event", event });
        if (event.kind === "turn_end") {
          this.turnOpen = false;
          this.deps.onChange();
        }
      }
    } catch (err) {
      this.publish({ type: "error", message: `Agent session failed: ${String(err)}` });
    } finally {
      if (this.session === session) this.session = undefined;
      if (this.turnOpen) {
        this.turnOpen = false;
        this.deps.onChange();
      }
    }
  }

  /** Called by the adapter before a tool runs: publish the ask, wait for a tab (or a withdrawal). */
  private ask(request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
    const askId = randomUUID();
    const decision = new Promise<PermissionDecision>((resolve) => this.pending.set(askId, resolve));
    this.publish({ type: "permission_request", id: askId, request });
    this.deps.onChange();
    signal.addEventListener(
      "abort",
      () => this.settle(askId, "cancelled", { decision: "deny", message: "The agent withdrew this request" }),
      { once: true },
    );
    return decision;
  }

  /** Resolve an ask once; unknown or already-settled ids are ignored (first decision wins). */
  private settle(askId: string, outcome: Outcome, decision: PermissionDecision): boolean {
    const resolve = this.pending.get(askId);
    if (!resolve) return false;
    this.pending.delete(askId);
    this.publish({ type: "permission_resolved", id: askId, outcome });
    resolve(decision);
    this.deps.onChange();
    return true;
  }

  /** A fire-and-forget agent call failed: report it instead of crashing the server with an
   * unhandled rejection (Node's default). */
  private reportFailure(what: string) {
    return (err: unknown) => this.publish({ type: "error", message: `${what} failed: ${String(err)}` });
  }

  private publish(message: ServerMessage): void {
    this.log.push(message);
    this.deps.store.append(this.id, message);
    this.deps.onMessage(message);
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
