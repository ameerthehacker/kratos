/**
 * DRAFT — to be reviewed and finalized in PLAN step 1. Nothing implements this yet.
 *
 * The generic seam between Kratos and any coding agent (Claude Code, Codex CLI, …).
 * Kratos only ever talks to agents through these types, so the UI, plan, and gates
 * never depend on one vendor's output format.
 */

/** A coding agent Kratos knows how to drive. One adapter per agent (e.g. "claude-code"). */
export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  /** Start a conversation with the agent in `cwd`. */
  startSession(options: { cwd: string }): AgentSession;
}

/** One running conversation with an agent. */
export interface AgentSession {
  /** Send a user prompt; yields normalized events until the agent finishes its turn. */
  send(prompt: string): AsyncIterable<AgentEvent>;
  /** Interrupt the agent and clean up its process. */
  stop(): Promise<void>;
}

/**
 * What the agent did, normalized across agents. Open questions for step 1:
 * - do we need token/cost usage events?
 * - how do we represent "agent wants permission" so Kratos can gate it?
 */
export type AgentEvent =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; tool: string; input: unknown }
  | { kind: "tool_result"; id: string; output: string; isError: boolean }
  | { kind: "done"; reason: "completed" | "stopped" | "error"; error?: string };
