import { z } from "zod";
import {
  AgentEvent,
  AgentModel,
  AgentPermissionMode,
  AttachmentKind,
  AttachmentPolicy,
  PermissionDecision,
  PermissionRequest,
  QuestionAnswer,
  QuestionReply,
  QuestionRequest,
} from "./agent.js";

/**
 * Messages exchanged between the browser UI and the kratos server over WebSocket (path: /ws).
 * Each message is a JSON object with a `type` field. The zod schemas are the source of truth:
 * they validate untrusted input at runtime, and the TS types are inferred from them.
 * A tab sends `ping` on connect (and whenever it likes, as a heartbeat); `pong` answers with
 * where the agent works and which agent it is (D34).
 */

/** A file a tab sends with a prompt (D55): base64 bytes, inline in the prompt message. */
export const AttachmentUpload = z.object({ name: z.string().min(1).max(255), mediaType: z.string().max(255), data: z.string() });
export type AttachmentUpload = z.infer<typeof AttachmentUpload>;

/** A stored attachment, as the session log and the UI know it (D55): fetch it from
 * `/attachments/<id>`. */
export const AttachmentRef = z.object({ id: z.string(), name: z.string(), kind: AttachmentKind, mediaType: z.string(), size: z.number() });
export type AttachmentRef = z.infer<typeof AttachmentRef>;

