import { tmpdir } from "node:os";
import which from "which";
import {
  AgentEvent,
  type AgentAdapter,
  type AgentAttachment,
  type AttachmentPolicy,
  type AgentModel,
  type AgentPermissionMode,
  type AgentSession,
  type Conversation,
} from "@kratos/core";
import { toolAction } from "./tool-action.js";
import { ControlChannel } from "./control-channel.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import { HOST_SERVER, HostToolServer, hostServerConfig, hostToolName } from "./host-tools.js";
import { JsonLinesProcess } from "./json-lines-process.js";
import { IMAGE_TYPES, toEvents } from "./map.js";
import {
  AskUserQuestionInput,
  CancelAsyncMessageResponse,
  SendNowResponse,
  CliMessage,
  GenerateTitleResponse,
  GetSettingsResponse,
  InitializeResponse,
  SetPermissionModeResponse,
} from "./protocol.js";

/** Drives the owner's installed `claude` CLI in its stream-json RPC mode (D20, D23). */
/** Claude Code's plan mode names a plan file of its own and hands what's in it to the approval ask
 * (4p6a, D79): told to write no plan file, it presented an empty plan; told nothing, it wrote a
 * second copy where Kratos keeps plans. So: the plan goes there, in Kratos's format. */
const PLAN_MODE_NOTE =
  "In Claude Code's plan mode, write the plan (in the plan format above) to the plan file plan mode names: that file is how it reaches the owner for approval. Not to Kratos's plan files.";

export function createClaudeCodeAdapter(options: { claudePath?: string } = {}): AgentAdapter {
  const claudePath = options.claudePath ?? which.sync("claude", { nothrow: true });
  if (!claudePath) {
    throw new Error("Claude Code CLI (`claude`) not found on PATH. Install it or pass `claudePath`.");
  }
  let models: Promise<AgentModel[]> | undefined; // asked once per run; retried after a failure
  const listModels = () =>
    (models ??= fetchModels(claudePath).catch((err) => {
      models = undefined;
      throw err;
    }));
  return {
    id: "claude-code",
    displayName: "Claude Code",
    listModels,
    permissionModes: PERMISSION_MODES,
    attachments: ATTACHMENTS,
    startSession: (options) => startSession(claudePath, options, listModels),
  };
}

/** Ask the CLI which models this account can use: start it, send `initialize`, read `models` (D43). */
async function fetchModels(claudePath: string): Promise<AgentModel[]> {
  const proc = new JsonLinesProcess(claudePath, CLI_ARGS, { cwd: tmpdir() });
  const control = new ControlChannel(proc);
  const reading = (async () => {
    for await (const raw of proc.messages()) {
      const parsed = CliMessage.safeParse(raw);
      if (parsed.success) control.handle(parsed.data);
    }
    control.close("claude exited before answering initialize");
  })();
  try {
    const answer = await control.request({ subtype: "initialize" }, { timeoutMs: 30_000 });
    return InitializeResponse.parse(answer).models.map((m) => ({
      id: m.value,
      label: m.displayName,
      description: m.description ?? "",
      // Aliases ("default", "opus", …) always mean the newest; full ids are pinned versions.
      group: m.value.startsWith("claude-") ? "other" : "latest",
      // Kratos says "no model chosen" with null; Claude's name for that is this entry (3c4).
      ...(m.value === CLAUDE_DEFAULT_MODEL ? { isDefault: true } : {}),
      ...(m.supportedEffortLevels?.length ? { efforts: m.supportedEffortLevels } : {}),
    }));
  } finally {
    await proc.stop();
    await reading;
  }
}

/**
 * Claude Code's permission modes (D53), from `claude --help` and checked on the real CLI. The CLI
 * has no request that lists them, so the adapter knows them; the CLI still refuses unknown ones.
 */
const PERMISSION_MODES: AgentPermissionMode[] = [
  { id: "default", label: "Ask before acting", shortLabel: "Ask", kind: "ask", description: "Asks before editing files or running commands.", isDefault: true },
  { id: "acceptEdits", label: "Accept edits", shortLabel: "Accept edits", kind: "edits", description: "Edits files without asking; asks before other commands." },
  { id: "plan", label: "Plan first", shortLabel: "Plan", kind: "plan", description: "Only reads and plans; asks you to approve the plan before changing anything." },
  { id: "auto", label: "Auto", shortLabel: "Auto", kind: "auto", description: "Claude Code's own checker decides what needs your approval." },
  { id: "dontAsk", label: "Don't ask", shortLabel: "Don't ask", kind: "never_ask", description: "Never asks: anything not already allowed is refused." },
  {
    id: "bypassPermissions",
    label: "Bypass permissions",
    shortLabel: "Bypass",
    kind: "bypass",
    description: "No checks at all: every edit and command runs without asking.",
    dangerous: true,
  },
];
const CLAUDE_DEFAULT_MODE = "default";

