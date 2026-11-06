import { z } from "zod";
import { AgentEvent, PermissionDecision, PermissionRequest } from "./agent.js";

/**
 * Messages exchanged between the browser UI and the kratos server over WebSocket (path: /ws).
 * Each message is a JSON object with a `type` field. The zod schemas are the source of truth:
 * they validate untrusted input at runtime, and the TS types are inferred from them.
 * ping/pong are scaffold leftovers, removed with the old UI in step 3c.
 */

/** Browser → server */
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prompt"), text: z.string().min(1) }),
  z.object({ type: z.literal("interrupt") }),
  /** Answer to a `permission_request`; the first answer from any tab wins (D32). */
  z.object({ type: z.literal("permission_decision"), id: z.string(), decision: PermissionDecision }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Server → browser. Everything except hello/pong/error is in the session log replayed to new tabs. */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), serverVersion: z.string() }),
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
  z.object({ type: z.literal("pong"), at: z.number() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export const WS_PATH = "/ws";
export const DEFAULT_PORT = 4317;