/** Browser → server */
export const ClientMessage = z.discriminatedUnion("type", [
  /** A prompt for the session this tab views. `newSession: true` (sent from Home) starts a new
   * session for it instead and moves this tab there; other sessions keep running (D41). */
  /** `harness`/`model`/`effort` apply when this prompt starts a session (its first prompt); D43, D51. */
  z.object({
    type: z.literal("prompt"),
    text: z.string().min(1),
    newSession: z.boolean().optional(),
    harness: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    /** While the agent works: send it now (stop the step) instead of queueing it (⌘↵, D56). */
    sendNow: z.boolean().optional(),
    /** Files with the prompt, sent inline (D55); checked by the server against the harness. */
    attachments: z.array(AttachmentUpload).max(50).optional(),
    /** The mode to start in (D53); a `dangerous` one also needs `confirmDangerous: true`. */
    permissionMode: z.string().optional(),
    confirmDangerous: z.boolean().optional(),
  }),
  /** View another session in this tab: answered with `session` + that session's replay. */
  z.object({ type: z.literal("open_session"), id: z.string() }),
  /** Switch the viewed session's model, also while its agent is running (D43); null = the
   * agent's default (3c4). */
  z.object({ type: z.literal("set_model"), model: z.string().nullable() }),
  /** Switch the viewed session's effort level, also while its agent is running (D51). There is
   * no "back to default": the agent's reset isn't reliable, so Kratos only sets real levels. */
  z.object({ type: z.literal("set_effort"), effort: z.string().min(1) }),
  /** Switch the viewed session's permission mode, also while its agent runs (D53). A `dangerous`
   * mode (Bypass) is refused unless `confirmDangerous` is true — set only by the consent dialog. */
  z.object({ type: z.literal("set_permission_mode"), mode: z.string().min(1), confirmDangerous: z.boolean().optional() }),
  z.object({ type: z.literal("interrupt") }),
  /** Take a queued prompt back out of the queue (D56), before the agent reads it. */
  z.object({ type: z.literal("remove_queued"), id: z.string() }),
  /** Stop the current step and have the agent read this queued prompt now; the rest stay
   * queued (owner, D56). */
  z.object({ type: z.literal("send_now"), id: z.string() }),
  /** Mark any session of this project done, or reopen it (3d2). Answered with `sessions`. */
  z.object({ type: z.literal("set_done"), id: z.string(), done: z.boolean() }),
  /** Answer to a `permission_request`; the first answer from any tab wins (D32). */
  z.object({ type: z.literal("permission_decision"), id: z.string(), decision: PermissionDecision }),
  /** Answer to a `question_request`; the first valid answer from any tab wins (D54). */
  z.object({ type: z.literal("question_answer"), id: z.string(), reply: QuestionReply }),
  /** Open the project folder in one of the editors listed in `pong` (3d3). */
  z.object({ type: z.literal("open_in"), editor: z.string() }),
  /** Ask for server info; answered with `pong`. Send on connect. */
  z.object({ type: z.literal("ping") }),
  /** Something the browser wants in the server's log file (D44), logged as component "web". */
  z.object({
    type: z.literal("client_log"),
    level: z.enum(["info", "warn", "error"]),
    message: z.string().max(2000),
    data: z.unknown().optional(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** A session as shown in the Recent list / sidebar. Status is live: needs_approval > working > idle. */
export const SessionSummary = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.enum(["idle", "working", "needs_approval", "needs_answer"]),
  updatedAt: z.number(),
  /** Harness (adapter id) and model it runs with; model null = the agent's default. */
  harness: z.string(),
  model: z.string().nullable(),
  /** The effort level in use, as the agent last reported it (else the one chosen); null = not
   * known yet (agent never ran, nothing chosen) or the model has none (D51). */
  effort: z.string().nullable(),
  /** The permission mode in use, as the agent last reported it (else the one chosen); null = the
   * agent's default (D53). */
  permissionMode: z.string().nullable(),
  /** Prompts sent while it works that the agent hasn't read yet (D56): "Working · 2 queued". */
  queued: z.number(),
  /** The owner marked it done (3d2): listed under "Done", hidden from Recent. */
  done: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** Somewhere the project folder can be opened: an installed editor, or the file manager (3d3). */
export const Editor = z.object({
  id: z.string(),
  label: z.string(),
  /** URL of the app's own icon on this server, when there is one (macOS apps). */
  icon: z.string().optional(),
});
export type Editor = z.infer<typeof Editor>;

/** A harness the server can run, with the models it reports (D43). */
export const Harness = z.object({
  id: z.string(),
  name: z.string(),
  models: z.array(AgentModel),
  /** Its permission modes (D53); empty = it has none. */
  permissionModes: z.array(AgentPermissionMode),
  /** The files it accepts with a prompt (D55). */
  attachments: AttachmentPolicy,
});
export type Harness = z.infer<typeof Harness>;

/** Server → browser. Everything except pong/error/session/sessions/harnesses is in a session's log. */
export const ServerMessage = z.discriminatedUnion("type", [
  /** The harnesses and their models: on connect once known, and when (re)loaded. */
  z.object({ type: z.literal("harnesses"), list: z.array(Harness) }),
  /** The session this tab now views; its log replay follows. On a new id, clear the log. */
  z.object({ type: z.literal("session"), id: z.string() }),
  /** That session's replay is complete: everything after it is new (3d9). Lets the UI show the
   * whole history at once — e.g. open a chat at its bottom instead of scrolling through it. */
  z.object({ type: z.literal("session_ready"), id: z.string() }),
  /** All of this project's sessions, most recent first: on connect and whenever one changes. */
  z.object({ type: z.literal("sessions"), list: z.array(SessionSummary) }),
  /** Reply to `ping`: server info + timestamp. */
  z.object({
    type: z.literal("pong"),
    at: z.number(),
    serverVersion: z.string(),
    cwd: z.string(),
    agent: z.string(),
    /** Where the project can be opened, as detected on this machine (3d3). */
    editors: z.array(Editor),
  }),
  /** A prompt someone sent (so every tab shows the whole conversation). */
  z.object({ type: z.literal("user_prompt"), text: z.string(), attachments: z.array(AttachmentRef).optional() }),
  /** A prompt sent while the agent works (D56): it waits in the queue until the agent reads it. */
  z.object({ type: z.literal("prompt_queued"), id: z.string(), text: z.string(), attachments: z.array(AttachmentRef).optional() }),
  /** The agent read a queued prompt: at a step boundary of the running turn (`step`, after the step
   * `after` — a tool call id — when there was one), as a new turn once the last one ended, or
   * right away by Send now (`now`, having stopped the step `stopped` if one was running). */
  z.object({
    type: z.literal("prompt_read"),
    id: z.string(),
    how: z.enum(["step", "next_turn", "now"]),
    after: z.string().optional(),
    stopped: z.string().optional(),
  }),
  /** A queued prompt left the queue unread: removed by the owner, or dropped by Stop / the agent
   * ending (`stopped`). */
  z.object({ type: z.literal("prompt_removed"), id: z.string(), reason: z.enum(["removed", "stopped"]) }),
  z.object({ type: z.literal("agent_event"), event: AgentEvent }),
  /** The agent wants to use a tool; answer with `permission_decision` and this id. */
  z.object({ type: z.literal("permission_request"), id: z.string(), request: PermissionRequest }),
  /** An ask is settled (by some tab, or withdrawn by the agent): close its card everywhere. */
  z.object({
    type: z.literal("permission_resolved"),
    id: z.string(),
    outcome: z.enum(["allowed", "denied", "cancelled"]),
  }),
  /** The agent asks the owner questions (D54); answer with `question_answer` and this id. */
  z.object({ type: z.literal("question_request"), id: z.string(), request: QuestionRequest }),
  /** Questions settled: answered (with the answers, for the record), skipped by the owner, or
   * cancelled — withdrawn by the agent, or left open by a restart ("Not answered"). */
  z.object({
    type: z.literal("question_resolved"),
    id: z.string(),
    outcome: z.enum(["answered", "skipped", "cancelled"]),
    answers: z.array(QuestionAnswer).optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
  /** To the tab that pressed Stop (not logged): the text of the queued prompts Stop dropped, to
   * put back in its composer (owner, D56). */
  z.object({ type: z.literal("prompts_returned"), text: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export const WS_PATH = "/ws";
export const DEFAULT_PORT = 4317;
