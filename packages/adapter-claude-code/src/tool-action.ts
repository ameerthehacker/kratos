import type { ToolAction } from "@kratos/core";

/** Most text an edit preview keeps per side: the log stores it next to the full call (D45). */
const PREVIEW_CHARS = 8000;

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
      return { type: "edit", target: str("file_path"), added: lines("content"), edits: [edit("", str("content"))] };
    case "Edit":
      return {
        type: "edit",
        target: str("file_path"),
        added: lines("new_string"),
        removed: lines("old_string"),
        edits: [edit(str("old_string"), str("new_string"))],
      };
    case "MultiEdit": {
      const edits = Array.isArray(i.edits) ? (i.edits as Array<Record<string, unknown>>) : [];
      const count = (key: string) => edits.reduce((n, e) => n + (typeof e[key] === "string" ? lineCount(e[key] as string) : 0), 0);
      const texts = edits.map((e) => edit(typeof e.old_string === "string" ? e.old_string : "", typeof e.new_string === "string" ? e.new_string : ""));
      return { type: "edit", target: str("file_path"), added: count("new_string"), removed: count("old_string"), edits: texts };
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

/** One edit's before/after text for the preview, each side capped at PREVIEW_CHARS. */
function edit(before = "", after = ""): { before: string; after: string; truncated?: true } {
  const cut = before.length > PREVIEW_CHARS || after.length > PREVIEW_CHARS;
  const cap = (text: string) => text.slice(0, PREVIEW_CHARS);
  return cut ? { before: cap(before), after: cap(after), truncated: true } : { before, after };
}
