import type { AgentEvent } from "@kratos/core";
import { Block, type CliMessage } from "./protocol.js";
import { toolAction } from "./tool-action.js";

/** The image types Claude takes (the Claude API's): the attachment policy's, and the images a tool
 * result may carry to the UI (3z). Anything else stays "[image]" text. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

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
        if (b.type === "tool_use") {
          return [{ kind: "tool_call", id: b.id, tool: b.name, input: b.input, action: toolAction(b.name, b.input) }];
        }
        return [];
      });
    case "user": // tool results go back to Claude as a "user" message
      return blocks(msg.message.content).flatMap((b): AgentEvent[] => {
        if (b.type !== "tool_result") return [];
        const images = imagesOf(b.content);
        return [{ kind: "tool_result", id: b.tool_use_id, output: textOf(b.content), isError: b.is_error ?? false, ...(images.length > 0 ? { images } : {}) }];
      });
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

type ResultContent = Extract<Block, { type: "tool_result" }>["content"];

/** The images in a tool result (3z): a screenshot the agent read, as it saw it. */
function imagesOf(content: ResultContent): Array<{ mediaType: string; base64: string }> {
  if (!Array.isArray(content)) return [];
  return content.flatMap(({ type, source }) =>
    type === "image" && source?.type === "base64" && source.data && source.media_type && IMAGE_TYPES.includes(source.media_type)
      ? [{ mediaType: source.media_type, base64: source.data }]
      : [],
  );
}

function textOf(content: ResultContent): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n");
}
