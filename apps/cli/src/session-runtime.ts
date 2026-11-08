import { randomUUID } from "node:crypto";
import {
  checkQuestionReply,
  type AgentAdapter,
  type AgentAttachment,
  type AgentEvent,
  type AttachmentRef,
  type AgentSession,
  type PermissionDecision,
  type PermissionRequest,
  type QuestionReply,
  type QuestionRequest,
  type ServerMessage,
  type SessionSummary,
} from "@kratos/core";
import type { AttachmentFiles } from "./attachment-files.js";
import type { Snapshots } from "./changes/git-snapshots.js";
import type { Logger } from "./logger.js";
import type { SessionStore } from "./store/store.js";

type Outcome = "allowed" | "denied" | "cancelled";

/**
 * The agent's turn (D68): idle, or running with the steps (tool calls) it has run so far. Step
 * ids only mean something while their turn runs, so they live in it and go when it ends.
 */
type Turn =
  | { state: "idle" }
  | {
      state: "running";
      /** `queue`: the agent started it itself, with queued prompts (not a prompt sent while idle):
       * others it takes before any step finishes came with them, as the next turn. */
      startedBy: "prompt" | "queue";
      /** The last step that finished: a prompt read now follows it. */
      lastStep?: string;
      /** The step running now, if any: what Send now stops. */
      runningStep?: string;
    };

/**
 * One session (D41): its stored log, its agent process, its open permission asks and its live
 * status. Knows nothing about tabs — it reports every new log message via `onMessage` and every
 * status/title change via `onChange`; the SessionHub routes them.
 */
export class SessionRuntime {
  private readonly pending = new Map<string, (decision: PermissionDecision) => void>();
  /** Prompts sent while the agent works that it hasn't read yet (D56), in the order sent: their
   * files (to send again) and the id the agent knows them by (a new one after a re-queue). */
  private readonly queue = new Map<string, { text: string; files: readonly AgentAttachment[]; agentId: string }>();
  /** Agent id → Kratos prompt id, for prompts re-queued under a new agent id (Send now). */
  private readonly agentIds = new Map<string, string>();
  private turn: Turn = { state: "idle" };
  /** Send now in progress (owner: only that prompt goes, D56): the others are withdrawn from the
   * agent (`holding`, still queued for us) and sent again once both the withdrawals are done and
   * the chosen one has been read. */
  private sendingNow: { id: string; stopped?: string; holding: Set<string>; withdrawn: boolean; read: boolean } | undefined;
  /** Stop pressed with a queue (owner, D56): the prompts still out, and the text of the ones it
   * dropped, handed back to the tab that pressed Stop once all are settled. */
  private stopping: { ids: Set<string>; texts: string[]; returnText: (text: string) => void } | undefined;
  /** The agent's open questions (D54): what was asked, and how to answer. */
  private readonly questions = new Map<string, { request: QuestionRequest; resolve: (reply: QuestionReply) => void }>();
  private readonly log: ServerMessage[];
  /** Has the agent ever been started for this conversation? Then every start must resume (D36). */
  private agentStarted: boolean;
  /** The agent is naming the session (3z4). */
  private naming = false;
  /** The model this session runs with; null = the agent's default (D43). */
  private model: string | null;
  /** The effort level chosen for this session; null = never chosen (D51). */
  private effortChoice: string | null;
  /** The level the agent last said it really uses; undefined = not asked since the last change. */
  private effortInUse: string | null | undefined;
  /** The permission mode: chosen, or as the agent last reported it; null = the agent's default (D53). */
  private mode: string | null;
  private session: AgentSession | undefined;
  /** The turn's start snapshot while it's being taken (3v1, D65): prompts reach the agent after it. */
  private snapshotting: Promise<void> | undefined;
  private readonly logger: Logger;

