import { z } from "zod";
import { AgentEvent, PermissionDecision, PermissionRequest } from "./agent.js";

/**
 * Messages exchanged between the browser UI and the kratos server over WebSocket (path: /ws).
 * Each message is a JSON object with a `type` field. The zod schemas are the source of truth:
 * they validate untrusted input at runtime, and the TS types are inferred from them.
 * A tab sends `ping` on connect (and whenever it likes, as a heartbeat); `pong` answers with
 * where the agent works and which agent it is (D34).
 */

/** Browser → server */
export const ClientMessage = z.discriminatedUnion("type", [
  /** A prompt for the session this tab views. `newSession: true` (sent from Home) starts a new
   * session for it instead and moves this tab there; other sessions keep running (D41). */
  z.object({ type: z.literal("prompt"), text: z.string().min(1), newSession: z.boolean().optional() }),
  /** View another session in this tab: answered with `session` + that session's replay. */
  z.object({ type: z.literal("open_session"), id: z.string() }),
  z.object({ type: z.literal("interrupt") }),
  /** Answer to a `permission_request`; the first answer from any tab wins (D32). */
  z.object({ type: z.literal("permission_decision"), id: z.string(), decision: PermissionDecision }),
  /** Ask for server info; answered with `pong`. Send on connect. */
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** A session as shown in the Recent list / sidebar. Status is live: needs_approval > working > idle. */
export const SessionSummary = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.enum(["idle", "working", "needs_approval"]),
  updatedAt: z.number(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** Server → browser. Everything except pong/error/session/sessions is in a session's log. */
export const ServerMessage = z.discriminatedUnion("type", [
  /** The session this tab now views; its log replay follows. On a new id, clear the log. */
  z.object({ type: z.literal("session"), id: z.string() }),
  /** All of this project's sessions, most recent first: on connect and whenever one changes. */
  z.object({ type: z.literal("sessions"), list: z.array(SessionSummary) }),
  /** Reply to `ping`: server info + timestamp. */
  z.object({
    type: z.literal("pong"),
    at: z.number(),
    serverVersion: z.string(),
    cwd: z.string(),
    agent: z.string(),
  }),
  /** A prompt someone sent (so every tab shows the whole conversation). */
  z.object({ type: z.literal("user_prompt"), text: z.string() }),
  z.object({ type: z.literal("agent_event"), event: AgentEvent }),
  /** The agent wants to use a tool; answer with `permission_decision` and this id. */
  z.object({ type: z.literal("permission_request"), id: z.string(), request: PermissionRequest }),
  /** An ask is settled (by some tab, or withdrawn by the agent): close its card everywhere. */
  z.object({
    type: z.literal("permission_resolved"),
    id: z.string(),
    outcome: z.enum(["allowed", "denied", "cancelled"]),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export const WS_PATH = "/ws";
export const DEFAULT_PORT = 4317;
