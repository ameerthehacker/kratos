import type { AgentEvent, AttachmentRef, QuestionAnswer, QuestionRequest, ServerMessage, ToolAction } from "@kratos/core";

/** A small label under a step: a file's folder, "+12 −3", "✓ 18 passed", "Failed"… */
export type Chip = { text: string; tone: "path" | "muted" | "ok" | "bad" | "wait" | "note" | "plain"; label?: string };

/** One thing the agent did, in plain words (the owner's chat design, D45). */
export type Step = {
  id: string;
  kind: ToolAction["type"] | "think" | "question";
  title: string;
  chips: Chip[];
  /** Shown with "Show raw": a shell command (highlighted) or the tool's raw call, and its output. */
  raw: { command?: string; call?: string; output?: string };
  /** For edits: the file (relative to the project) and its before/after texts, for a diff preview. */
  edit?: { path: string; changes: NonNullable<ToolAction["edits"]> };
  /** While Kratos waits for the owner to allow or deny this call: what to answer (3c2b, 3c3). */
  ask?: OpenAsk;
  /** The agent's questions (D54): what it asked, and how it ended (absent = still open). */
  question?: { id: string; request: QuestionRequest; outcome?: "answered" | "skipped" | "cancelled" };
  /** What the call would do, in present tense ("Edit math.js"): the ask card's question. */
  intent: string;
  /** What it is doing while it runs ("Editing math.js"): the working indicator (3d6). */
  doing: string;
  /** The agent's tool name (to match its permission ask), and whether its result came back. */
  tool?: string;
  finished?: boolean;
  /** Cut short by Send now (D56): shown as "Stopped running the tests", not as a failure. */
  stopped?: boolean;
};

/** How a prompt sent while the agent worked was read (D56), for the mark under its bubble. */
export type ReadMark = { how: "step" | "next_turn" | "now"; after?: string; stopped?: string };

/** A permission ask still waiting for the owner. `id` is what `permission_decision` answers. */
export type OpenAsk = { id: string; reason?: string };

export type TimelineItem =
  | { type: "prompt"; text: string; attachments?: AttachmentRef[]; read?: ReadMark }
  | { type: "reply"; text: string }
  | { type: "steps"; steps: Step[] }
  | { type: "event"; text: string };

type LogMessage = Exclude<ServerMessage, { type: "pong" | "error" | "session" | "session_ready" | "sessions" | "harnesses" | "prompts_returned" | "update" | "settings" }>;
type ToolCall = Extract<AgentEvent, { kind: "tool_call" }>;

const OUTPUT_LINES = 20;
const DENIED = "You denied this";

/**
 * Turn a session's log into what the chat shows: prompts, replies, and runs of consecutive tool
 * calls grouped into steps (each with its result and its permission ask folded in).
 * `cwd` shortens paths to the project; `agent` names it ("You skipped · Claude Code decides").
 * Pure, so a replay renders exactly like the live view.
 */
