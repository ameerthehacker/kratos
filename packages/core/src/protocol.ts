import { z } from "zod";

/**
 * Messages exchanged between the browser UI and the kratos server over WebSocket (path: /ws).
 * Each message is a JSON object with a `type` field. The zod schemas are the source of truth:
 * they validate untrusted input at runtime, and the TS types are inferred from them.
 */

/** Browser → server */
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Server → browser */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), serverVersion: z.string() }),
  z.object({ type: z.literal("pong"), at: z.number() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export const WS_PATH = "/ws";
export const DEFAULT_PORT = 4317;