  constructor(
    readonly id: string,
    private readonly deps: {
      adapter: AgentAdapter;
      cwd: string;
      store: SessionStore;
      files: AttachmentFiles;
      /** Records the files at turn boundaries, for reviewing changes (3v1); none = no review. */
      snapshots?: Snapshots;
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
    this.mode = stored.permissionMode;
    this.log = deps.store.load(id);
    // Asks left open by a previous run can't be answered: the agent process that asked is gone.
    for (const askId of unresolvedAsks(this.log)) {
      this.publish({ type: "permission_resolved", id: askId, outcome: "cancelled" }, { activity: false });
    }
    for (const questionId of unresolvedQuestions(this.log)) {
      this.publish({ type: "question_resolved", id: questionId, outcome: "cancelled" }, { activity: false });
    }
    // Same for queued prompts: the agent that held them is gone, they were never read.
    for (const promptId of unreadPrompts(this.log)) {
      this.publish({ type: "prompt_removed", id: promptId, reason: "stopped" }, { activity: false });
    }
  }

  /** The log so far, for replaying to a tab that opens this session. */
  get messages(): readonly ServerMessage[] {
    return this.log;
  }

  get hasPrompts(): boolean {
    return this.log.some((m) => m.type === "user_prompt");
  }

  /** The agent is naming the session right now (3z4): the title shown may change soon. */
  get titling(): boolean {
    return this.naming;
  }

  get status(): SessionSummary["status"] {
    if (this.questions.size > 0) return "needs_answer";
    return this.pending.size > 0 ? "needs_approval" : this.turn.state === "running" ? "working" : "idle";
  }

  /** The effort level for the session list: what the agent really uses if it has said, else the
   * one chosen; null = not known (or the model has none). D51. */
  get effort(): string | null {
    return this.effortInUse !== undefined ? this.effortInUse : this.effortChoice;
  }

  get permissionMode(): string | null {
    return this.mode;
  }

  /** Prompts waiting in the queue (D56), for "Working · 2 queued". */
  get queuedCount(): number {
    return this.queue.size;
  }

  /** Send a prompt, with files already checked by the hub (D55): their bytes are kept by id, the
   * log gets only what they are. While a turn runs it's queued instead (steering, D56): the agent
   * holds it and reads it at its next step, or as the next turn. */
  prompt(text: string, files: readonly AgentAttachment[] = [], options: { sendNow?: boolean } = {}): void {
    const first = !this.hasPrompts;
    this.deps.store.setTitle(this.id, text); // the first prompt, until the agent names it (3z4)
    const refs = this.storeFiles(files);
    const attachments = refs.length > 0 ? { attachments: refs } : {};
    if (this.session && this.turn.state === "running") {
      const id = randomUUID();
      this.queue.set(id, { text, files, agentId: id });
      this.publish({ type: "prompt_queued", id, text, ...attachments });
      this.logger.info({ prompt: id, queued: this.queue.size }, "prompt queued");
      const session = this.session;
      this.toAgent(() => {
        session.send(text, files, { id });
        if (options.sendNow) this.sendNow(id); // ⌘↵: straight past the queue
      });
      this.deps.onChange();
      return;
    }
    this.publish({ type: "user_prompt", text, ...attachments });
    this.turn = { state: "running", startedBy: "prompt" };
    this.startSnapshot();
    // Start the agent on the first prompt, and again (resuming) after it has ended.
    const session = (this.session ??= this.start());
    this.toAgent(() => session.send(text, files));
    this.deps.onChange();
    if (first) void this.name(text);
  }

  /** Name the session again, from the conversation so far (3z4: the owner's Regenerate). */
  regenerateTitle(): void {
    const prompts = this.log.flatMap((m) => (m.type === "user_prompt" ? [`User: ${m.text}`] : []));
    if (prompts.length === 0) return;
    const reply = [...this.log].reverse().find((m) => m.type === "agent_event" && m.event.kind === "text");
    const last = reply?.type === "agent_event" && reply.event.kind === "text" ? [`Agent: ${reply.event.text}`] : [];
    // The first prompt says what it set out to do, the latest ones where it went; trimmed, it's for a title.
    const about = [...prompts.slice(0, 1), ...prompts.slice(1).slice(-3), ...last].join("\n");
    void this.name(about);
  }

  /**
   * Have the agent's fast model name the session (3z4), given what it's about. Starts (resumes)
   * the agent if none runs; one that can't name sessions leaves the title as it is, and so does a
   * failure (logged), and so does the owner renaming it meanwhile. One at a time; what it's
   * about is trimmed to 2000 characters, it's only for a title.
   */
  private async name(about: string): Promise<void> {
    if (this.naming) return;
    const session = (this.session ??= this.start());
    if (!session.title) return;
    this.naming = true;
    this.deps.onChange();
    const before = this.deps.store.get(this.id)?.title ?? null;
    try {
      const title = (await session.title(about.slice(0, 2000))).trim().slice(0, 80);
      // Renamed by the owner meanwhile: theirs wins over the agent's.
      if (this.deps.store.get(this.id)?.title !== before) return;
      if (title) this.deps.store.renameSession(this.id, title);
      this.logger.info({ title }, "session named");
    } catch (err) {
      this.logger.warn({ err }, "could not name the session");
    } finally {
      this.naming = false;
      this.deps.onChange();
    }
  }

  /** Stop the turn. With prompts queued, Stop stops everything (owner, D56): the queue is
   * withdrawn too, and `returnText` gets the dropped prompts' text for the composer. */
  interrupt(returnText?: (text: string) => void): void {
    const cancelQueued = this.queue.size > 0;
    if (cancelQueued && returnText) this.stopping = { ids: new Set(this.queue.keys()), texts: [], returnText };
    // After any prompt still waiting for its snapshot: else the agent hears Stop first, then runs it.
    this.toAgent(() => this.session?.interrupt({ cancelQueued }).catch(this.reportFailure("Interrupt")));
  }

  /** Take a queued prompt back before the agent reads it (D56). False if it isn't queued here. */
  removeQueued(promptId: string): boolean {
    const queued = this.queue.get(promptId);
    if (!queued) return false;
    // Settled by the agent's `cancelled` (or, if it was just read, by its `started`). After its
    // send, which may still wait for the turn's snapshot: the agent can't withdraw what it hasn't got.
    this.toAgent(() => this.session?.cancelPrompt(queued.agentId).catch(this.reportFailure("Removing a queued prompt")));
    return true;
  }

  /**
   * Send now (owner, D56): stop the running step and have the agent read this queued prompt right
   * away; the others stay queued. The agent's own Send now delivers everything it holds, so the
   * others are withdrawn first and sent again once this one is read. False if it isn't queued here.
   */
  sendNow(promptId: string): boolean {
    const chosen = this.queue.get(promptId);
    const session = this.session;
    if (!chosen || !session || this.sendingNow) return false;
    const others = [...this.queue.keys()].filter((id) => id !== promptId);
    const stopped = this.turn.state === "running" ? this.turn.runningStep : undefined;
    const now = { id: promptId, stopped, holding: new Set(others), withdrawn: false, read: false };
    this.sendingNow = now;
    this.logger.info({ prompt: promptId, holding: others.length, stopped: now.stopped }, "send now");
    void (async () => {
      await this.snapshotting; // the prompts it moves may still wait for the turn's snapshot
      const withdrawn = await Promise.all(others.map((id) => session.cancelPrompt(this.queue.get(id)!.agentId).catch(() => false)));
      // One the agent took meanwhile is simply read: its own `started` settles it.
      others.forEach((id, i) => !withdrawn[i] && now.holding.delete(id));
      now.withdrawn = true;
      await session.sendNow(chosen.agentId);
      this.requeueHeld();
    })().catch(this.reportFailure("Sending now"));
    return true;
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

  /** Use another permission mode (D53): switched live if the agent runs — kept as the mode the
   * agent says it applied — else stored and passed at its next start. Checks (known mode, consent
   * for dangerous ones) are the hub's. */
  setPermissionMode(mode: string): void {
    const session = this.session;
    this.logger.info({ mode, live: session !== undefined }, "permission mode set");
    if (!session) {
      this.keepMode(mode);
      return;
    }
    session.setPermissionMode(mode).then((applied) => this.keepMode(applied), this.reportFailure("Switching permission mode"));
  }

  private keepMode(mode: string): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.deps.store.setPermissionMode(this.id, mode);
    this.deps.onChange();
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

  /** Is this one of this session's open questions? */
  hasQuestion(questionId: string): boolean {
    return this.questions.has(questionId);
  }

  /** Answer one of this session's questions (D54); the first valid answer wins. Returns why the
   * reply doesn't fit, or null once it's sent to the agent. */
  answerQuestion(questionId: string, reply: QuestionReply): string | null {
    const open = this.questions.get(questionId);
    if (!open) return "This question is no longer open";
    const problem = checkQuestionReply(open.request, reply);
    if (problem) return problem;
    this.settleQuestion(questionId, reply.outcome, reply);
    return null;
  }

  /** Server shutdown: withdraw open asks and questions, and stop the agent. */
  async close(): Promise<void> {
    for (const askId of [...this.pending.keys()]) {
      this.settle(askId, "cancelled", { decision: "deny", message: "Kratos is shutting down" }, { activity: false });
    }
    for (const questionId of [...this.questions.keys()]) {
      this.settleQuestion(questionId, "cancelled", { outcome: "skipped" }, { activity: false });
    }
    this.dropQueue({ activity: false });
    await this.session?.stop();
  }

  private start(): AgentSession {
    const session = this.deps.adapter.startSession({
      cwd: this.deps.cwd,
      conversation: { id: this.id, resume: this.agentStarted },
      model: this.model ?? undefined,
      effort: this.effortChoice ?? undefined,
      permissionMode: this.mode ?? undefined,
      requestPermission: (request, { signal }) => this.ask(request, signal),
      askQuestions: (request, { signal }) => this.askQuestions(request, signal),
    });
    this.logger.info(
      {
        model: this.model ?? "(agent default)",
        effort: this.effortChoice ?? "(agent default)",
        permissionMode: this.mode ?? "(agent default)",
        resume: this.agentStarted,
      },
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
        // What became of a queued prompt (D56): turned into prompt_read / prompt_removed, not logged.
        if (event.kind === "prompt_state") {
          this.promptState(event.id, event.state);
          continue;
        }
        this.publish({ type: "agent_event", event: event.kind === "tool_result" && event.images ? this.storeImages(event) : event });
        if (this.turn.state === "running") {
          if (event.kind === "tool_call") this.turn.runningStep = event.id;
          if (event.kind === "tool_result") Object.assign(this.turn, { lastStep: event.id, runningStep: undefined });
        }
        // The agent changed mode — on our request or on its own (leaving plan mode): follow it.
        if (event.kind === "permission_mode") {
          this.logger.info({ mode: event.mode }, "permission mode changed");
          this.keepMode(event.mode);
        }
        if (event.kind === "turn_end") {
          this.logger.debug({ event }, "turn ended");
          this.turn = { state: "idle" };
          void this.takeSnapshot("turn_end");
          this.deps.onChange();
        }
      }
      this.logger.info("agent ended");
    } catch (err) {
      this.logger.error({ err }, "agent session failed");
      this.publish({ type: "error", message: `Agent session failed: ${String(err)}` });
    } finally {
      if (this.session === session) this.session = undefined;
      this.dropQueue(); // the agent that held them is gone
      if (this.turn.state === "running") {
        this.turn = { state: "idle" };
        this.deps.onChange();
      }
    }
  }

  /**
   * A queued prompt's news from the agent (D56). `started`: read — mid-turn at a step boundary
   * (after the step that just finished), or as a new turn once the last ended (the turn is then
   * open again). `cancelled`: left the queue unread — removed, or dropped by Stop.
   */
  private promptState(agentId: string, state: "queued" | "started" | "completed" | "cancelled"): void {
    const id = this.agentIds.get(agentId) ?? agentId;
    const queued = this.queue.get(id);
    if (!queued || queued.agentId !== agentId || (state !== "started" && state !== "cancelled")) return;
    // Withdrawn by Send now to go again after it: still queued as far as anyone can see.
    if (state === "cancelled" && this.sendingNow?.holding.has(id)) return;
    this.queue.delete(id);
    if (state === "started") {
      const now = this.sendingNow?.id === id ? this.sendingNow : undefined;
      const turn = this.turn;
      // Read at a step boundary only if a step has finished in this turn; prompts the agent takes
      // together to start a new turn are all `next_turn` (real CLI: B and D started at once).
      const atStep = turn.state === "running" && (turn.startedBy === "prompt" || !!turn.lastStep);
      const how = now ? "now" : atStep ? "step" : "next_turn";
      const after = how === "step" && turn.state === "running" ? turn.lastStep : undefined;
      this.publish({
        type: "prompt_read",
        id,
        how,
        ...(after ? { after } : {}),
        ...(now?.stopped ? { stopped: now.stopped } : {}),
      });
      if (now) now.read = true;
      this.logger.info({ prompt: id, how }, "queued prompt read");
      // Read with no turn running: the agent starts one itself, with this prompt.
      if (turn.state === "idle") this.turn = { state: "running", startedBy: "queue" };
      this.stopping?.ids.delete(id);
    } else {
      const stopped = this.stopping?.ids.delete(id) ?? false;
      if (stopped) this.stopping!.texts.push(queued.text);
      this.publish({ type: "prompt_removed", id, reason: stopped ? "stopped" : "removed" });
      this.logger.info({ prompt: id, stopped }, "queued prompt removed");
    }
    this.returnStopped();
    this.requeueHeld();
    this.deps.onChange();
  }

  /** Send now's last step (D56): once the others are withdrawn and the chosen one is read, send
   * the others again under new agent ids — same Kratos ids, same place in the queue. */
  private requeueHeld(): void {
    const now = this.sendingNow;
    if (!now || !now.withdrawn || !now.read) return;
    this.sendingNow = undefined;
    for (const id of now.holding) {
      const queued = this.queue.get(id);
      if (!queued || !this.session) continue;
      queued.agentId = randomUUID();
      this.agentIds.set(queued.agentId, id);
      this.session.send(queued.text, queued.files, { id: queued.agentId });
    }
    this.logger.info({ requeued: now.holding.size }, "send now: the rest queued again");
  }

  /** Once every prompt Stop withdrew is settled, hand their text back (owner, D56). */
  private returnStopped(): void {
    if (!this.stopping || this.stopping.ids.size > 0) return;
    if (this.stopping.texts.length > 0) this.stopping.returnText(this.stopping.texts.join("\n\n"));
    this.stopping = undefined;
  }

  /** The agent ended (or Kratos shuts down) with prompts still queued: they'll never be read. */
  private dropQueue(options?: { activity: false }): void {
    for (const [id, { text }] of this.queue) {
      if (this.stopping?.ids.delete(id)) this.stopping.texts.push(text);
      this.publish({ type: "prompt_removed", id, reason: "stopped" }, options);
    }
    if (this.queue.size === 0) return;
    this.queue.clear();
    this.returnStopped();
    this.deps.onChange();
  }

  /** A turn starts: record the files before the agent can change them (3v1, D65). Prompts sent
   * meanwhile wait for it (`toAgent`); the agent process itself starts right away. A turn the
   * agent starts by itself (queued prompts) needs none: the last turn's end snapshot is its start. */
  private startSnapshot(): void {
    if (!this.deps.snapshots) return;
    const taking: Promise<void> = this.takeSnapshot("turn_start").finally(() => {
      if (this.snapshotting === taking) this.snapshotting = undefined;
    });
    this.snapshotting = taking;
  }

  /** Send to the agent once the turn's start snapshot is recorded — at once if none is pending,
   * in the order called. Everything about a prompt (Stop, remove, Send now) goes this way too, so
   * the agent never hears of it before the prompt itself. */
  private toAgent(send: () => unknown): void {
    if (this.snapshotting) void this.snapshotting.then(send);
    else send();
  }

  /** Record the files now in the store. Never fails the turn: a git problem is logged, and the
   * review then has less to show. */
  private async takeSnapshot(kind: "turn_start" | "turn_end"): Promise<void> {
    if (!this.deps.snapshots) return;
    const started = Date.now();
    // Its place in the log is now, when it's asked for: after the prompt that starts the turn, or
    // the turn_end it follows — whatever is logged while git works comes after it.
    const logSeq = this.log.length;
    try {
      const tree = await this.deps.snapshots.take();
      if (tree === null) return; // not a git repository
      this.deps.store.addSnapshot(this.id, kind, tree, logSeq);
      this.logger.debug({ kind, tree, ms: Date.now() - started }, "snapshot taken");
    } catch (err) {
      this.logger.warn({ err, kind }, "snapshot failed");
    }
  }

  /** Keep the images a tool returned (3z) like a prompt's files: the log gets refs, never bytes. */
  private storeImages(event: Extract<AgentEvent, { kind: "tool_result" }>): AgentEvent {
    const { images = [], ...rest } = event;
    const files = images.map((image, i): AgentAttachment => {
      const name = `image${images.length > 1 ? `-${i + 1}` : ""}.${image.mediaType.split("/")[1]}`;
      return { name, kind: "image", mediaType: image.mediaType, data: Buffer.from(image.base64, "base64") };
    });
    return { ...rest, attachments: this.storeFiles(files) };
  }

  /** Keep a prompt's files (D55): bytes by id, the log gets only what they are. */
  private storeFiles(files: readonly AgentAttachment[]): AttachmentRef[] {
    const refs = files.map((file) => {
      const id = randomUUID();
      this.deps.files.write(id, file.data);
      const { name, kind, mediaType } = file;
      this.deps.store.addAttachment({ id, sessionId: this.id, name, kind, mediaType, size: file.data.byteLength });
      return { id, name, kind, mediaType, size: file.data.byteLength };
    });
    if (refs.length > 0) this.logger.info({ count: refs.length, bytes: refs.reduce((n, r) => n + r.size, 0) }, "attachments stored");
    return refs;
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

  /** Called by the adapter when the agent asks the owner questions: publish them, wait for a tab
   * to answer (or the agent to withdraw them — then the agent hears "skipped", unread). */
  private askQuestions(request: QuestionRequest, signal: AbortSignal): Promise<QuestionReply> {
    const questionId = randomUUID();
    const reply = new Promise<QuestionReply>((resolve) => this.questions.set(questionId, { request, resolve }));
    this.logger.debug({ question: questionId, count: request.questions.length }, "questions asked");
    this.publish({ type: "question_request", id: questionId, request });
    this.deps.onChange();
    signal.addEventListener("abort", () => this.settleQuestion(questionId, "cancelled", { outcome: "skipped" }), { once: true });
    return reply;
  }

  /** Settle questions once (first answer wins). The log keeps the answers, so a replay can show
   * them; "cancelled" = withdrawn or never answered. */
  private settleQuestion(questionId: string, outcome: "answered" | "skipped" | "cancelled", reply: QuestionReply, options?: { activity: false }): void {
    const open = this.questions.get(questionId);
    if (!open) return;
    this.questions.delete(questionId);
    this.logger.debug({ question: questionId, outcome }, "questions settled");
    this.publish(
      { type: "question_resolved", id: questionId, outcome, ...(reply.outcome === "answered" ? { answers: reply.answers } : {}) },
      options,
    );
    open.resolve(reply);
    this.deps.onChange();
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

/** Ids of prompts queued in the log that were never read or removed (D56). */
function unreadPrompts(log: ServerMessage[]): string[] {
  const open = new Set<string>();
  for (const message of log) {
    if (message.type === "prompt_queued") open.add(message.id);
    else if (message.type === "prompt_read" || message.type === "prompt_removed") open.delete(message.id);
  }
  return [...open];
}

/** Ids of question requests in the log that never got a question_resolved. */
function unresolvedQuestions(log: ServerMessage[]): string[] {
  const open = new Set<string>();
  for (const message of log) {
    if (message.type === "question_request") open.add(message.id);
    else if (message.type === "question_resolved") open.delete(message.id);
  }
  return [...open];
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
