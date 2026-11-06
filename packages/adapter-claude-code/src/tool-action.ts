import type { ToolAction } from "@kratos/core";

/**
 * What a Claude Code tool call does, in Kratos's agent-neutral terms (D45). Only this adapter
 * knows Claude's tool names and input shapes; unknown tools become `other`.
 */
export function toolAction(tool: string, input: unknown): ToolAction {
  const i = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const str = (key: string) => (typeof i[key] === "string" ? (i[key] as string) : undefined);
  const lines = (key: string) => (str(key) !== undefined ? lineCount(str(key)!) : undefined);

  switch (tool) {
    case "Read":
      return { type: "read", target: str("file_path") };
    case "Write":
      return { type: "edit", target: str("file_path"), added: lines("content") };
    case "Edit":
      return { type: "edit", target: str("file_path"), added: lines("new_string"), removed: lines("old_string") };
    case "MultiEdit": {
      const edits = Array.isArray(i.edits) ? (i.edits as Array<Record<string, unknown>>) : [];
      const count = (key: string) => edits.reduce((n, e) => n + (typeof e[key] === "string" ? lineCount(e[key] as string) : 0), 0);
      return { type: "edit", target: str("file_path"), added: count("new_string"), removed: count("old_string") };
    }
    case "NotebookEdit":
      return { type: "edit", target: str("notebook_path") };
    case "Bash":
      return { type: "run", command: str("command"), description: str("description") };
    case "Grep":
    case "Glob":
      return { type: "search", target: str("pattern") };
    case "WebFetch":
      return { type: "web", target: str("url") };
    case "WebSearch":
      return { type: "web", target: str("query") };
    case "Task":
    case "Agent":
      return { type: "task", description: str("description") };
    default:
      return { type: "other" };
  }
}

/** Lines in a text, as an editor counts them: a trailing newline doesn't start a new line. */
function lineCount(text: string): number {
  if (text === "") return 0;
  return text.replace(/\n$/, "").split("\n").length;
}
