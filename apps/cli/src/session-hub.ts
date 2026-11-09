import {
  checkAttachmentSet,
  classifyAttachment,
  type AgentAdapter,
  type AgentAttachment,
  type AttachmentUpload,
  type ChangedFile,
  type ClientMessage,
  type Harness,
  type PlanAction,
  type PlanOwner,
  type PlanSave,
  type ServerMessage,
} from "@kratos/core";
import { slug } from "github-slugger";
import { memoryFiles, type AttachmentFiles } from "./attachment-files.js";
import type { Snapshots } from "./changes/git-snapshots.js";
import { silentLogger, type Logger } from "./logger.js";
import { SessionRuntime } from "./session-runtime.js";
import type { Filing, SessionFeatureOps } from "./kratos-tools.js";
import { applyPlanAction, parsePlan, planTemplate, reconcileAgentEdit } from "./plans/plan-file.js";
import { movedNote, planInstructions, type PlanPaths } from "./plans/plan-instructions.js";
import { memoryPlans, type PlanFiles } from "./plans/plan-files.js";
import type { SessionStore, StoredSnapshot } from "./store/store.js";

type Send = (message: ServerMessage) => void;

/** One of a live turn's plans (4p3, 4p4a). */
interface TurnPlan {
  /** For its chat's record: the plan as the turn started, with your changes since. */
  shown: string | undefined;
  /** What its agent's edit is held against: your plan. As `shown`, except that a change of yours
   * mid-turn holds the agent's edit so far right then, and goes on top of it. */
  base: string | undefined;
  /** Put back when its edit was held mid-turn: said at its end with what that puts back. */
  undone: string[];
  intentChanged: boolean;
}

/** A turn whose plans are held at its end (4p3): running, or ending (being settled). */
interface LiveTurn {
  sessionId: string;
  plans: Map<string, TurnPlan>;
  ending: boolean;
}

/** Where an approved plan went (4p6a). `moved`: the session became part of the feature for it. */
interface SavedPlan {
  path: string;
  as: PlanSave;
  feature?: string;
  moved: boolean;
}

/** The agent's word with "Approve and build here" (4p6a): Kratos saved the plan, where, and it's the
 * one to work from — its instructions may predate it (a one-off made a feature just now). */
const buildHere = ({ path, as, feature, moved }: SavedPlan) =>
  [
    `Kratos saved this approved plan as ${as === "feature" ? `the feature plan of “${feature}”` : "this session's plan"}, at ${path}.`,
    moved ? `This session is now part of the feature “${feature}”.` : "",
    "Work from that file: mark its steps there as the plan rules say, and don't write the plan again anywhere else.",
  ]
    .filter(Boolean)
    .join(" ");

/** The agent's answer to "Approve, build later" (4p6a): saved, but not now. */
const buildLater = (path: string) =>
  `The owner approved your plan and Kratos saved it to ${path}. Don't start building now: stop here, the owner will start the work later.`;

