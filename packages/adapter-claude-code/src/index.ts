import { randomUUID } from "node:crypto";
import which from "which";
import { AgentEvent, type AgentAdapter, type AgentSession, type RequestPermission } from "@kratos/core";
import { JsonLinesProcess } from "./json-lines-process.js";
import { Block, CliMessage } from "./protocol.js";

/** Drives the owner's installed `claude` CLI in its stream-json RPC mode (D20, D23). */
export function createClaudeCodeAdapter(options: { claudePath?: string } = {}): AgentAdapter {
  const claudePath = options.claudePath ?? which.sync("claude", { nothrow: true });
  if (!claudePath) {
    throw new Error("Claude Code CLI (`claude`) not found on PATH. Install it or pass `claudePath`.");
  }
  return {
    id: "claude-code",
    displayName: "Claude Code",
    startSession: ({ cwd, requestPermission }) => startSession(claudePath, cwd, requestPermission),
  };
}

const CLI_ARGS = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--permission-prompt-tool=stdio", // permission asks come to us as control_request lines
];

type ControlRequest = Extract<CliMessage, { type: "control_request" }>;

function startSession(claudePath: string, cwd: string, requestPermission: RequestPermission): AgentSession {
  // One long-lived process per conversation (D14). The process class owns spawning, streams,
  // signals and cleanup (D26); this adapter only speaks Claude's protocol.
  const proc = new JsonLinesProcess(claudePath, CLI_ARGS, { cwd });

  const pending = new Map<string, AbortController>(); // permission asks still waiting for Kratos
  let interrupted = false;

  /** The gate: ask Kratos, then reply to the CLI. Fails closed (deny) if the callback throws. */
  async function answer({ request_id, request }: ControlRequest) {
    if (request.subtype !== "can_use_tool" || !request.tool_name) {
      const error = `Kratos does not handle control request "${request.subtype}"`;
      proc.send({ type: "control_response", response: { subtype: "error", request_id, error } });
      return;
    }
    const abort = new AbortController();
    pending.set(request_id, abort);
    const input = request.input ?? {};
    let response: object;
    try {
      const d = await requestPermission(
        { tool: request.tool_name, input, reason: request.decision_reason },
        { signal: abort.signal },
      );
      response = d.decision === "allow"
        ? { behavior: "allow", updatedInput: d.updatedInput ?? input }
        : { behavior: "deny", message: d.message };
    } catch (err) {
      response = { behavior: "deny", message: `Kratos permission check failed: ${String(err)}` };
    } finally {
      pending.delete(request_id);
    }
    // If the CLI withdrew the ask (control_cancel_request), it no longer wants an answer.
    if (!abort.signal.aborted) {
      proc.send({ type: "control_response", response: { subtype: "success", request_id, response } });
    }
  }

  async function* events(): AsyncGenerator<AgentEvent> {
    for await (const raw of proc.messages()) {
      const parsed = CliMessage.safeParse(raw);
      if (!parsed.success) continue; // a line kind Kratos doesn't use
      const msg = parsed.data;
      if (msg.type === "control_request") void answer(msg);
      else if (msg.type === "control_cancel_request") pending.get(msg.request_id)?.abort();
      else {
        for (const event of toEvents(msg, interrupted)) yield AgentEvent.parse(event);
        if (msg.type === "result") interrupted = false;
      }
    }
    // stdout ended. If nobody asked it to stop, claude died (or never started): say so.
    const exit = await proc.exited;
    if (!exit.requested) {
      const why = exit.message ?? `exit code ${exit.code ?? "?"}`;
      yield { kind: "turn_end", reason: "error", error: `claude exited unexpectedly: ${why}` };
    }
  }

  return {
    events: events(),
    send(prompt) {
      proc.send({ type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null });
    },
    async interrupt() {
      interrupted = true;
      proc.send({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } });
    },
    async stop() {
      for (const abort of pending.values()) abort.abort();
      await proc.stop();
    },
  };
}

/** Map one CLI message to our few normalized events; everything else is dropped. */
function toEvents(msg: CliMessage, interrupted: boolean): AgentEvent[] {
  // Messages from sub-agents (Claude's Task tool) are skipped in v1 (D21).
  if ("parent_tool_use_id" in msg && msg.parent_tool_use_id) return [];

  switch (msg.type) {
    case "assistant":
      return blocks(msg.message.content).flatMap((b): AgentEvent[] => {
        if (b.type === "text") return [{ kind: "text", text: b.text }];
        // Thinking text can be omitted by the CLI, leaving empty blocks: skip those.
        if (b.type === "thinking") return b.thinking ? [{ kind: "thinking", text: b.thinking }] : [];
        if (b.type === "tool_use") return [{ kind: "tool_call", id: b.id, tool: b.name, input: b.input }];
        return [];
      });
    case "user": // tool results go back to Claude as a "user" message
      return blocks(msg.message.content).flatMap((b): AgentEvent[] =>
        b.type === "tool_result"
          ? [{ kind: "tool_result", id: b.tool_use_id, output: textOf(b.content), isError: b.is_error ?? false }]
          : [],
      );
    case "result":
      if (interrupted) return [{ kind: "turn_end", reason: "interrupted" }];
      return msg.subtype === "success"
        ? [{ kind: "turn_end", reason: "completed" }]
        : [{ kind: "turn_end", reason: "error", error: msg.subtype }];
    default:
      return [];
  }
}

function blocks(content: string | unknown[]): Block[] {
  if (typeof content === "string") return [];
  return content.flatMap((raw) => {
    const parsed = Block.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}

function textOf(content: string | Array<{ type: string; text?: string }> | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n");
}
