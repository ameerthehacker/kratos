import { z } from "zod";

/**
 * The generic seam between Kratos and any coding agent (Claude Code, Codex CLI, …).
 * Kratos only ever talks to agents through these types, so the UI, plan, and gates never
 * depend on one vendor's output format. Decisions: DECISIONS.md D14–D19.
 */

// ── Events: what the agent did ──────────────────────────────────────────────────────────
// Data that crosses to the UI, so it's a zod schema (validated) with an inferred TS type.

/**
 * What a tool call does, in agent-neutral terms (D45): the adapter knows its agent's tools, the
 * UI only knows these. Lets the UI say "Read store.ts" or "Ran the tests" without knowing that
 * Claude calls them `Read` and `Bash`.
 */
export const ToolAction = z.object({
  type: z.enum(["read", "edit", "run", "search", "web", "task", "other"]),
  /** What it acts on: a file path, search pattern, URL or query. */
  target: z.string().optional(),
  /** For `run`: the shell command. */
  command: z.string().optional(),
  /** The agent's own one-line summary of the call, if it gave one. */
  description: z.string().optional(),
  /** For `edit`: lines written and replaced, when known. */
  added: z.number().optional(),
  removed: z.number().optional(),
  /**
   * For `edit`: the text replaced and written, for a readable preview (`before` is "" for a new
   * file). Each side is capped; `truncated` says the preview is partial (the call itself isn't).
   */
  edits: z.array(z.object({ before: z.string(), after: z.string(), truncated: z.boolean().optional() })).optional(),
});
export type ToolAction = z.infer<typeof ToolAction>;

export const AgentEvent = z.discriminatedUnion("kind", [
  /** A complete block of the agent's reply (not token-by-token). */
  z.object({ kind: z.literal("text"), text: z.string() }),
  /** The agent's visible reasoning, when the agent exposes it. */
  z.object({ kind: z.literal("thinking"), text: z.string() }),
  /** The agent is calling a tool. `id` links it to its tool_result. */
  z.object({
    kind: z.literal("tool_call"),
    id: z.string(),
    /** The agent's own tool name and input, as-is (shown raw on request). */
    tool: z.string(),
    input: z.unknown(),
    /** Agent-neutral meaning of the call (D45); absent in logs from before it existed. */
    action: ToolAction.optional(),
  }),
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
  /** The `tool_call` event this ask is about, when the agent says (3c4): asks attach by id. */
  toolCallId: z.string().optional(),
  /** Agent-neutral meaning of the call (D45), as on `tool_call`. */
  action: ToolAction.optional(),
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
  /** This entry is the agent's own default: choosing it means "no model chosen" (null, 3c4). */
  isDefault: z.boolean().optional(),
  /** How hard it can think, lowest first, in the agent's own words (e.g. "low" … "max"; D51).
   * Absent = this model has no effort control. */
  efforts: z.array(z.string()).optional(),
});
export type AgentModel = z.infer<typeof AgentModel>;

/** A coding agent Kratos knows how to drive (a "harness"). One adapter per agent (e.g. "claude-code"). */
export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  /** The models this agent offers, as the agent itself reports them (never hardcoded). */
  listModels(): Promise<AgentModel[]>;
  /** Without `conversation`, a fresh, unnamed conversation; without `model` or `effort`, the
   * agent's default. An `effort` the model lacks is the agent's to handle (Claude clamps it; D51). */
  startSession(options: {
    cwd: string;
    requestPermission: RequestPermission;
    conversation?: Conversation;
    model?: string;
    effort?: string;
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
  /** Switch the running conversation to another model (from listModels); `null` = back to the
   * agent's default (3c4). Resolves when the agent confirms — which it reports on its output, so
   * `events` must be being consumed (the hub always does). */
  setModel(model: string | null): Promise<void>;
  /** Switch the effort level (one of the current model's `efforts`); rejects a level it doesn't
   * list. Resolves when the agent confirms; like setModel, needs `events` consumed (D51). */
  setEffort(effort: string): Promise<void>;
  /** The effort level the agent is really using now (it may differ from what was asked, e.g.
   * after a model switch); null = none (the model has no effort control, or the agent won't say). */
  effort(): Promise<string | null>;
  /** End the conversation and clean up the agent's process; `events` then completes. */
  stop(): Promise<void>;
}
