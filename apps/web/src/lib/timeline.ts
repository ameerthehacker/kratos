import type { AgentEvent, ServerMessage, ToolAction } from "@kratos/core";

/** A small label under a step: a file's folder, "+12 −3", "✓ 18 passed", "Failed"… */
export type Chip = { text: string; tone: "path" | "muted" | "ok" | "bad" | "wait" };

/** One thing the agent did, in plain words (the owner's chat design, D45). */
export type Step = {
  id: string;
  kind: ToolAction["type"] | "think";
  title: string;
  chips: Chip[];
  /** Shown with "Show raw": a shell command (highlighted) or the tool's raw call, and its output. */
  raw: { command?: string; call?: string; output?: string };
  /** For edits: the file (relative to the project) and its before/after texts, for a diff preview. */
  edit?: { path: string; changes: NonNullable<ToolAction["edits"]> };
  /** While Kratos waits for the owner to allow or deny this call: what to answer (3c2b, 3c3). */
  ask?: OpenAsk;
  /** What the call would do, in present tense ("Edit math.js"): the ask card's question. */
  intent: string;
  /** The agent's tool name (to match its permission ask), and whether its result came back. */
  tool?: string;
  finished?: boolean;
};

/** A permission ask still waiting for the owner. `id` is what `permission_decision` answers. */
export type OpenAsk = { id: string; reason?: string };

export type TimelineItem =
  | { type: "prompt"; text: string }
  | { type: "reply"; text: string }
  | { type: "steps"; steps: Step[] }
  | { type: "event"; text: string };

type LogMessage = Exclude<ServerMessage, { type: "pong" | "error" | "session" | "sessions" | "harnesses" }>;
type ToolCall = Extract<AgentEvent, { kind: "tool_call" }>;

const OUTPUT_LINES = 20;
const DENIED = "You denied this";

/**
 * Turn a session's log into what the chat shows: prompts, replies, and runs of consecutive tool
 * calls grouped into steps (each with its result and its permission ask folded in).
 * `cwd` shortens paths to the project. Pure, so a replay renders exactly like the live view.
 */
export function buildTimeline(log: readonly LogMessage[], cwd = ""): TimelineItem[] {
  const items: TimelineItem[] = [];
  const steps = new Map<string, Step>(); // by tool call id
  const asks = new Map<string, Step>(); // by permission request id
  let group: Step[] | null = null;
  let thoughts = 0; // thinking has no id of its own
  const addStep = (step: Step) => {
    if (!group) items.push({ type: "steps", steps: (group = []) });
    group.push(step);
  };
  const breakGroup = () => void (group = null);

  for (const message of log) {
    if (message.type === "user_prompt") {
      breakGroup();
      items.push({ type: "prompt", text: message.text });
    } else if (message.type === "permission_request") {
      // The ask names its call (3c4); logs from before that are matched to the newest unanswered
      // call of the same tool. Without any match, the ask still shows, from its own data.
      const { request } = message;
      let step = request.toolCallId
        ? steps.get(request.toolCallId)
        : [...steps.values()].reverse().find((s) => !s.finished && !s.ask && s.tool === request.tool);
      if (!step) {
        const call = { kind: "tool_call" as const, id: request.toolCallId ?? `ask-${message.id}`, tool: request.tool, input: request.input, action: request.action };
        step = describe(call, cwd);
        steps.set(call.id, step);
        addStep(step);
      }
      step.ask = { id: message.id, reason: message.request.reason };
      asks.set(message.id, step);
    } else if (message.type === "permission_resolved") {
      const step = asks.get(message.id);
      if (step) {
        step.ask = undefined;
        if (message.outcome === "allowed") step.chips.push({ text: "You allowed this", tone: "ok" });
        if (message.outcome === "denied") {
          step.title = step.intent; // it never happened: "Write b.txt", not "Wrote b.txt"
          step.chips.push({ text: DENIED, tone: "bad" });
        }
        if (message.outcome === "cancelled") step.chips.push({ text: "Withdrawn", tone: "muted" });
      }
    } else {
      const event = message.event;
      if (event.kind === "text") {
        breakGroup();
        items.push({ type: "reply", text: event.text });
      } else if (event.kind === "thinking") {
        addStep({ id: `think-${thoughts++}`, kind: "think", title: "Thought it through", intent: "Think", chips: [], raw: { call: event.text } });
      } else if (event.kind === "tool_call") {
        const step = describe(event, cwd);
        steps.set(event.id, step);
        addStep(step);
      } else if (event.kind === "tool_result") {
        const step = steps.get(event.id);
        if (step) addResult(step, event.output, event.isError);
      } else if (event.kind === "turn_end" && event.reason !== "completed") {
        breakGroup();
        items.push({ type: "event", text: event.reason === "interrupted" ? "Stopped" : `Stopped: ${event.error ?? "agent error"}` });
      }
    }
  }
  return items;
}