/** A plan's file, relative to the project, from its folder under `.kratos/`. */
const planFile = (folder: string) => `.kratos/${folder}/plan.md`;

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
  /** Stops the hub hearing plan changes (D79), at close. */
  private readonly unwatchPlans: () => void;
  /** Turns whose plans are held to who-writes-what at their end (4p3), oldest first: running, or
   * ending (being settled). What changed in their plans by then is their edit. */
  private readonly turns: LiveTurn[] = [];
  /** Changes to each plan, one after another (4p4a: yours; 4p3: a turn's end): each reads what the
   * one before wrote. */
  private readonly planActions = new Map<string, Promise<void>>();
  /** Proposed plans being saved for their approval (4p6a): no other answer to them meanwhile —
   * the first decision wins, and a second one mustn't save it again or answer under the save. */
  private readonly approving = new Set<string>();

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
    /** The project's plan files (D79); default: in memory. */
    private readonly plans: PlanFiles = memoryPlans(),
  ) {
    this.rootLog = log;
    this.log = log.child({ component: "hub" });
    this.loadHarnesses();
    this.unwatchPlans = this.plans.onChange((folder, markdown, existed) => this.planChanged(folder, markdown, existed));
  }

  /** A tab connected: show it the features, the session list and the harnesses, then the session
   * it asked for (3y6b) or else the most recent one. That order lets its chat draw once, with the
   * agent's name, instead of again when they arrive. */
  connect(send: Send, sessionId?: string): Tab {
    const shown = sessionId && this.ours(sessionId) ? sessionId : this.store.latestOrCreate(this.cwd, this.adapter.id).id;
    send(this.featureList());
    send(this.sessionList());
    if (this.harnesses.length > 0) send({ type: "harnesses", list: this.harnesses });
    this.view(send, shown);
    return {
      receive: (message) => this.receive(send, message),
      disconnect: () => this.views.delete(send),
    };
  }

  /** Sessions whose agent is mid-turn (working, or waiting on you) or has prompts queued. */
  get busyCount(): number {
    return [...this.runtimes.keys()].filter((id) => this.busy(id)).length;
  }

  private busy(sessionId: string): boolean {
    const runtime = this.runtimes.get(sessionId);
    return runtime !== undefined && (runtime.status !== "idle" || runtime.queuedCount > 0);
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
    this.unwatchPlans();
    await Promise.all([this.plans.close(), ...[...this.runtimes.values()].map((runtime) => runtime.close())]);
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
        // And for the feature (D73): one that's gone or done starts nothing. Only a prompt that
        // starts a session picks one; a later prompt's is ignored, not refused.
        const starts = message.newSession || !viewing.hasPrompts;
        if (starts && !message.newFeatureTitle && message.featureId && !this.featureUsable(send, message.featureId)) return;
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
        // Its feature, new or picked (D73) — only when this prompt starts the session. From Home
        // (`newSession`) none picked means a one-off, also for a reused empty session that had one.
        const featureId = target.hasPrompts
          ? undefined
          : message.newFeatureTitle
            ? this.newFeature(message.newFeatureTitle)
            : (message.featureId ?? (message.newSession ? null : undefined));
        if (featureId !== undefined && featureId !== this.store.get(target.id)?.featureId) {
          this.store.setSessionFeature(target.id, featureId);
          this.broadcast(this.featureList());
        }
        // New work on a done session means it isn't done (owner, 3d2), nor is its feature (D73).
        if (this.store.get(target.id)?.doneAt) this.store.setDone(target.id, false);
        this.reopenFeatureOf(target.id);
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
        if (this.inProject(send, message.id)) this.view(send, message.id);
        return;
      case "set_done":
        if (!this.inProject(send, message.id)) return;
        if (message.done && !this.stopBusy(send, [message.id], message.stop, "It's still working or waiting on you")) return;
        this.store.setDone(message.id, message.done);
        this.log.info({ session: message.id, done: message.done }, message.done ? "marked done" : "reopened");
        // A reopened session can't stay inside a done feature (D73): that reopens too.
        if (!message.done) this.reopenFeatureOf(message.id);
        this.broadcastSessionList();
        return;
      case "regenerate_title":
        if (this.inProject(send, message.sessionId)) this.runtime(message.sessionId).regenerateTitle();
        return;
      case "rename_session":
        if (!this.inProject(send, message.sessionId)) return;
        // An empty session has no title: one would list it in Recent, and its first prompt names it.
        if (this.store.get(message.sessionId)?.title === null) {
          send({ type: "error", message: "Send a first prompt before naming the session" });
          return;
        }
        this.store.renameSession(message.sessionId, message.title);
        this.broadcastSessionList();
        return;
      case "create_feature":
        this.newFeature(message.title);
        this.broadcast(this.featureList());
        return;
      case "rename_feature":
        if (!this.featureInProject(send, message.id)) return;
        this.store.renameFeature(message.id, message.title);
        this.broadcast(this.featureList());
        return;
      case "set_feature_done": {
        if (!this.featureInProject(send, message.id)) return;
        // Done takes its sessions with it, so none may stay busy: an ask would hide in Done.
        const ids = this.store.sessionsOfFeature(message.id).map((s) => s.id);
        if (message.done && !this.stopBusy(send, ids, message.stop, "Some of its sessions are still working or waiting on you")) return;
        this.store.setFeatureDone(message.id, message.done);
        this.log.info({ feature: message.id, done: message.done }, message.done ? "feature marked done" : "feature reopened");
        this.broadcast(this.featureList());
        this.broadcastSessionList();
        return;
      }
      case "get_plan":
        if (!this.planOwnerInProject(send, message.owner)) return;
        send(this.planMessage(message.owner));
        return;
      case "plan_action":
        if (!this.planOwnerInProject(send, message.owner)) return;
        this.onPlan(send, message.owner, (folder) => this.applyAction(send, message.owner, folder, message.action)).catch((err) => {
          this.log.warn({ err, owner: message.owner }, "could not change the plan");
          send({ type: "error", message: `Could not change the plan: ${err instanceof Error ? err.message : err}` });
        });
        return;
      case "save_plan":
        if (!this.planOwnerInProject(send, message.owner)) return;
        this.onPlan(send, message.owner, (folder) => this.savePlan(send, message.owner, folder, message.markdown, message.base)).catch((err) => {
          this.log.warn({ err, owner: message.owner }, "could not save the plan");
          send({ type: "error", message: `Could not save the plan: ${err instanceof Error ? err.message : err}` });
        });
        return;
      case "start_plan":
        if (!this.planOwnerInProject(send, message.owner)) return;
        this.startPlan(send, message.owner).catch((err) => {
          this.log.warn({ err, owner: message.owner }, "could not start a plan");
          send({ type: "error", message: `Could not start the plan: ${err instanceof Error ? err.message : err}` });
        });
        return;
      case "set_session_feature": {
        if (!this.inProject(send, message.sessionId)) return;
        if (!message.newFeatureTitle && message.featureId === undefined) {
          send({ type: "error", message: "Say which feature to move the session to" });
          return;
        }
        if (!message.newFeatureTitle && message.featureId && !this.featureUsable(send, message.featureId)) return;
        this.moveSession(message.sessionId, message.newFeatureTitle ? this.newFeature(message.newFeatureTitle) : message.featureId!, "owner");
        return;
      }
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
      case "permission_decision": {
        // Ask ids are unique across sessions: let the owner take it (first decision wins).
        if (this.approving.has(message.id)) return;
        const runtime = [...this.runtimes.values()].find((r) => r.openAsk(message.id));
        const request = runtime?.openAsk(message.id);
        if (!runtime || !request) return;
        if (!message.savePlanAs || request.action?.type !== "plan") return void runtime.decide(message.id, message.decision);
        // A proposed plan, approved (4p6a): saved first, then the agent's answer says so.
        const build = message.decision.decision === "allow";
        this.approving.add(message.id);
        this.approvePlan(send, runtime.id, request.action.plan ?? "", message.savePlanAs)
          .then((saved) => {
            if (!saved) return; // refused: the ask stays open
            runtime.decide(message.id, build ? { decision: "allow", message: buildHere(saved) } : { decision: "deny", message: buildLater(saved.path) });
          })
          .catch((err) => {
            this.log.warn({ err, session: runtime.id }, "could not save the approved plan");
            send({ type: "error", message: `Could not save the plan: ${err instanceof Error ? err.message : err}` });
          })
          .finally(() => this.approving.delete(message.id));
        return;
      }
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
    if (!stored || !this.ours(stored.sessionId)) return undefined;
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

  /** Is this one of this project's sessions? */
  private ours(sessionId: string): boolean {
    return this.store.get(sessionId)?.projectDir === this.cwd;
  }

  /** Is this one of this project's sessions? Tells the tab when not. */
  private inProject(send: Send, sessionId: string): boolean {
    if (this.ours(sessionId)) return true;
    send({ type: "error", message: `No session ${sessionId} in this project` });
    return false;
  }

  /** Put a session in a feature (null: a one-off) and tell every tab; `by` says who moved it. */
  private moveSession(sessionId: string, featureId: string | null, by: "owner" | "agent"): void {
    const before = this.store.get(sessionId)?.featureId ?? null;
    this.store.setSessionFeature(sessionId, featureId);
    // Its agent, if running, learns where its plans are now: on its next prompt, or (moved by its
    // own tool) in the tool's answer (4p2).
    if (by === "owner" && before !== featureId) this.runtimes.get(sessionId)?.plansMoved(movedNote(this.planPaths(sessionId)));
    // A turn running now may write its new feature's plan: held at its end like the others (4p3).
    const running = this.runningTurn(sessionId);
    const feature = running && this.planFolders(sessionId).feature;
    if (running && feature && !running.plans.has(feature.folder)) running.plans.set(feature.folder, this.turnPlan(feature.folder));
    this.log.info({ session: sessionId, feature: featureId, by }, "session moved");
    this.broadcast(this.featureList());
    this.broadcastSessionList();
  }

  /** A new feature in this project; its id. Callers tell the tabs. */
  private newFeature(title: string): string {
    const feature = this.store.createFeature(this.cwd, title);
    this.log.info({ feature: feature.id }, "new feature");
    return feature.id;
  }

  /**
   * Before marking done (4c5): with the owner's consent (`stop`), stop every busy agent among
   * these sessions — its turn, its asks, its queue; without it, refuse if any is busy. False when
   * refused (the tab is told).
   */
  private stopBusy(send: Send, sessionIds: string[], stop: boolean | undefined, refusal: string): boolean {
    const busy = sessionIds.filter((id) => this.busy(id));
    if (busy.length === 0) return true;
    if (!stop) {
      send({ type: "error", message: `${refusal}: stop it first, or confirm stopping` });
      return false;
    }
    for (const id of busy) this.runtimes.get(id)!.interrupt();
    this.log.info({ sessions: busy }, "stopped to mark done");
    return true;
  }

  /** The session's feature, if done, is reopened: live work isn't hidden in a done folder (D73). */
  private reopenFeatureOf(sessionId: string): void {
    const featureId = this.store.get(sessionId)?.featureId;
    if (!featureId || !this.store.getFeature(featureId)?.doneAt) return;
    this.store.setFeatureDone(featureId, false);
    this.broadcast(this.featureList());
  }

  // --- plans (D79) ---

  /** Is this plan's owner one of this project's sessions or features? Tells the tab when not. */
  private planOwnerInProject(send: Send, owner: PlanOwner): boolean {
    return owner.kind === "session" ? this.inProject(send, owner.id) : this.featureInProject(send, owner.id);
  }

  /** Its plan's folder under `.kratos/`; undefined for a feature whose plan was never started. */
  private planFolder(owner: PlanOwner): string | undefined {
    if (owner.kind === "session") return `sessions/${owner.id}`;
    const dir = this.store.getFeature(owner.id)?.planDir;
    return dir ? `features/${dir}` : undefined;
  }

  private planMessage(owner: PlanOwner): ServerMessage {
    const folder = this.planFolder(owner);
    return this.planOf(owner, folder ? this.plans.text(folder) : undefined);
  }

  private planOf(owner: PlanOwner, markdown: string | undefined): ServerMessage {
    return { type: "plan", owner, markdown: markdown ?? null, plan: markdown === undefined ? null : parsePlan(markdown, owner.kind) };
  }

  /** A session's plan folders under `.kratos/`: its own, and its feature's when it's in one. A
   * feature's plan folder is named now if it hasn't been (the agent may write it before anyone
   * starts it from the UI). */
  private planFolders(sessionId: string): { session: string; feature?: { title: string; folder: string } } {
    const session = `sessions/${sessionId}`;
    const featureId = this.store.get(sessionId)?.featureId;
    const feature = featureId ? this.store.getFeature(featureId) : undefined;
    if (!feature) return { session };
    const dir = feature.planDir ?? this.freePlanDir(feature.title);
    if (!feature.planDir) this.store.setFeaturePlanDir(feature.id, dir);
    return { session, feature: { title: feature.title, folder: `features/${dir}` } };
  }

  /** Where a session's plans are, relative to the project (4p2). */
  private planPaths(sessionId: string): PlanPaths {
    const { session, feature } = this.planFolders(sessionId);
    return feature ? { session: planFile(session), feature: { title: feature.title, path: planFile(feature.folder) } } : { session: planFile(session) };
  }

  /** Writes the template, unless there's a plan already. A feature's folder is named now, from its
   * title, and kept from then on (renaming the feature doesn't move it). */
  private async startPlan(send: Send, owner: PlanOwner): Promise<void> {
    let title: string;
    if (owner.kind === "feature") {
      const feature = this.store.getFeature(owner.id)!;
      if (feature.doneAt) return send({ type: "error", message: `“${feature.title}” is done; reopen it to plan it` });
      if (!feature.planDir) this.store.setFeaturePlanDir(feature.id, this.freePlanDir(feature.title));
      title = feature.title;
    } else title = this.store.get(owner.id)!.title ?? "Session plan";
    const folder = this.planFolder(owner)!;
    const template = planTemplate(title, owner.kind);
    await this.inLine(folder, async () => {
      if (!(await this.plans.create(folder, template))) return;
      // Started while a turn runs on it: the template is yours, not that turn's edit.
      for (const turn of this.turnsOn(folder)) if (turn.base === undefined) turn.base = turn.shown = template;
      this.log.info({ owner }, "plan started");
    });
  }

  /** Your changes to a plan (4p4), in line with every other change to it. */
  private onPlan(send: Send, owner: PlanOwner, change: (folder: string) => Promise<void>): Promise<void> {
    const folder = this.planFolder(owner);
    if (!folder) {
      send({ type: "error", message: "This plan hasn't been started" });
      return Promise.resolve();
    }
    return this.inLine(folder, () => change(folder));
  }

  /** Runs changes to one plan one after another: each reads what the one before wrote. Two quick
   * clicks both read the file before either wrote it, and the second undid the first; a turn's end
   * and your change likewise mustn't write over each other. */
  private inLine<T>(folder: string, change: () => Promise<T>): Promise<T> {
    const run = (this.planActions.get(folder) ?? Promise.resolve()).then(change);
    const settled = run.then(
      () => {},
      () => {},
    );
    this.planActions.set(folder, settled);
    void settled.then(() => this.planActions.get(folder) === settled && this.planActions.delete(folder));
    return run;
  }

  /**
   * Your change from the plan page (4p4a): applied to the file as it is on disk now and written;
   * every tab then gets the plan as with any change. A turn running on this plan has its agent's
   * edit so far held now, as its end would hold it, and your change goes on top: that's the turn's
   * base from then on, so its end holds only what the agent does after, and never takes your
   * change (to a step it added this turn, too) for the agent's.
   */
  private async applyAction(send: Send, owner: PlanOwner, folder: string, action: PlanAction): Promise<void> {
    const text = await this.plans.refresh(folder);
    if (text === undefined) return send({ type: "error", message: "This plan hasn't been started" });
    if (applyPlanAction(text, action) === undefined) {
      const what = "stepId" in action ? `step ${action.stepId}` : "decisionId" in action ? `decision ${action.decisionId}` : `open question “${action.question}”`;
      return send({ type: "error", message: `No ${what} in this plan` });
    }
    const turns = this.turnsOn(folder);
    const held = turns.reduce((now, turn) => this.holdTurn(turn, now), text);
    const next = applyPlanAction(held, action) ?? held;
    for (const turn of turns) {
      turn.base = next;
      // Its chat's record: your change isn't the turn's.
      if (turn.shown !== undefined) turn.shown = applyPlanAction(turn.shown, action) ?? turn.shown;
    }
    if (next === text) return;
    await this.plans.write(folder, next);
    this.log.info({ owner, action: action.kind }, "you changed the plan");
  }

  /**
   * Your edit of the whole plan (4p4b): written only if the file is still what you started from
   * (else nothing is: the page shows you what changed). One saved during an agent's turn on this
   * plan is that turn's starting text from now on: what you save is yours, including whatever of
   * the agent's changes you kept.
   */
  private async savePlan(send: Send, owner: PlanOwner, folder: string, markdown: string, base: string): Promise<void> {
    const text = await this.plans.refresh(folder);
    if (text === undefined) return send({ type: "error", message: "This plan hasn't been started" });
    if (text !== base) return send({ type: "error", message: "The plan changed while you were editing; nothing was saved" });
    if (markdown === text) return;
    await this.writeYours(folder, markdown);
    this.log.info({ owner }, "you edited the plan");
  }

  /** A whole plan text of yours (an edit, an approved plan): written, and the base of any turn on
   * that plan from now on — what you save is yours. Call it in line (`inLine`). */
  private async writeYours(folder: string, markdown: string): Promise<void> {
    for (const turn of this.turnsOn(folder)) turn.base = turn.shown = markdown;
    await this.plans.write(folder, markdown);
  }

  /**
   * A plan the agent proposed, approved (4p6a): saved as this session's plan or its feature's
   * (`approvedPlan` says which by default). "feature" on a one-off makes the feature first, named
   * from the plan's title, and moves the session in; a feature that has a plan keeps it (refused:
   * it isn't overwritten from plan mode). Mid-turn by nature (the agent waits on it): yours, so
   * the turn's end doesn't take it for the agent's edit. Gives the plan's path, or undefined when
   * refused (the tab is told).
   */
  private async approvePlan(send: Send, sessionId: string, markdown: string, as: PlanSave): Promise<SavedPlan | undefined> {
    // An agent can present a plan with no text (it wrote it somewhere instead): nothing to save,
    // and an empty file would read as a plan with nothing in it.
    if (!markdown.trim()) {
      send({ type: "error", message: "The plan came without its text, so there's nothing to save. Keep planning and ask for the whole plan." });
      return undefined;
    }
    const session = this.store.get(sessionId)!;
    const moved = as === "feature" && !session.featureId;
    if (moved) {
      const title = (parsePlan(markdown, "feature").title || session.title || "New feature").replace(/\s+/g, " ").trim().slice(0, 80);
      this.moveSession(sessionId, this.newFeature(title), "owner");
    }
    const { session: own, feature } = this.planFolders(sessionId);
    const folder = as === "feature" ? feature!.folder : own;
    // Checked in line, on disk: the agent (or an edit queued before this) may have just written it.
    const saved = await this.inLine(folder, async () => {
      if (as === "feature" && (await this.plans.refresh(folder)) !== undefined) return false;
      await this.writeYours(folder, markdown);
      return true;
    });
    if (!saved) {
      send({ type: "error", message: `“${feature!.title}” already has a plan, and plan mode doesn't replace it. Save this one as the session's plan.` });
      return undefined;
    }
    this.log.info({ session: sessionId, as, folder }, "approved plan saved");
    return { path: planFile(folder), as, ...(as === "feature" ? { feature: feature!.title } : {}), moved };
  }

  /** A folder name for a feature's plan: its title as a slug, `-2`, `-3`… when that's taken. */
  private freePlanDir(title: string): string {
    // "today.js — print the date" slugs to "todayjs--print-the-date": one dash is enough.
    const base = slug(title).replace(/-{2,}/g, "-").slice(0, 60).replace(/^-+|-+$/g, "") || "feature";
    for (let n = 1; ; n++) {
      const name = n === 1 ? base : `${base}-${n}`;
      if (!this.store.featureByPlanDir(this.cwd, name) && !this.plans.taken(`features/${name}`)) return name;
    }
  }

  /** A plan file changed, from anywhere: every tab gets it, and, when a plan appeared or went, the
   * list that says who has one. */
  private planChanged(folder: string, markdown: string | undefined, existed: boolean): void {
    const owner = this.ownerOfPlan(folder);
    if (!owner) return; // a folder Kratos didn't make: made by hand, or another project's database
    this.broadcast(this.planOf(owner, markdown));
    if (existed === (markdown !== undefined)) return; // an edit: who has a plan is unchanged
    this.broadcast(owner.kind === "session" ? this.sessionList() : this.featureList());
  }

  /** Whose plan a folder under `.kratos/` holds; undefined for one Kratos doesn't know. */
  private ownerOfPlan(folder: string): PlanOwner | undefined {
    const [kind, name = ""] = folder.split("/");
    if (kind === "sessions") return this.ours(name) ? { kind: "session", id: name } : undefined;
    const feature = kind === "features" ? this.store.featureByPlanDir(this.cwd, name) : undefined;
    return feature && { kind: "feature", id: feature.id };
  }

  /** A turn starts (4p3): remember its session's plans as they are, its own and its feature's. */
  private planTurnStarted(sessionId: string): void {
    const stale = this.runningTurn(sessionId); // never ended (it shouldn't happen): not held any more
    if (stale) this.turns.splice(this.turns.indexOf(stale), 1);
    const { session, feature } = this.planFolders(sessionId);
    const folders = [session, ...(feature ? [feature.folder] : [])];
    this.turns.push({ sessionId, plans: new Map(folders.map((folder) => [folder, this.turnPlan(folder)])), ending: false });
  }

  private runningTurn(sessionId: string): LiveTurn | undefined {
    return this.turns.find((turn) => turn.sessionId === sessionId && !turn.ending);
  }

  /** A plan as a turn sees it at its start. */
  private turnPlan(folder: string): TurnPlan {
    const text = this.plans.text(folder);
    return { shown: text, base: text, undone: [], intentChanged: false };
  }

  /** This plan in each live turn that has it, newest turn first: one that started while an older
   * one's edit was still unheld has that edit in its base, so holding it first changes nothing,
   * where after the older one's hold it would undo it. */
  private turnsOn(folder: string): TurnPlan[] {
    return [...this.turns].reverse().flatMap((turn) => turn.plans.get(folder) ?? []);
  }

  /** Holds a turn's agent's edit (`text`: its plan now) to who-writes-what against its base (4p0);
   * gives the text to write. What was put back is kept for the turn's end to say. */
  private holdTurn(turn: TurnPlan, text: string): string {
    if (text === turn.base) return text;
    const { markdown, undone, intentChanged } = reconcileAgentEdit(turn.base ?? "", text);
    turn.undone.push(...undone);
    if (turn.base !== undefined && intentChanged) turn.intentChanged = true;
    return markdown;
  }

  /**
   * A turn ended (4p3): each of its plans that changed is the turn's edit. Read from disk (the
   * watcher can miss one), held to who-writes-what (4p0: what isn't the agent's to do is put back
   * and written), kept in its session's log as `plan_updated` (the chat's "Updated the plan": the
   * only record, D79), and what was put back is said to the agent with its next prompt.
   */
  private async planTurnEnded(sessionId: string): Promise<void> {
    const turn = this.runningTurn(sessionId);
    if (!turn) return;
    turn.ending = true; // at once: its session's next turn may start before this one is settled
    try {
      for (const [folder, plan] of turn.plans) await this.inLine(folder, () => this.settleTurnPlan(turn, folder, plan));
    } catch (err) {
      this.log.warn({ err, session: sessionId }, "could not settle the turn's plan changes");
    } finally {
      this.turns.splice(this.turns.indexOf(turn), 1);
    }
  }

  /** One of an ending turn's plans (4p3): held, written back, and in its session's log. */
  private async settleTurnPlan(turn: LiveTurn, folder: string, plan: TurnPlan): Promise<void> {
    const after = await this.plans.refresh(folder);
    const owner = this.ownerOfPlan(folder);
    if (!owner) return;
    const base = plan.base;
    const final = after === undefined ? undefined : this.holdTurn(plan, after);
    if (final !== undefined && final !== after) {
      await this.plans.write(folder, final);
      // A turn that started since, while this edit was still unheld, may have it in its base: held
      // there too, so its end doesn't take what was put back for its owner's (a queued prompt's
      // turn starts the moment this one ends).
      for (const newer of this.turns.slice(this.turns.indexOf(turn) + 1)) {
        const its = newer.plans.get(folder);
        if (its?.base !== undefined && its.base !== base) its.base = reconcileAgentEdit(base ?? "", its.base).markdown;
      }
    }
    const { shown, undone, intentChanged } = plan;
    Object.assign(plan, { base: final, shown: final, undone: [], intentChanged: false });
    if (final === shown && undone.length === 0) return;
    const runtime = this.runtimes.get(turn.sessionId);
    runtime?.addToLog({ type: "plan_updated", owner, path: planFile(folder), before: shown ?? null, after: final ?? null, undone, intentChanged: shown !== undefined && intentChanged });
    if (undone.length > 0) runtime?.tellAgentNext(`[Kratos] In ${owner.kind === "feature" ? "the feature plan" : "this session's plan"} (${planFile(folder)}) I put back what isn't yours to do: ${undone.join(" ")}`);
    this.log.info({ session: turn.sessionId, folder, undone: undone.length }, "plan changed in a turn");
  }

  /** Is this one of this project's features? Tells the tab when not. */
  private featureInProject(send: Send, featureId: string): boolean {
    if (this.store.getFeature(featureId)?.projectDir === this.cwd) return true;
    send({ type: "error", message: `No feature ${featureId} in this project` });
    return false;
  }

  /** A feature sessions can join: this project's, and not done (reopen it first). */
  private featureUsable(send: Send, featureId: string): boolean {
    const problem = this.featureProblem(featureId);
    if (problem) send({ type: "error", message: problem });
    return problem === undefined;
  }

  /** Why sessions can't join this feature (another project's, unknown, or done), or undefined. */
  private featureProblem(featureId: string): string | undefined {
    const feature = this.store.getFeature(featureId);
    if (feature?.projectDir !== this.cwd) return `No feature ${featureId} in this project`;
    if (feature.doneAt !== null) return "That feature is done: reopen it to add sessions to it";
    return undefined;
  }

  /** What a session's agent may do with its Kratos tools (4m3): only to this session and its
   * feature, under the same rules as the owner's tabs; every tab hears of a change. */
  private featureOps(sessionId: string): SessionFeatureOps {
    const featureOf = () => this.store.get(sessionId)?.featureId ?? null;
    const cannotFile = (filing: Filing) => ("featureId" in filing ? this.featureProblem(filing.featureId) : undefined);
    const cannotFinishFeature = () => {
      const featureId = featureOf();
      if (!featureId) return "This session isn't in a feature.";
      if (this.store.getFeature(featureId)?.doneAt) return "Its feature is already done.";
      const others = this.store.sessionsOfFeature(featureId).filter((s) => s.id !== sessionId && this.busy(s.id)).length;
      return others > 0 ? `${others} other session${others === 1 ? " is" : "s are"} in this feature still working: they must finish first.` : undefined;
    };
    return {
      features: () => ({
        features: this.store.listFeatures(this.cwd).map((f) => ({ id: f.id, title: f.title, done: f.doneAt !== null })),
        current: featureOf(),
      }),
      cannotFile,
      plansNote: () => movedNote(this.planPaths(sessionId)).replace(/^\[Kratos\] /, ""),
      file: (filing) => {
        const problem = cannotFile(filing);
        if (problem) return problem;
        this.moveSession(sessionId, "newTitle" in filing ? this.newFeature(filing.newTitle) : "featureId" in filing ? filing.featureId : null, "agent");
        return undefined;
      },
      // Its own turn is still running (it's making this call): done once the turn ends (D73).
      markSessionDone: () =>
        this.runtime(sessionId).whenIdle(() => {
          this.store.setDone(sessionId, true);
          this.log.info({ session: sessionId }, "marked done by its agent");
          this.broadcastSessionList();
        }),
      cannotFinishFeature,
      markFeatureDone: (featureId) => {
        if (featureOf() !== featureId) return "This session moved to another feature meanwhile: nothing changed.";
        const problem = cannotFinishFeature();
        if (problem) return problem;
        this.runtime(sessionId).whenIdle(() => {
          // Checked again: by the end of the turn it may have moved, or another session started.
          const late = featureOf() !== featureId ? "it moved to another feature" : cannotFinishFeature();
          if (late) return void this.log.info({ session: sessionId, feature: featureId, why: late }, "agent's feature done dropped");
          this.store.setFeatureDone(featureId, true);
          this.log.info({ session: sessionId, feature: featureId }, "feature marked done by an agent");
          this.broadcast(this.featureList());
          this.broadcastSessionList();
        });
        return undefined;
      },
    };
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
        features: this.featureOps(sessionId),
        onTurn: (edge) => (edge === "start" ? this.planTurnStarted(sessionId) : void this.planTurnEnded(sessionId)),
        instructions: () => {
          void this.plans.prepare().catch((err) => this.log.warn({ err }, "could not prepare .kratos/ for plans"));
          return planInstructions(this.planPaths(sessionId));
        },
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
        featureId: s.featureId,
        titling: this.runtimes.get(s.id)?.titling ?? false,
        hasPlan: this.plans.text(`sessions/${s.id}`) !== undefined,
      })),
    };
  }

  private featureList(): ServerMessage {
    return {
      type: "features",
      list: this.store.listFeatures(this.cwd).map((f) => ({
        id: f.id,
        title: f.title,
        done: f.doneAt !== null,
        updatedAt: f.updatedAt.getTime(),
        hasPlan: f.planDir !== null && this.plans.text(`features/${f.planDir}`) !== undefined,
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
