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
    content: z
      .union([
        z.string(),
        z.array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            /** On an `image` part (3z): `{type: "base64", media_type, data}`, as the agent saw it. */
            source: z.object({ type: z.string(), media_type: z.string().optional(), data: z.string().optional() }).optional(),
          }),
        ),
      ])
      .optional(),
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
  /** What became of a message we sent with a `uuid` (verified on the real CLI, D56): queued →
   * started → completed | cancelled. The CLI also reports its own messages: match by uuid. */
  z.object({ type: z.literal("command_lifecycle"), command_uuid: z.string(), state: z.string() }),
  /** Status lines: `init` at each turn's start and `status` on a change both carry the permission
   * mode in use (verified on the real CLI, D53). */
  z.object({ type: z.literal("system"), subtype: z.string(), permissionMode: z.string().optional() }),
  z.object({
    type: z.literal("control_request"),
    request_id: z.string(),
    request: z.object({
      subtype: z.string(),
      tool_name: z.string().optional(),
      input: z.record(z.string(), z.unknown()).optional(),
      decision_reason: z.string().optional(),
      /** Which tool_use block this ask is about (verified on the real CLI, 3c4). */
      tool_use_id: z.string().optional(),
    }),
  }),
  z.object({ type: z.literal("control_cancel_request"), request_id: z.string() }),
  /** The CLI's answer to a control_request *we* sent (initialize, set_model, …). */
  z.object({
    type: z.literal("control_response"),
    response: z.object({
      subtype: z.string(), // "success" | "error"
      request_id: z.string(),
      response: z.unknown().optional(),
      error: z.string().optional(),
    }),
  }),
]);
export type CliMessage = z.infer<typeof CliMessage>;

/** The part of the `initialize` answer Kratos uses: the models this account can pick (D43). */
export const InitializeResponse = z.object({
  models: z.array(
    z.object({
      value: z.string(),
      displayName: z.string(),
      description: z.string().optional(),
      /** Effort levels this model takes, lowest first; absent = none (D51). */
      supportedEffortLevels: z.array(z.string()).optional(),
    }),
  ),
});

/** The input of Claude's AskUserQuestion tool, as the real CLI sends it (D54). */
export const AskUserQuestionInput = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        header: z.string().optional(),
        multiSelect: z.boolean().optional(),
        options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
      }),
    )
    .min(1),
});
export type AskUserQuestionInput = z.infer<typeof AskUserQuestionInput>;

/** The answer to `interrupt {send_now}` (D56): `stopped` / `delivering`, or `nothing_waiting`. */
export const SendNowResponse = z.object({ send_now: z.string().optional() });

/** The answer to `cancel_async_message` (D56). */
export const CancelAsyncMessageResponse = z.object({ cancelled: z.boolean() });

/** The answer to `set_permission_mode`: the mode the CLI applied ("manual" comes back as "default"). */
export const SetPermissionModeResponse = z.object({ mode: z.string() });

/** Answer to `generate_session_title` (3z4): Claude Code's own small model names the session. */
export const GenerateTitleResponse = z.object({ title: z.string() });

/** The part of the `get_settings` answer Kratos uses: what the CLI is really applying (D51).
 * (`effective` only merges settings files; `applied` is what the running model gets.) */
export const GetSettingsResponse = z.object({
  applied: z.object({ effort: z.string().nullable().optional() }).optional(),
});
