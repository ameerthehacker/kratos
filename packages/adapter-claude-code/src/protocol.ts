import { z } from "zod";

/**
 * The subset of the `claude` CLI's stream-json RPC protocol that Kratos reads (see D23).
 * One JSON object per stdout line. Lines that don't match are ignored; unknown fields stripped.
 */

/** Content blocks Kratos understands. Parse each block separately; skip any that don't match. */
export const Block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), thinking: z.string() }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))]).optional(),
    is_error: z.boolean().optional(),
  }),
]);
export type Block = z.infer<typeof Block>;

/** Set when the message comes from a sub-agent rather than the main conversation. */
const parent = { parent_tool_use_id: z.string().nullable().optional() };

export const CliMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assistant"), message: z.object({ content: z.array(z.unknown()) }), ...parent }),
  z.object({
    type: z.literal("user"),
    message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }),
    ...parent,
  }),
  z.object({ type: z.literal("result"), subtype: z.string() }),
  z.object({
    type: z.literal("control_request"),
    request_id: z.string(),
    request: z.object({
      subtype: z.string(),
      tool_name: z.string().optional(),
      input: z.record(z.string(), z.unknown()).optional(),
      decision_reason: z.string().optional(),
    }),
  }),
  z.object({ type: z.literal("control_cancel_request"), request_id: z.string() }),
]);
export type CliMessage = z.infer<typeof CliMessage>;
