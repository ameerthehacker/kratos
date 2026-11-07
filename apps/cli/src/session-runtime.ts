import { randomUUID } from "node:crypto";
import type {
  AgentAdapter,
  AgentSession,
  PermissionDecision,
  PermissionRequest,
  ServerMessage,
  SessionSummary,
} from "@kratos/core";
import type { Logger } from "./logger.js";
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
  /** The model this session runs with; null = the agent's default (D43). */
  private model: string | null;
  /** The effort level chosen for this session; null = never chosen (D51). */
  private effortChoice: string | null;
  /** The level the agent last said it really uses; undefined = not asked since the last change. */
  private effortInUse: string | null | undefined;
  private session: AgentSession | undefined;
  /** A prompt was sent and its turn hasn't ended yet. */
  private turnOpen = false;
  private readonly logger: Logger;

  constructor(
    readonly id: string,
    private readonly deps: {
      adapter: AgentAdapter;
      cwd: string;
      store: SessionStore;
      log: Logger;
      onMessage: (message: ServerMessage) => void;
      onChange: () => void;
    },
  ) {
    this.logger = deps.log.child({ component: "session", session: id });
    const stored = deps.store.get(id);
    if (!stored) throw new Error(`Unknown session ${id}`);
    this.agentStarted = stored.agentStartedAt !== null;
    this.model = stored.model;
    this.effortChoice = stored.effort;
    this.log = deps.store.load(id);
    // Asks left open by a previous run can't be answered: the agent process that asked is gone.
    for (const askId of unresolvedAsks(this.log)) {
      this.publish({ type: "permission_resolved", id: askId, outcome: "cancelled" }, { activity: false });
    }
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

  /** The effort level for the session list: what the agent really uses if it has said, else the
   * one chosen; null = not known (or the model has none). D51. */
  get effort(): string | null {
    return this.effortInUse !== undefined ? this.effortInUse : this.effortChoice;
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

  /** Use another model from now on (null = the agent's default): switched live if the agent is
   * running, else at its next start. */
  setModel(model: string | null): void {
    this.model = model;
    this.logger.info({ model, live: this.session !== undefined }, "model set");
    this.deps.store.setModel(this.id, model);
    // The agent's effort default moves with the model, and a level the new model lacks gets
    // clamped: ask again once the switch is confirmed (D51).
    this.effortInUse = undefined;
    const session = this.session;
    session?.setModel(model).then(() => this.readEffort(session), this.reportFailure("Switching model"));
    this.deps.onChange();
  }

  /** Use another effort level (D51): switched live if the agent is running — kept only if the
   * agent accepts it — else stored and passed at its next start. */
  setEffort(effort: string): void {
    const session = this.session;
    this.logger.info({ effort, live: session !== undefined }, "effort set");
    if (!session) {
      this.keepEffort(effort);
      return;
    }
    session.setEffort(effort).then(() => {
      this.keepEffort(effort);
      this.readEffort(session);
    }, this.reportFailure("Switching effort"));
  }

  private keepEffort(effort: string): void {
    this.effortChoice = effort;
    this.effortInUse = undefined;
    this.deps.store.setEffort(this.id, effort);
    this.deps.onChange();
  }

  /** Ask the agent which effort level it really uses, and show it. Not worth an error in the
   * conversation if it can't say: the list just keeps showing the chosen level. */
  private readEffort(session: AgentSession): void {
    session.effort().then(
      (effort) => {
        if (this.session !== session) return; // the agent ended meanwhile
        this.effortInUse = effort;
        this.logger.debug({ effort }, "effort in use");
        this.deps.onChange();
      },
      (err) => this.logger.warn({ err }, "could not read the effort level in use"),
    );
  }

  /** Answer one of this session's asks. Returns false if the ask isn't (or no longer) ours. */
  decide(askId: string, decision: PermissionDecision): boolean {
    return this.settle(askId, decision.decision === "allow" ? "allowed" : "denied", decision);
  }

  /** Server shutdown: withdraw open asks and stop the agent. */
  async close(): Promise<void> {
    for (const askId of [...this.pending.keys()]) {
      this.settle(askId, "cancelled", { decision: "deny", message: "Kratos is shutting down" }, { activity: false });
    }
    await this.session?.stop();
  }

  private start(): AgentSession {
    const session = this.deps.adapter.startSession({
      cwd: this.deps.cwd,
      conversation: { id: this.id, resume: this.agentStarted },
      model: this.model ?? undefined,
      effort: this.effortChoice ?? undefined,
      requestPermission: (request, { signal }) => this.ask(request, signal),
    });
    this.logger.info(
      { model: this.model ?? "(agent default)", effort: this.effortChoice ?? "(agent default)", resume: this.agentStarted },
      "agent started",
    );
    this.deps.store.markAgentStarted(this.id);
    this.agentStarted = true;
    void this.pump(session);
    this.session = session;
    this.readEffort(session);
    return session;
  }

  /** Forward the agent's events to the log until it ends; the next prompt then starts afresh. */
  private async pump(session: AgentSession): Promise<void> {
    try {
      for await (const event of session.events) {
        this.publish({ type: "agent_event", event });
        if (event.kind === "turn_end") {
          this.logger.debug({ event }, "turn ended");
          this.turnOpen = false;
          this.deps.onChange();
        }
      }
      this.logger.info("agent ended");
    } catch (err) {
      this.logger.error({ err }, "agent session failed");
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
    this.logger.debug({ ask: askId, tool: request.tool }, "permission asked");
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
  private settle(askId: string, outcome: Outcome, decision: PermissionDecision, options?: { activity: false }): boolean {
    const resolve = this.pending.get(askId);
    if (!resolve) return false;
    this.pending.delete(askId);
    this.logger.debug({ ask: askId, outcome }, "permission settled");
    this.publish({ type: "permission_resolved", id: askId, outcome }, options);
    resolve(decision);
    this.deps.onChange();
    return true;
  }

  /** A fire-and-forget agent call failed: report it instead of crashing the server with an
   * unhandled rejection (Node's default). */
  private reportFailure(what: string) {
    return (err: unknown) => {
      this.logger.warn({ err }, `${what} failed`);
      this.publish({ type: "error", message: `${what} failed: ${String(err)}` });
    };
  }

  /** `activity: false` = Kratos housekeeping (shutdown/restart cleanup): logged, but it doesn't
   * make the session "recently active". */
  private publish(message: ServerMessage, options?: { activity: false }): void {
    this.log.push(message);
    this.deps.store.append(this.id, message, options);
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