/** What Claude Code takes with a prompt (D55): the Claude API's limits for images and PDFs; text
 * files up to 1 MB (judged by content); the API's 32 MB request cap leaves room for 30 MB. */
const MB = 1024 * 1024;
const ATTACHMENTS: AttachmentPolicy = {
  kinds: [
    { kind: "image", mediaTypes: IMAGE_TYPES, maxBytes: 5 * MB },
    { kind: "pdf", mediaTypes: ["application/pdf"], maxBytes: 30 * MB },
    { kind: "text", mediaTypes: [], maxBytes: 1 * MB },
  ],
  maxCount: 10,
  maxTotalBytes: 30 * MB,
};

/** A file as a content block of the stream-json user message (verified on the real CLI, D55):
 * images and PDFs as base64, text as a text document titled with its file name. */
function contentBlock(file: AgentAttachment): object {
  const base64 = Buffer.from(file.data).toString("base64");
  if (file.kind === "image") return { type: "image", source: { type: "base64", media_type: file.mediaType, data: base64 } };
  if (file.kind === "pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 }, title: file.name };
  return { type: "document", source: { type: "text", media_type: "text/plain", data: Buffer.from(file.data).toString("utf8") }, title: file.name };
}

/** The prompt states Kratos follows (D56); the CLI may add others — they're ignored. */
type PromptState = "queued" | "started" | "completed" | "cancelled";
const PROMPT_STATES: PromptState[] = ["queued", "started", "completed", "cancelled"];

/** Claude's question tool (D54), its "this one's my pick" label suffix, and what a skip tells it. */
const ASK_TOOL = "AskUserQuestion";
const RECOMMENDED = /\s*\(recommended\)\s*$/i;
const SKIPPED = "The user skipped these questions. Make your own call and carry on.";

/** Claude's own model id for "its default"; Kratos uses null for that and maps it here (3c4). */
const CLAUDE_DEFAULT_MODEL = "default";

const CLI_ARGS = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--permission-prompt-tool=stdio", // permission asks come to us as control_request lines
];

/**
 * What headless `claude` turns off or leaves to chance unless asked (D62); your own environment
 * wins if it sets these. Both are undocumented CLI internals, read from claude 2.1.308:
 * - Artifacts (claude.ai designs, pages): off by default for SDK/`-p` sessions, on in the terminal.
 * - claude.ai connectors (MCP) connect in the background; without a wait, the first turn of every
 *   new process (each Kratos start, each resume) runs while they're still "pending".
 */
export function cliEnv(own: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    CLAUDE_CODE_ARTIFACT: own.CLAUDE_CODE_ARTIFACT ?? "1",
    CLAUDE_CODE_MCP_STARTUP_WAIT_MS: own.CLAUDE_CODE_MCP_STARTUP_WAIT_MS ?? "10000", // a cap: usually ~1 s
  };
}

/** Name the conversation (new) or continue it (resume) — Claude keeps its own transcript (D36). */
function conversationArgs(conversation?: Conversation): string[] {
  if (!conversation) return [];
  return conversation.resume ? ["--resume", conversation.id] : ["--session-id", conversation.id];
}

type ControlRequest = Extract<CliMessage, { type: "control_request" }>;

