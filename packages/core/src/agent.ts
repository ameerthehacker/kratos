import { z } from "zod";

/**
 * The generic seam between Kratos and any coding agent (Claude Code, Codex CLI, …).
 * Kratos only ever talks to agents through these types, so the UI, plan, and gates never
 * depend on one vendor's output format. Decisions: DECISIONS.md D14–D19.
 */

// ── Events: what the agent did ──────────────────────────────────────────────────────────
// Data that crosses to the UI, so it's a zod schema (validated) with an inferred TS type.

export const AgentEvent = z.discriminatedUnion("kind", [
  /** A complete block of the agent's reply (not token-by-token). */
  z.object({ kind: z.literal("text"), text: z.string() }),
  /** The agent's visible reasoning, when the agent exposes it. */
  z.object({ kind: z.literal("thinking"), text: z.string() }),
  /** The agent is calling a tool. `id` links it to its tool_result. */
  z.object({ kind: z.literal("tool_call"), id: z.string(), tool: z.string(), input: z.unknown() }),
  z.object({ kind: z.literal("tool_result"), id: z.string(), output: z.string(), isError: z.boolean() }),
  /** The agent finished responding to a prompt. The session stays open for the next send(). */
  z.object({
    kind: z.literal("turn_end"),
    reason: z.enum(["completed", "interrupted", "error"]),
    error: z.string().optional(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

// ── Permission gate: Kratos decides before the agent runs a tool ────────────────────────

export const PermissionRequest = z.object({
  tool: z.string(),
  input: z.unknown(),
  /** Why the agent's own rules wanted a check, if it says. */
  reason: z.string().optional(),
});
export type PermissionRequest = z.infer<typeof PermissionRequest>;

export const PermissionDecision = z.discriminatedUnion("decision", [
  /** Run it. `updatedInput` lets the owner edit e.g. a command before it runs. */
  z.object({ decision: z.literal("allow"), updatedInput: z.unknown().optional() }),
  /** Don't run it. `message` is shown to the agent so it can change course. */
  z.object({ decision: z.literal("deny"), message: z.string() }),
]);
export type PermissionDecision = z.infer<typeof PermissionDecision>;

/**
 * Called by the adapter before every tool use the agent asks permission for, and awaited.
 * `signal` aborts if the turn is interrupted while waiting (e.g. close the approval prompt).
 */
export type RequestPermission = (
  request: PermissionRequest,
  options: { signal: AbortSignal },
) => Promise<PermissionDecision>;

// ── Adapter + session: behaviour, so plain TS interfaces ────────────────────────────────

/**
 * Which conversation a session belongs to (D36). `id` is chosen by Kratos and handed to the
 * agent; `resume: false` starts the conversation under that id, `resume: true` continues it.
 * Agents that can't name or resume conversations may ignore this.
 */
export type Conversation = { id: string; resume: boolean };

/** A model an agent offers (D43). `group`: "latest" = always-newest aliases, "other" = pinned. */
export const AgentModel = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  group: z.enum(["latest", "other"]),
});
export type AgentModel = z.infer<typeof AgentModel>;

/** A coding agent Kratos knows how to drive (a "harness"). One adapter per agent (e.g. "claude-code"). */
export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  /** The models this agent offers, as the agent itself reports them (never hardcoded). */
  listModels(): Promise<AgentModel[]>;
  /** Without `conversation`, a fresh, unnamed conversation; without `model`, the agent's default. */
  startSession(options: {
    cwd: string;
    requestPermission: RequestPermission;
    conversation?: Conversation;
    model?: string;
  }): AgentSession;
}

/** One running conversation with an agent. */
export interface AgentSession {
  /** Every event for the whole conversation. Ends when the session stops. Iterate it once. */
  readonly events: AsyncIterable<AgentEvent>;
  /** Send a prompt. Events arrive on `events`; the turn ends with a `turn_end` event. */
  send(prompt: string): void;
  /** Stop the current turn (emits turn_end "interrupted"); the session stays usable. */
  interrupt(): Promise<void>;
  /** Switch the running conversation to another model (from listModels). Resolves when the agent
   * confirms — which it reports on its output, so `events` must be being consumed (the hub always
   * does). */
  setModel(model: string): Promise<void>;
  /** End the conversation and clean up the agent's process; `events` then completes. */
  stop(): Promise<void>;
}