export function buildTimeline(log: readonly LogMessage[], cwd = "", agent = "The agent"): TimelineItem[] {
  const items: TimelineItem[] = [];
  const steps = new Map<string, Step>(); // by tool call id
  const asks = new Map<string, Step>(); // by permission request id
  const questions = new Map<string, Step>(); // by question request id
  const queued = new Map<string, Extract<LogMessage, { type: "prompt_queued" }>>(); // by prompt id (D56)
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
      items.push({ type: "prompt", text: message.text, ...(message.attachments ? { attachments: message.attachments } : {}) });
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
    } else if (message.type === "prompt_queued") {
      queued.set(message.id, message); // waits in the queue (the queue card is 3t3), not in the chat
    } else if (message.type === "prompt_read") {
      // Read by the agent: from here on it's part of the conversation, where it was read (D56).
      const prompt = queued.get(message.id);
      if (prompt) {
        // The step Send now cut short stays in the chat as stopped, not failed (the design).
        const stopped = message.stopped ? steps.get(message.stopped) : undefined;
        if (stopped) {
          stopped.stopped = true;
          stopped.title = `Stopped ${lowerFirst(stopped.doing)}`;
          stopped.chips = [];
        }
        // Send now ends the turn as interrupted; the stopped step says so already, so the generic
        // "Stopped" line just before it goes (the design shows only the step).
        const last = items.at(-1);
        if (message.how === "now" && last?.type === "event" && last.text === "Stopped") items.pop();
        const read: ReadMark = {
          how: message.how,
          ...(message.after && steps.get(message.after) ? { after: steps.get(message.after)!.title } : {}),
          ...(stopped ? { stopped: lowerFirst(stopped.doing) } : {}),
        };
        breakGroup();
        items.push({ type: "prompt", text: prompt.text, ...(prompt.attachments ? { attachments: prompt.attachments } : {}), read });
      }
    } else if (message.type === "prompt_removed") {
      queued.delete(message.id); // taken back or dropped: never part of the conversation
    } else if (message.type === "question_request") {
      // The questions ride on the agent's tool call (by id); without one, they show on their own.
      const { request } = message;
      let step = request.toolCallId ? steps.get(request.toolCallId) : undefined;
      if (!step) {
        step = { id: `question-${message.id}`, kind: "question", title: "", intent: "", doing: "", chips: [], raw: {} };
        addStep(step);
      }
      const count = request.questions.length;
      step.kind = "question";
      step.title = count === 1 ? "Asking a question" : `Asking ${count} questions`;
      step.intent = step.title;
      step.doing = step.title;
      step.question = { id: message.id, request };
      questions.set(message.id, step);
    } else if (message.type === "question_resolved") {
      const step = questions.get(message.id);
      if (step?.question) {
        const count = step.question.request.questions.length;
        step.question.outcome = message.outcome;
        step.title = count === 1 ? "Asked a question" : `Asked ${count} questions`;
        step.finished = true;
        step.chips = questionChips(step.question.request, message, agent);
      }
    } else {
      const event = message.event;
      if (event.kind === "text") {
        breakGroup();
        items.push({ type: "reply", text: event.text });
      } else if (event.kind === "thinking") {
        addStep({ id: `think-${thoughts++}`, kind: "think", title: "Thought it through", intent: "Think", doing: "Thinking", chips: [], raw: { call: event.text }, finished: true });
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
  let doing: string;
  switch (action.type) {
    case "read":
      title = `Read ${base(path)}`;
      intent = `Read ${base(path)}`;
      doing = `Reading ${base(path)}`;
      if (dir(path)) chips.push({ text: dir(path), tone: "path" });
      break;
    case "edit":
      // A whole-file write (no "before") reads as writing, not editing.
      if (action.edits?.length === 1 && action.edits[0]!.before === "") {
        title = `Wrote ${base(path)}`;
        intent = `Write ${base(path)}`;
        doing = `Writing ${base(path)}`;
      } else {
        title = `Edited ${base(path)}`;
        intent = `Edit ${base(path)}`;
        doing = `Editing ${base(path)}`;
      }
      if (dir(path)) chips.push({ text: dir(path), tone: "path" });
      if (action.added !== undefined || action.removed !== undefined) {
        chips.push({ text: `+${action.added ?? 0} −${action.removed ?? 0}`, tone: "muted" });
      }
      break;
    case "run":
      title = action.description ?? (isTest(action.command) ? "Ran the tests" : "Ran a command");
      intent = action.description ?? (isTest(action.command) ? "Run the tests" : "Run a command");
      // The agent's own description is a phrase like "Install deps": shown as-is.
      doing = action.description ?? (isTest(action.command) ? "Running the tests" : "Running a command");
      break;
    case "search":
      title = `Searched for “${action.target ?? ""}”`;
      intent = `Search for “${action.target ?? ""}”`;
      doing = `Searching for “${action.target ?? ""}”`;
      break;
    case "web":
      title = `Looked up ${action.target ?? "the web"}`;
      intent = `Look up ${action.target ?? "the web"}`;
      doing = `Looking up ${action.target ?? "the web"}`;
      break;
    case "task":
      title = `Handed off: ${action.description ?? "a sub-task"}`;
      intent = `Hand off: ${action.description ?? "a sub-task"}`;
      doing = `Working on ${action.description ?? "a sub-task"}`;
      break;
    default:
      title = `Used ${call.tool}`;
      intent = `Use ${call.tool}`;
      doing = `Using ${call.tool}`;
  }
  const raw = action.type === "run" && action.command ? { command: action.command } : { call: `${call.tool} ${compact(call.input)}` };
  const edit = action.type === "edit" && action.edits ? { path: path ?? "", changes: action.edits } : undefined;
  return { id: call.id, kind: action.type, title, intent, doing, chips, raw, edit, tool: call.tool };
}

function addResult(step: Step, output: string, isError: boolean): void {
  step.finished = true;
  step.raw.output = trim(output);
  // Questions say how they ended themselves; a skip comes back as an error, not a failure (D54).
  // Same for a step Send now stopped (D56).
  if (step.kind === "question" || step.stopped) return;
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

/**
 * What the agent is doing right now, for the working indicator (3d6): the newest step of the
 * current turn that hasn't finished and isn't waiting for you; null between steps (thinking or
 * writing its reply), or once it has replied after its last step.
 */
export function currentActivity(items: readonly TimelineItem[]): string | null {
  const last = items.at(-1);
  if (last?.type !== "steps") return null;
  const step = last.steps.at(-1);
  return step && !step.finished && !step.ask && !step.question ? step.doing : null;
}

/** What became of questions, as chips (the design): one per question, "Placement · Above the
 * export" (own text in quotes); or "You skipped · Claude Code decides"; or "Not answered". */
function questionChips(request: QuestionRequest, resolved: { outcome: string; answers?: QuestionAnswer[] }, agent: string): Chip[] {
  if (resolved.outcome === "skipped") return [{ text: `You skipped · ${agent} decides`, tone: "note" }];
  if (resolved.outcome !== "answered" || !resolved.answers) return [{ text: "Not answered", tone: "note" }];
  return request.questions.map((question, i) => {
    const answer = resolved.answers![i] ?? { selected: [] };
    const parts = [...answer.selected, ...(answer.other?.trim() ? [`“${answer.other.trim()}”`] : [])];
    return { label: question.header, text: parts.join(", "), tone: "plain" as const };
  });
}

/** The agent's questions still waiting for the owner, oldest first (for the question card). */
export function openQuestions(items: readonly TimelineItem[]): Array<{ id: string; request: QuestionRequest }> {
  return items.flatMap((item) =>
    item.type === "steps" ? item.steps.flatMap((s) => (s.question && !s.question.outcome ? [{ id: s.question.id, request: s.question.request }] : [])) : [],
  );
}

/** The prompts sent while the agent works that it hasn't read yet (D56), in order: the queue card. */
export function openQueue(log: readonly LogMessage[]): Array<Extract<LogMessage, { type: "prompt_queued" }>> {
  const open = new Map<string, Extract<LogMessage, { type: "prompt_queued" }>>();
  for (const message of log) {
    if (message.type === "prompt_queued") open.set(message.id, message);
    else if (message.type === "prompt_read" || message.type === "prompt_removed") open.delete(message.id);
  }
  return [...open.values()];
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