function startSession(
  claudePath: string,
  options: Parameters<AgentAdapter["startSession"]>[0],
  listModels: () => Promise<AgentModel[]>,
): AgentSession {
  const { cwd, requestPermission, askQuestions, conversation, model, effort, permissionMode, tools = [], instructions } = options;
  // One long-lived process per conversation (D14). The process class owns spawning, streams,
  // signals and cleanup (D26); this adapter only speaks Claude's protocol. A start --effort the
  // model lacks is fine: the CLI clamps it to one the model has (verified, D51).
  const args = [
    ...CLI_ARGS,
    ...conversationArgs(conversation),
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : []),
    ...(permissionMode ? ["--permission-mode", permissionMode] : []),
    // Makes Bypass reachable by set_permission_mode later; it doesn't turn it on (D53).
    "--allow-dangerously-skip-permissions",
    // Kratos's own tools, as an in-process MCP server (D77).
    ...(tools.length > 0 ? ["--mcp-config", hostServerConfig()] : []),
    // Kratos's standing instructions (4p2), after Claude Code's own system prompt, with what's
    // Claude Code's own about planning.
    ...(instructions ? ["--append-system-prompt", `${instructions}\n\n${PLAN_MODE_NOTE}`] : []),
  ];
  const proc = new JsonLinesProcess(claudePath, args, { cwd, env: cliEnv() });
  let currentModel = model ?? CLAUDE_DEFAULT_MODEL; // for checking effort levels against
  let currentMode = permissionMode ?? CLAUDE_DEFAULT_MODE; // to report only real changes
  const ourPrompts = new Set<string>(); // ids we sent: lifecycle lines for others are the CLI's own

  const control = new ControlChannel(proc); // requests we send (set_model, effort, interrupt)
  const pending = new Map<string, AbortController>(); // permission asks still waiting for Kratos
  let interrupted = false;
  // With host tools, `initialize` names their server first (D77); prompts wait for its answer, so
  // the first turn already has them. Prompts wait in order; the requests about prompts (interrupt,
  // send now, cancel a prompt) wait for `ready` too, so they never overtake one that isn't there yet.
  const hostServer = tools.length > 0 ? new HostToolServer(tools) : null;
  const hostToolNames = new Set(tools.map((t) => hostToolName(t.name)));
  let held: object[] | null = hostServer ? [] : null;
  const ready: Promise<void> = hostServer
    ? control
        .request({ subtype: "initialize", sdkMcpServers: [HOST_SERVER] }, { timeoutMs: 30_000 })
        .then(
          () => {},
          () => {}, // the tools are then missing; the session still works
        )
        .finally(() => {
          const waiting = held ?? [];
          held = null;
          for (const message of waiting) proc.send(message);
        })
    : Promise.resolve();
  const sendPrompt = (message: object) => (held ? held.push(message) : proc.send(message));
  // A call to one of our tools says what it does in words (4m3): its step, and its ask, read so.
  const byName = new Map(tools.map((t) => [hostToolName(t.name), t]));
  const describeHostCall = <E extends { kind: string }>(event: E): E => {
    if (event.kind !== "tool_call") return event;
    const call = event as E & { tool: string; input: unknown };
    let described: string | undefined;
    try {
      described = byName.get(call.tool)?.describe?.(call.input);
    } catch {
      return event; // a describe that fails on odd input mustn't end the session: the step says the tool's name
    }
    return described ? { ...event, action: { type: "other", description: described } } : event;
  };

  /**
   * Answer one of the CLI's `can_use_tool` asks: questions go to `askQuestions` (D54), every other
   * tool to the permission gate. Fails closed (deny) if Kratos's callback throws; sends nothing if
   * the CLI withdrew the ask meanwhile (control_cancel_request).
   */
  async function answer({ request_id, request }: ControlRequest) {
    const respond = (response: object) => proc.send({ type: "control_response", response: { subtype: "success", request_id, response } });
    const refuse = (error: string) => proc.send({ type: "control_response", response: { subtype: "error", request_id, error } });
    // Our own tools aren't put through the gate: one that needs the owner's yes asks in its call,
    // in every permission mode (Bypass skips this ask altogether, D77).
    if (request.subtype === "can_use_tool" && request.tool_name && hostToolNames.has(request.tool_name)) {
      respond({ behavior: "allow", updatedInput: request.input ?? {} });
      return;
    }
    // Still waiting on Kratos: the CLI withdrawing it (control_cancel_request) aborts it.
    const abort = new AbortController();
    if (request.subtype === "mcp_message" && request.server_name === HOST_SERVER && hostServer) {
      const message = JSONRPCMessageSchema.safeParse(request.message);
      if (!message.success) return refuse("Not a JSON-RPC message");
      const id = "id" in message.data ? message.data.id : undefined;
      abort.signal.addEventListener("abort", () => id !== undefined && id !== null && hostServer.cancel(id), { once: true });
      pending.set(request_id, abort);
      const mcp_response = await hostServer.answer(message.data).finally(() => pending.delete(request_id));
      if (!abort.signal.aborted) respond({ mcp_response });
      return;
    }
    if (request.subtype !== "can_use_tool" || !request.tool_name) {
      return refuse(`Kratos does not handle control request "${request.subtype}"`);
    }
    pending.set(request_id, abort);
    const input = request.input ?? {};
    let response: object;
    try {
      response = request.tool_name === ASK_TOOL
        ? await askOwner(input, request.tool_use_id, abort.signal)
        : await gate(request.tool_name, input, request, abort.signal);
    } catch (err) {
      response = { behavior: "deny", message: `Kratos permission check failed: ${String(err)}` };
    } finally {
      pending.delete(request_id);
    }
    if (!abort.signal.aborted) respond(response);
  }

  /** The permission gate: allow (maybe with edited input) or deny with the owner's message. */
  async function gate(tool: string, input: Record<string, unknown>, request: ControlRequest["request"], signal: AbortSignal) {
    const d = await requestPermission(
      { tool, input, reason: request.decision_reason, toolCallId: request.tool_use_id, action: toolAction(tool, input) },
      { signal },
    );
    if (d.decision === "deny") return { behavior: "deny", message: d.message };
    return { behavior: "allow", updatedInput: approvedInput(tool, (d.updatedInput ?? input) as Record<string, unknown>, d.plan, d.message) };
  }

  /**
   * The agent's questions (D54), verified on the real CLI: the answer is the tool's input plus
   * `answers: {"<question>": "<label>"}` (several picks, and the owner's own text, joined with
   * ", "); skipping is a deny the agent carries on from. Never allow without answers — the CLI
   * reads that as "the user did not answer".
   */
  async function askOwner(input: Record<string, unknown>, toolCallId: string | undefined, signal: AbortSignal) {
    const parsed = AskUserQuestionInput.safeParse(input);
    if (!askQuestions || !parsed.success) {
      return { behavior: "deny", message: "Kratos couldn't show these questions to the user. Make your own call and carry on." };
    }
    const asked = parsed.data.questions;
    const reply = await askQuestions(
      {
        toolCallId,
        questions: asked.map((q) => ({
          header: q.header ?? "",
          question: q.question,
          multiSelect: q.multiSelect ?? false,
          options: q.options.map((o) => ({
            label: o.label.replace(RECOMMENDED, ""),
            ...(o.description ? { description: o.description } : {}),
            ...(RECOMMENDED.test(o.label) ? { recommended: true } : {}),
          })),
        })),
      },
      { signal },
    );
    if (reply.outcome === "skipped") return { behavior: "deny", message: SKIPPED };
    const answers = Object.fromEntries(
      asked.map((q, i) => {
        const answer = reply.answers[i] ?? { selected: [] };
        // Back to the agent's own labels ("Opus (Recommended)"), which it knows.
        const picked = answer.selected.map((label) => q.options.find((o) => o.label.replace(RECOMMENDED, "") === label)?.label ?? label);
        return [q.question, [...picked, ...(answer.other?.trim() ? [answer.other.trim()] : [])].join(", ")];
      }),
    );
    return { behavior: "allow", updatedInput: { ...input, answers } };
  }

  async function* events(): AsyncGenerator<AgentEvent> {
    for await (const raw of proc.messages()) {
      const parsed = CliMessage.safeParse(raw);
      if (!parsed.success) continue; // a line kind Kratos doesn't use
      const msg = parsed.data;
      if (control.handle(msg)) continue; // an answer to one of our requests
      if (msg.type === "command_lifecycle") {
        if (ourPrompts.has(msg.command_uuid) && PROMPT_STATES.includes(msg.state as PromptState)) {
          yield { kind: "prompt_state", id: msg.command_uuid, state: msg.state as PromptState };
        }
        continue;
      }
      if (msg.type === "system") {
        // The CLI repeats the mode at every turn's start: only a change is an event (D53).
        if (msg.permissionMode && msg.permissionMode !== currentMode) {
          currentMode = msg.permissionMode;
          yield { kind: "permission_mode", mode: currentMode };
        }
        continue;
      }
      if (msg.type === "control_request") void answer(msg);
      else if (msg.type === "control_cancel_request") pending.get(msg.request_id)?.abort();
      else {
        for (const event of toEvents(msg, interrupted)) yield AgentEvent.parse(describeHostCall(event));
        if (msg.type === "result") interrupted = false;
      }
    }
    control.close("claude exited"); // requests still waiting will never be answered
    for (const abort of pending.values()) abort.abort(); // nor will asks and host tool calls be read
    // If nobody asked it to stop, claude died (or never started): say so.
    const exit = await proc.exited;
    if (!exit.requested) {
      const why = exit.message ?? `exit code ${exit.code ?? "?"}`;
      yield { kind: "turn_end", reason: "error", error: `claude exited unexpectedly: ${why}` };
    }
  }

  return {
    events: events(),
    send(prompt, attachments = [], options = {}) {
      // With files: the files first, then the prompt that's about them (D55).
      const content = attachments.length > 0 ? [...attachments.map(contentBlock), { type: "text", text: prompt }] : prompt;
      // Tagged with our id, the CLI reports what becomes of it (command_lifecycle, D56).
      if (options.id) ourPrompts.add(options.id);
      sendPrompt({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, ...(options.id ? { uuid: options.id } : {}) });
    },
    async cancelPrompt(id) {
      await ready; // a prompt still held must reach the CLI first, or it can't be cancelled
      const answer = await control.request({ subtype: "cancel_async_message", message_uuid: id });
      return CancelAsyncMessageResponse.parse(answer).cancelled;
    },
    async sendNow(id) {
      // The CLI's own Send now (verified, D56): stops the step and delivers what it holds. The
      // stopped turn ends like an interrupt.
      interrupted = true;
      await ready;
      const answer = SendNowResponse.parse(await control.request({ subtype: "interrupt", send_now: true, message_uuid: id }));
      if (answer.send_now === "nothing_waiting") interrupted = false; // nothing was stopped
    },
    async interrupt(options = {}) {
      interrupted = true;
      // Not awaited: the turn's end is reported as `turn_end: interrupted` on `events`; withdrawn
      // prompts as `prompt_state` cancelled (D56).
      // After `ready`: an interrupt must not overtake a prompt still held (D77).
      void ready.then(() => control.request({ subtype: "interrupt", ...(options.cancelQueued ? { cancel_queued: true } : {}) })).catch(() => {});
    },
    // null = back to the agent's default, which Claude calls "default" (D43, 3c4).
    async setModel(model) {
      await control.request({ subtype: "set_model", model: model ?? CLAUDE_DEFAULT_MODEL });
      currentModel = model ?? CLAUDE_DEFAULT_MODEL;
    },
    async setEffort(level) {
      // The CLI says "success" to any level, even one it then ignores: only send real ones (D51).
      const levels = (await listModels().catch(() => [])).find((m) => m.id === currentModel)?.efforts ?? [];
      if (!levels.includes(level)) {
        throw new Error(`${currentModel} has no effort level "${level}" (it has: ${levels.join(", ") || "none"})`);
      }
      await control.request({ subtype: "apply_flag_settings", settings: { effortLevel: level } });
    },
    async setPermissionMode(mode) {
      // The CLI refuses unknown modes itself, and Bypass unless started with the allow flag.
      const answer = await control.request({ subtype: "set_permission_mode", mode });
      return SetPermissionModeResponse.parse(answer).mode;
    },
    async effort() {
      const answer = GetSettingsResponse.parse(await control.request({ subtype: "get_settings" }, { timeoutMs: 30_000 }));
      return answer.applied?.effort ?? null;
    },
    async title(description) {
      // persist: false — Kratos keeps the session's title, not the CLI's own session list.
      const answer = await control.request({ subtype: "generate_session_title", description, persist: false }, { timeoutMs: 30_000 });
      return GenerateTitleResponse.parse(answer).title;
    },
    async stop() {
      for (const abort of pending.values()) abort.abort();
      await proc.stop();
    },
  };
}

/**
 * What an allow hands Claude, for an approved plan: your version of the plan (4p6b), and the
 * allow's word to the agent after it (4p6a) — `ExitPlanMode`'s result quotes the plan back to the
 * agent ("## Approved Plan: …"), and Claude's allow carries no message of its own. Other tools:
 * as they were.
 */
function approvedInput(tool: string, input: Record<string, unknown>, plan: string | undefined, message: string | undefined): Record<string, unknown> {
  if (tool !== "ExitPlanMode") return input;
  const text = plan ?? (typeof input.plan === "string" ? input.plan : undefined);
  if (text === undefined) return input;
  return { ...input, plan: message ? `${text.trimEnd()}\n\n---\n${message}` : text };
}
