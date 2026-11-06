import type { AgentEvent } from "@kratos/core";
import { Block, type CliMessage } from "./protocol.js";

/**
 * Map one CLI message to our few normalized events; everything else is dropped.
 * Pure: no I/O, no state — `interrupted` is passed in by the session.
 */
export function toEvents(msg: CliMessage, interrupted: boolean): AgentEvent[] {
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
