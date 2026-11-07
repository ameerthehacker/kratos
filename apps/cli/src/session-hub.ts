import {
  checkAttachmentSet,
  classifyAttachment,
  type AgentAdapter,
  type AgentAttachment,
  type AttachmentUpload,
  type ChangedFile,
  type ClientMessage,
  type Harness,
  type ServerMessage,
} from "@kratos/core";
import { memoryFiles, type AttachmentFiles } from "./attachment-files.js";
import type { Snapshots } from "./changes/git-snapshots.js";
import { silentLogger, type Logger } from "./logger.js";
import { SessionRuntime } from "./session-runtime.js";
import type { SessionStore, StoredSnapshot } from "./store/store.js";

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
  private readonly idleWaiters = new Set<() => void>();
  /** Set while an update installs (3u5c): new turns would be cut off by the restart. */
  private held = false;
  /** Which session each connected tab is viewing. */
  private readonly views = new Map<Send, string>();

  /** Harnesses and their models (D43); empty until the agent has reported its models. */
  private harnesses: Harness[] = [];
  private readonly log: Logger;
  /** Sessions log as their own component, so they get the root logger, not the hub's child. */
  private readonly rootLog: Logger;

  constructor(
    private readonly adapter: AgentAdapter,
    private readonly cwd: string,
    private readonly store: SessionStore,
    /** Kratos's logger (D44); default: silent. */
    log: Logger = silentLogger,
    /** Where attachment bytes go (D55); default: in memory. */
    private readonly files: AttachmentFiles = memoryFiles(),
    /** Snapshots for reviewing changes (3v1, D65); none = review unavailable. */
    private readonly snapshots?: Snapshots,
  ) {
    this.rootLog = log;
    this.log = log.child({ component: "hub" });
    this.loadHarnesses();
  }

  /** A tab connected: show it the most recent session, the session list and the harnesses. */
  connect(send: Send): Tab {
    this.view(send, this.store.latestOrCreate(this.cwd, this.adapter.id).id);
    send(this.sessionList());
    if (this.harnesses.length > 0) send({ type: "harnesses", list: this.harnesses });
    return {
      receive: (message) => this.receive(send, message),
      disconnect: () => this.views.delete(send),
    };
  }

  /** Sessions whose agent is mid-turn (working, or waiting on you) or has prompts queued. */
  get busyCount(): number {
    return [...this.runtimes.values()].filter((runtime) => runtime.status !== "idle" || runtime.queuedCount > 0).length;
  }

  /** Refuse new prompts (3u5c: from installing an update to the restart), or allow them again. */
  holdNewTurns(on: boolean): void {
    this.held = on;
  }

  /** Resolves once no session is busy — at once if none is (3u5c: restart only then). */
  whenIdle(): Promise<void> {
    if (this.busyCount === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  /** Server shutdown: withdraw every session's open asks and stop every agent. */
  async close(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.close()));
  }

  private receive(send: Send, message: ClientMessage): void {
    const viewing = this.runtime(this.views.get(send)!);
    switch (message.type) {
      case "prompt": {
        if (this.held) {
          send({ type: "error", message: "Kratos is installing an update and restarts in a moment. Send this again once it's back." });
          return;
        }
        if (message.harness && message.harness !== this.adapter.id) {
          send({ type: "error", message: `Unknown harness ${message.harness}` });
          return;
        }
        // Checked before anything starts: a refused mode must not start a session in another one.
        if (message.permissionMode && !this.modeAllowed(send, message.permissionMode, message.confirmDangerous)) return;
        // Same for files (D55): a refused one means nothing is sent.
        const files = this.checkAttachments(send, message.attachments ?? []);
        if (!files) return;
        // From Home: new work gets a new session, unless the viewed one is still empty anyway.
        // Whatever this tab was viewing keeps running (D41).
        let target = viewing;
        if (message.newSession && viewing.hasPrompts) {
          target = this.runtime(this.store.create(this.cwd, this.adapter.id).id);
          this.log.info({ session: target.id }, "new session");
          this.view(send, target.id);
        }
        // The model chosen on Home applies to the session this prompt starts (D43).
        if (!target.hasPrompts && message.model) target.setModel(message.model);
        if (!target.hasPrompts && message.effort) target.setEffort(message.effort);
        if (!target.hasPrompts && message.permissionMode) target.setPermissionMode(message.permissionMode);
        // New work on a done session means it isn't done (owner, 3d2).
        if (this.store.get(target.id)?.doneAt) this.store.setDone(target.id, false);
        target.prompt(message.text, files, { sendNow: message.sendNow });
        return;
      }
      case "set_model":
        viewing.setModel(message.model);
        return;
      case "set_effort":
        viewing.setEffort(message.effort);
        return;
      case "set_permission_mode":
        if (this.modeAllowed(send, message.mode, message.confirmDangerous)) viewing.setPermissionMode(message.mode);
        return;
      case "open_session":
        if (this.store.get(message.id)?.projectDir === this.cwd) this.view(send, message.id);
        else send({ type: "error", message: `No session ${message.id} in this project` });
        return;
      case "set_done":
        if (!this.inProject(send, message.id)) return;
        this.store.setDone(message.id, message.done);
        this.log.info({ session: message.id, done: message.done }, message.done ? "marked done" : "reopened");
        this.broadcastSessionList();
        return;
      case "interrupt":
        // Stop with a queue stops everything; the dropped prompts' text comes back to this tab (D56).
        viewing.interrupt((text) => send({ type: "prompts_returned", text }));
        return;
      case "remove_queued":
        for (const runtime of this.runtimes.values()) if (runtime.removeQueued(message.id)) return;
        return; // already read or removed: nothing to do
      case "send_now":
        for (const runtime of this.runtimes.values()) if (runtime.sendNow(message.id)) return;
        return; // already read or removed, or a Send now is already under way
      case "question_answer": {
        // Question ids are unique across sessions: the owner checks and takes the answer (D54).
        // Already settled (another tab answered first, or the agent withdrew it): nothing to do,
        // like a late permission decision — every tab gets question_resolved anyway.
        const owner = [...this.runtimes.values()].find((runtime) => runtime.hasQuestion(message.id));
        const problem = owner?.answerQuestion(message.id, message.reply);
        if (problem) send({ type: "error", message: `Couldn't send your answer: ${problem}` });
        return;
      }
      case "permission_decision":
        // Ask ids are unique across sessions: let the owner take it (first decision wins).
        for (const runtime of this.runtimes.values()) if (runtime.decide(message.id, message.decision)) return;
        return;
      case "get_changes":
        if (!this.inProject(send, message.sessionId)) return;
        void this.changes(message.sessionId)
          .then((changes) => {
            send(changes);
            send({ type: "viewed", sessionId: message.sessionId, files: this.store.viewed(message.sessionId) });
          })
          .catch((err: unknown) => this.log.warn({ err, session: message.sessionId }, "could not send changes"));
        return;
      case "set_viewed":
        if (!this.inProject(send, message.sessionId)) return;
        this.store.setViewed(message.sessionId, message.path, message.version, message.viewed);
        this.broadcast({ type: "viewed", sessionId: message.sessionId, files: this.store.viewed(message.sessionId) });
        return;
      case "ping":
      case "client_log":
      case "open_in":
        return; // handled by the server itself
    }
  }

  /**
   * The files sent with a prompt, decoded and checked against what the harness accepts (D55): each
   * one's kind and size, then count and total. Null (after telling the tab why) if any is refused.
   */
  private checkAttachments(send: Send, uploads: readonly AttachmentUpload[]): AgentAttachment[] | null {
    const policy = this.adapter.attachments;
    const checked = uploads.map((upload) => {
      const file = { name: upload.name, mediaType: upload.mediaType, data: new Uint8Array(Buffer.from(upload.data, "base64")) };
      return { file, result: classifyAttachment(policy, file) };
    });
    const problem =
      checkAttachmentSet(policy, checked.map(({ file }) => file.data.byteLength)) ??
      checked.flatMap(({ result }) => ("error" in result ? [result.error] : []))[0];
    if (problem) {
      send({ type: "error", message: `Couldn't send your prompt: ${problem}` });
      this.log.info({ problem }, "attachments refused");
      return null;
    }
    return checked.flatMap(({ file, result }) => ("error" in result ? [] : [{ ...file, kind: result.kind, mediaType: result.mediaType }]));
  }

  /** An attachment of one of this project's sessions, for `/attachments/:id` (D55); undefined
   * for any other id. */
  readAttachment(id: string): { name: string; kind: AgentAttachment["kind"]; mediaType: string; data: Uint8Array } | undefined {
    const stored = this.store.getAttachment(id);
    if (!stored || this.store.get(stored.sessionId)?.projectDir !== this.cwd) return undefined;
    const data = this.files.read(id);
    return data && { name: stored.name, kind: stored.kind, mediaType: stored.mediaType, data };
  }

  /** What a session changed (3v1, D65): its first snapshot vs the files now, for the files its
   * agent touched — changed during one of its turns (D67). */
  private async changes(sessionId: string): Promise<ServerMessage> {
    const reply = (files: ChangedFile[], unavailable?: string, note?: string): ServerMessage => ({
      type: "changes",
      sessionId,
      files,
      ...(unavailable ? { unavailable } : {}),
      ...(note ? { note } : {}),
    });
    const unrecorded = "Kratos couldn't record the files when this session started";
    if (!this.snapshots) return reply([], "Reviewing changes isn't available here");
    try {
      const taken = this.store.snapshotsOf(sessionId);
      const first = taken[0];
      const now = await this.snapshots.take();
      if (now === null) return reply([], "This project isn't in a git repository, so Kratos can't see what changed");
      if (!first) {
        // No turn yet — or every snapshot so far failed, or the session is older than snapshots.
        return this.store.turnEndedBefore(sessionId) ? reply([], `${unrecorded}, so its changes can't be shown`) : reply([]);
      }
      if (!(await this.snapshots.exists(first.tree))) return reply([], "This session's starting snapshot is gone: git cleans up old ones");
      const working = (this.runtimes.get(sessionId)?.status ?? "idle") !== "idle";
      const files = await this.snapshots.diff(first.tree, now, await this.touched(sessionId, taken, now, working));
      // Turns that ended before the first snapshot (its start failed): shown from there on, said so.
      const partial = this.store.turnEndedBefore(sessionId, first);
      this.log.debug({ session: sessionId, files: files.length, partial }, "changes read");
      return reply(files, undefined, partial ? `${unrecorded}, so changes from its earliest turns may be missing` : undefined);
    } catch (err) {
      this.log.warn({ err, session: sessionId }, "could not read changes");
      return reply([], `Couldn't read the changes: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * The paths changed while the agent worked (D67): each pair of snapshots in a row, except a turn's
   * end → the next turn's start (that's you, or another session, between turns), plus the open
   * turn's start → now. A failed snapshot only widens a span, so the agent's edits are never lost —
   * including a queued turn's (it has no start snapshot), whose end failed: a turn that ended in a
   * gap makes it count. Edits by others during a turn still count (until worktrees, D41).
   */
  private async touched(sessionId: string, taken: StoredSnapshot[], now: string, working: boolean): Promise<Set<string>> {
    const spans: Array<[string, string]> = [];
    taken.forEach((snapshot, i) => {
      const next = taken[i + 1];
      if (!next) return;
      const between = snapshot.kind === "turn_end" && next.kind === "turn_start" && !this.store.turnEndedBetween(sessionId, snapshot, next);
      if (!between) spans.push([snapshot.tree, next.tree]);
    });
    const last = taken.at(-1)!;
    if (last.kind === "turn_start" || working || this.store.turnEndedBetween(sessionId, last)) spans.push([last.tree, now]);
    const paths = await Promise.all(spans.filter(([a, b]) => a !== b).map(([a, b]) => this.snapshots!.changedPaths(a, b)));
    return new Set(paths.flat());
  }

  /** Is this one of this project's sessions? Tells the tab when not. */
  private inProject(send: Send, sessionId: string): boolean {
    if (this.store.get(sessionId)?.projectDir === this.cwd) return true;
    send({ type: "error", message: `No session ${sessionId} in this project` });
    return false;
  }

  /** A mode the harness has; a `dangerous` one (Bypass) only with the owner's explicit consent,
   * which only the consent dialog sends (D53). Tells the tab why when not. */
  private modeAllowed(send: Send, id: string, confirmDangerous = false): boolean {
    const mode = this.adapter.permissionModes.find((m) => m.id === id);
    if (!mode) {
      send({ type: "error", message: `${this.adapter.displayName} has no permission mode "${id}"` });
      return false;
    }
    if (mode.dangerous && !confirmDangerous) {
      send({ type: "error", message: `"${mode.label}" turns off permission checks: it needs your explicit consent` });
      this.log.warn({ mode: id }, "dangerous permission mode refused without consent");
      return false;
    }
    return true;
  }

  /** Point a tab at a session: announce it, then replay its log. */
  private view(send: Send, sessionId: string): void {
    const runtime = this.runtime(sessionId);
    this.views.set(send, sessionId);
    send({ type: "session", id: sessionId });
    for (const message of runtime.messages) send(message);
    send({ type: "session_ready", id: sessionId });
  }

  /** The session's runtime, loaded from the store on first use. */
  private runtime(sessionId: string): SessionRuntime {
    let runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      runtime = new SessionRuntime(sessionId, {
        adapter: this.adapter,
        cwd: this.cwd,
        store: this.store,
        files: this.files,
        snapshots: this.snapshots,
        log: this.rootLog,
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
        harness: s.agent,
        model: s.model,
        effort: this.runtimes.get(s.id)?.effort ?? s.effort,
        permissionMode: this.runtimes.get(s.id)?.permissionMode ?? s.permissionMode,
        queued: this.runtimes.get(s.id)?.queuedCount ?? 0,
        done: s.doneAt !== null,
      })),
    };
  }

  private broadcastSessionList(): void {
    this.broadcast(this.sessionList());
    if (this.idleWaiters.size > 0 && this.busyCount === 0) {
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const send of this.views.keys()) send(message);
  }

  /** Ask the agent which models it offers (D43); every tab gets the list as soon as it's known.
   * If the agent can't say, the harness is still listed (its default model works). */
  private loadHarnesses(): void {
    const publish = (models: Harness["models"]) => {
      if (models.length > 0) this.log.info({ harness: this.adapter.id, count: models.length }, "models loaded");
      this.harnesses = [{ id: this.adapter.id, name: this.adapter.displayName, models, permissionModes: [...this.adapter.permissionModes], attachments: this.adapter.attachments }];
      this.broadcast({ type: "harnesses", list: this.harnesses });
    };
    this.adapter.listModels().then(publish, (err) => {
      this.log.warn({ harness: this.adapter.id, err }, "could not list models; only the default model is offered");
      publish([]);
    });
  }
}