function describe(call: ToolCall, cwd: string): Step {
  const action = call.action ?? { type: "other" as const };
  const path = action.target && relative(action.target, cwd);
  const chips: Chip[] = [];
  let title: string;
  let intent: string;
  switch (action.type) {
    case "read":
      title = `Read ${base(path)}`;
      intent = `Read ${base(path)}`;
      if (dir(path)) chips.push({ text: dir(path), tone: "path" });
      break;
    case "edit":
      // A whole-file write (no "before") reads as writing, not editing.
      if (action.edits?.length === 1 && action.edits[0]!.before === "") {
        title = `Wrote ${base(path)}`;
        intent = `Write ${base(path)}`;
      } else {
        title = `Edited ${base(path)}`;
        intent = `Edit ${base(path)}`;
      }
      if (dir(path)) chips.push({ text: dir(path), tone: "path" });
      if (action.added !== undefined || action.removed !== undefined) {
        chips.push({ text: `+${action.added ?? 0} −${action.removed ?? 0}`, tone: "muted" });
      }
      break;
    case "run":
      title = action.description ?? (isTest(action.command) ? "Ran the tests" : "Ran a command");
      intent = action.description ?? (isTest(action.command) ? "Run the tests" : "Run a command");
      break;
    case "search":
      title = `Searched for “${action.target ?? ""}”`;
      intent = `Search for “${action.target ?? ""}”`;
      break;
    case "web":
      title = `Looked up ${action.target ?? "the web"}`;
      intent = `Look up ${action.target ?? "the web"}`;
      break;
    case "task":
      title = `Handed off: ${action.description ?? "a sub-task"}`;
      intent = `Hand off: ${action.description ?? "a sub-task"}`;
      break;
    default:
      title = `Used ${call.tool}`;
      intent = `Use ${call.tool}`;
  }
  const raw = action.type === "run" && action.command ? { command: action.command } : { call: `${call.tool} ${compact(call.input)}` };
  const edit = action.type === "edit" && action.edits ? { path: path ?? "", changes: action.edits } : undefined;
  return { id: call.id, kind: action.type, title, intent, chips, raw, edit, tool: call.tool };
}

function addResult(step: Step, output: string, isError: boolean): void {
  step.finished = true;
  step.raw.output = trim(output);
  const denied = step.chips.some((c) => c.text === DENIED);
  if (isError && !denied) step.chips.push({ text: "Failed", tone: "bad" }); // a denial comes back as an error
  else if (step.kind === "run") {
    const passed = /(\d+)\s+passed/.exec(output);
    step.chips.push(passed ? { text: `✓ ${passed[1]} passed`, tone: "ok" } : { text: "✓ Done", tone: "ok" });
  }
}

const isTest = (command = "") => /\b(test|vitest|jest|pytest|playwright|e2e)\b/.test(command);
const base = (path = "") => path.split("/").filter(Boolean).pop() ?? "a file";
const dir = (path = "") => path.split("/").slice(0, -1).join("/");
const relative = (path: string, cwd: string) => (cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path);
const compact = (input: unknown) => {
  const json = JSON.stringify(input) ?? "";
  return json.length > 300 ? `${json.slice(0, 300)}…` : json;
};
function trim(output: string): string {
  const lines = output.replace(/\s+$/, "").split("\n");
  if (lines.length <= OUTPUT_LINES) return lines.join("\n");
  return [...lines.slice(0, OUTPUT_LINES), `… ${lines.length - OUTPUT_LINES} more lines`].join("\n");
}

/** Steps still waiting for the owner, oldest first: what the ask dock shows (3c3). */
export function openAsks(items: readonly TimelineItem[]): Step[] {
  return items.flatMap((item) => (item.type === "steps" ? item.steps.filter((step) => step.ask) : []));
}
