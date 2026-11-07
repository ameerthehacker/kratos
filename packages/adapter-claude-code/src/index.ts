import { tmpdir } from "node:os";
import which from "which";
import {
  AgentEvent,
  type AgentAdapter,
  type AgentModel,
  type AgentSession,
  type Conversation,
} from "@kratos/core";
import { toolAction } from "./tool-action.js";
import { ControlChannel } from "./control-channel.js";
import { JsonLinesProcess } from "./json-lines-process.js";
import { toEvents } from "./map.js";
import { CliMessage, GetSettingsResponse, InitializeResponse } from "./protocol.js";

/** Drives the owner's installed `claude` CLI in its stream-json RPC mode (D20, D23). */
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

/** Claude's own model id for "its default"; Kratos uses null for that and maps it here (3c4). */
const CLAUDE_DEFAULT_MODEL = "default";

const CLI_ARGS = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--permission-prompt-tool=stdio", // permission asks come to us as control_request lines
];

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
  const { cwd, requestPermission, conversation, model, effort } = options;
  // One long-lived process per conversation (D14). The process class owns spawning, streams,
  // signals and cleanup (D26); this adapter only speaks Claude's protocol. A start --effort the
  // model lacks is fine: the CLI clamps it to one the model has (verified, D51).
  const args = [
    ...CLI_ARGS,
    ...conversationArgs(conversation),
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : []),
  ];
  const proc = new JsonLinesProcess(claudePath, args, { cwd });
  let currentModel = model ?? CLAUDE_DEFAULT_MODEL; // for checking effort levels against

  const control = new ControlChannel(proc); // requests we send (set_model, effort, interrupt)
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
        {
          tool: request.tool_name,
          input,
          reason: request.decision_reason,
          toolCallId: request.tool_use_id,
          action: toolAction(request.tool_name, input),
        },
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
      if (control.handle(msg)) continue; // an answer to one of our requests
      if (msg.type === "control_request") void answer(msg);
      else if (msg.type === "control_cancel_request") pending.get(msg.request_id)?.abort();
      else {
        for (const event of toEvents(msg, interrupted)) yield AgentEvent.parse(event);
        if (msg.type === "result") interrupted = false;
      }
    }
    control.close("claude exited"); // requests still waiting will never be answered
    // If nobody asked it to stop, claude died (or never started): say so.
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
      // Not awaited: the turn's end is reported as `turn_end: interrupted` on `events`.
      control.request({ subtype: "interrupt" }).catch(() => {});
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
    async effort() {
      const answer = GetSettingsResponse.parse(await control.request({ subtype: "get_settings" }, { timeoutMs: 30_000 }));
      return answer.applied?.effort ?? null;
    },
    async stop() {
      for (const abort of pending.values()) abort.abort();
      await proc.stop();
    },
  };
}
