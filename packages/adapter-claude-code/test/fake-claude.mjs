#!/usr/bin/env node
// Fake `claude` for adapter tests. Speaks the stream-json control protocol from D23, scripted by
// the prompt text. It reports what it received back as a tool_result, so tests can assert on it.
// Keep in sync with the real CLI: if this drifts, tests pass while real runs break.
import { createInterface } from "node:readline";

const REQUIRED = ["-p", "--input-format", "--output-format", "stream-json", "--permission-prompt-tool=stdio"];
if (!REQUIRED.every((arg) => process.argv.includes(arg))) {
  console.error(`fake-claude: missing RPC-mode args, got ${process.argv.slice(2).join(" ")}`);
  process.exit(2);
}

const out = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const waiting = new Map(); // request_id → resolve(response)
let lastBlocks = []; // content blocks of the last prompt with files (D55)
const cancelled = new Set();
let responsesAfterCancel = 0;
let onInterrupt = () => {};
// The model: from --model, switched by set_model (D43). A tiny version of the real `initialize` list.
const flag = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
let model = flag("--model") ?? "default";
const LEVELS = ["low", "medium", "high", "xhigh", "max"];
const MODELS = [
  { value: "default", displayName: "Default (recommended)", description: "Best for everyday tasks", supportedEffortLevels: LEVELS },
  { value: "haiku", displayName: "Haiku 5.5", description: "Fastest", supportedEffortLevels: LEVELS },
  { value: "claude-opus-4-6", displayName: "Opus 4.6", description: "No xhigh", supportedEffortLevels: ["low", "medium", "high", "max"] },
  { value: "claude-haiku-4-5", displayName: "Haiku 4.5", description: "No effort control" },
];
// Effort (D51), like the real CLI: --effort at start (unknown values ignored), apply_flag_settings
// live (says success even to unknown values, which change nothing); get_settings reports the level
// applied — the choice if the model has it, else the model's own default; null if it has none.
let effortChoice = LEVELS.includes(flag("--effort")) ? flag("--effort") : undefined;
// Permission modes (D53), like the real CLI: --permission-mode at start; set_permission_mode
// answers {mode} ("manual" → "default"), refuses unknown modes, and refuses Bypass unless started
// with --allow-dangerously-skip-permissions; every change is announced as a system/status line,
// and every turn starts with a system/init line carrying the mode.
const MODES = ["acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan"];
let mode = flag("--permission-mode") ?? "default";
const setMode = (next) => {
  if (next === mode) return;
  mode = next;
  out({ type: "system", subtype: "status", permissionMode: mode });
};
const appliedEffort = () => {
  const levels = MODELS.find((m) => m.value === model)?.supportedEffortLevels;
  if (!levels) return null;
  return levels.includes(effortChoice) ? effortChoice : model === "haiku" ? "medium" : "high";
};
const success = (request_id, response) => out({ type: "control_response", response: { subtype: "success", request_id, response } });

const input = { file_path: "a.txt", content: "hi" };
const toolUse = () =>
  out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Write", input }] }, parent_tool_use_id: null });
const ask = (request) => {
  out({ type: "control_request", request_id: "r1", request });
  return new Promise((resolve) => waiting.set("r1", resolve));
};
const report = (content, is_error = false) =>
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content, is_error }] }, parent_tool_use_id: null });
// Steering (D56), like the real CLI: a message tagged with a `uuid` gets command_lifecycle lines;
// one sent while a turn runs is held (queued), taken at the "steps" turn's step boundary (started,
// in the same turn), else it starts the next turn; cancel_async_message withdraws a held one;
// interrupt with cancel_queued withdraws them all.
let busy = false;
let turnPrompts = []; // uuids the running turn took
const held = []; // { uuid, content } waiting for the running turn
let deliverAll = false; // Send now: the next turn takes everything held at once
const lifecycle = (uuid, state) => uuid && out({ type: "command_lifecycle", command_uuid: uuid, state, uuid: `life-${uuid}-${state}` });
const finish = (subtype = "success") => {
  out({ type: "result", subtype });
  for (const uuid of turnPrompts) lifecycle(uuid, subtype === "success" ? "completed" : "cancelled");
  busy = false;
  turnPrompts = [];
  const next = held.shift();
  if (!next) return;
  const rest = deliverAll ? held.splice(0) : [];
  deliverAll = false;
  startTurn(next);
  for (const prompt of rest) {
    lifecycle(prompt.uuid, "started");
    turnPrompts.push(prompt.uuid);
  }
};
const startTurn = ({ uuid, content }) => {
  busy = true;
  turnPrompts = uuid ? [uuid] : [];
  lifecycle(uuid, "started");
  out({ type: "system", subtype: "init", permissionMode: mode });
  // A prompt with files is a list of content blocks (D55): the turn is named by its text block.
  lastBlocks = Array.isArray(content) ? content : [];
  const text = Array.isArray(content) ? content.find((b) => b.type === "text")?.text : content;
  const host = text?.startsWith("hosttool ") ? "hosttool" : text?.startsWith("hosttool-withdraw ") ? "hosttool-withdraw" : undefined;
  void (turns[text] ?? (host ? () => turns[host](text) : undefined))?.();
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Kratos's in-process tools (D77), like the real CLI: `--mcp-config` declares the "sdk" server,
// `initialize` names it; using a tool lists the tools, asks `can_use_tool`, then calls it — all as
// control requests to the adapter (`mcp_message` carries the JSON-RPC).
let sdkServers = [];
// `initialize` answered late (tests: FAKE_CLAUDE_INIT_DELAY_MS) — a prompt arriving before that
// answer would find no tools on the real CLI: noted, so a test sees the adapter held it back.
const INIT_DELAY = Number(process.env.FAKE_CLAUDE_INIT_DELAY_MS ?? 0);
let initAnswered = false;
let promptBeforeInit = false;
const mcp = async (message) => (await ask({ subtype: "mcp_message", server_name: "kratos", message })).response?.mcp_response;

const turns = {
  // "hosttool <name> <json input>": use one of Kratos's tools; report what each step answered.
  async hosttool(text) {
    const [, name, json] = text.match(/^hosttool (\S+) ?(.*)$/);
    const toolInput = json ? JSON.parse(json) : {};
    const listed = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: `mcp__kratos__${name}`, input: toolInput }] }, parent_tool_use_id: null });
    const permission = await ask({ subtype: "can_use_tool", tool_name: `mcp__kratos__${name}`, input: toolInput, tool_use_id: "t1" });
    const called = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: toolInput, _meta: { "claudecode/toolUseId": "t1" } } });
    report(JSON.stringify({
      servers: sdkServers,
      mcpConfig: flag("--mcp-config") ?? null,
      tools: listed?.result?.tools?.map((t) => ({ name: t.name, schema: t.inputSchema })),
      permission: permission.response?.behavior,
      result: called?.result,
      error: called?.error,
      promptBeforeInit,
    }));
    finish();
  },
  // "hosttool-withdraw <name>": call one of Kratos's tools, then withdraw the call mid-way, like the
  // real CLI does when its turn is stopped; report whether an answer still came.
  async "hosttool-withdraw"(text) {
    const name = text.split(" ")[1];
    void mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: {} } });
    await sleep(150);
    cancelled.add("r1");
    out({ type: "control_cancel_request", request_id: "r1" });
    await sleep(300);
    report(JSON.stringify({ responsesAfterCancel }));
    finish();
  },
  // Ask permission for a Write; report exactly what the adapter answered.
  async ask() {
    toolUse();
    const response = await ask({ subtype: "can_use_tool", tool_name: "Write", input, decision_reason: "edits need approval", tool_use_id: "t1" });
    report(JSON.stringify(response), response.response?.behavior === "deny");
    finish();
  },
  // A control request Kratos doesn't handle.
  async unknown() {
    report(JSON.stringify(await ask({ subtype: "mcp_message" })));
    finish();
  },
  // Ask, then withdraw the ask; count any answer that still arrives.
  async cancel() {
    toolUse();
    void ask({ subtype: "can_use_tool", tool_name: "Write", input });
    await sleep(100);
    cancelled.add("r1");
    out({ type: "control_cancel_request", request_id: "r1" });
    await sleep(300);
    report(`responses after cancel: ${responsesAfterCancel}`);
    finish();
  },
  // Ask and wait forever; an interrupt withdraws the ask and ends the turn like the real CLI.
  async hang() {
    toolUse();
    void ask({ subtype: "can_use_tool", tool_name: "Write", input });
    onInterrupt = () => {
      cancelled.add("r1");
      out({ type: "control_cancel_request", request_id: "r1" });
      finish("error_during_execution");
    };
  },
  async crash() {
    process.exit(1);
  },
  // Report which model we're on now.
  async model() {
    report(model);
    finish();
  },
  // Report the permission mode we're in.
  async mode() {
    report(mode);
    finish();
  },
  // Plan mode's way out: ask to leave with the plan; on approval, switch to default (like the CLI).
  async plan() {
    out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "ExitPlanMode", input: { plan: "1. do it" } }] }, parent_tool_use_id: null });
    const response = await ask({ subtype: "can_use_tool", tool_name: "ExitPlanMode", input: { plan: "1. do it" }, tool_use_id: "t1" });
    if (response.response?.behavior === "allow") setMode("default");
    report(mode);
    finish();
  },
  // Ask the owner questions like the real CLI (AskUserQuestion, D54); report what came back.
  async question() {
    const input = {
      questions: [
        { question: "Which model?", header: "Model", multiSelect: false, options: [{ label: "Opus (Recommended)", description: "Smartest" }, { label: "Haiku" }] },
        { question: "Which colors?", header: "Colors", multiSelect: true, options: [{ label: "Red" }, { label: "Blue" }, { label: "Green" }] },
      ],
    };
    out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "AskUserQuestion", input }] }, parent_tool_use_id: null });
    const response = await ask({ subtype: "can_use_tool", tool_name: "AskUserQuestion", input, tool_use_id: "t1", requires_user_interaction: true });
    report(JSON.stringify(response.response), response.response?.behavior === "deny");
    finish();
  },
  // A slow step, then a step boundary that takes every held prompt into this turn (D56); reports
  // which it read. Interruptible while the step runs.
  async steps() {
    out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "sleep" } }] }, parent_tool_use_id: null });
    const stopped = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 300);
      onInterrupt = () => (clearTimeout(timer), resolve(true));
    });
    onInterrupt = () => {};
    if (stopped) return finish("error_during_execution");
    report("step done");
    const read = held.splice(0);
    for (const prompt of read) {
      lifecycle(prompt.uuid, "started");
      turnPrompts.push(prompt.uuid);
    }
    out({ type: "assistant", message: { content: [{ type: "text", text: `read: ${read.map((p) => p.content).join(" | ") || "nothing"}` }] }, parent_tool_use_id: null });
    finish();
  },
  // A slow reply with no step boundary: a prompt held meanwhile becomes the next turn (D56).
  async slow() {
    await sleep(200);
    out({ type: "assistant", message: { content: [{ type: "text", text: "slow done" }] }, parent_tool_use_id: null });
    finish();
  },
  // Report the content blocks of the last prompt, minus the bytes (D55).
  async blocks() {
    report(JSON.stringify(lastBlocks.map((b) => ({ type: b.type, title: b.title, source: b.source && { type: b.source.type, media_type: b.source.media_type, length: b.source.data.length, data: b.source.type === "text" ? b.source.data : undefined } }))));
    finish();
  },
  // Report the environment variables the adapter set for us (D62).
  async env() {
    report(JSON.stringify({ CLAUDE_CODE_ARTIFACT: process.env.CLAUDE_CODE_ARTIFACT, CLAUDE_CODE_MCP_STARTUP_WAIT_MS: process.env.CLAUDE_CODE_MCP_STARTUP_WAIT_MS }));
    finish();
  },
  // Report the command-line arguments the adapter started us with.
  async args() {
    report(JSON.stringify(process.argv.slice(2)));
    finish();
  },
};

for await (const line of createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line);
  if (msg.type === "user") {
    if (sdkServers.length > 0 && !initAnswered) promptBeforeInit = true;
    const prompt = { uuid: msg.uuid, content: msg.message.content };
    lifecycle(prompt.uuid, "queued");
    if (busy) held.push(prompt); // steering: the running turn takes it at its next boundary
    else startTurn(prompt);
  }
  else if (msg.type === "control_request" && msg.request.subtype === "interrupt") {
    if (msg.request.cancel_queued) for (const prompt of held.splice(0)) lifecycle(prompt.uuid, "cancelled");
    if (msg.request.send_now) {
      // Like the real CLI's Send now: stop the step, then deliver *everything* held at once.
      deliverAll = held.length > 0;
      success(msg.request_id, { still_queued: held.map((p) => p.uuid), send_now: held.length === 0 ? "nothing_waiting" : busy ? "stopped" : "delivering" });
    } else success(msg.request_id, {});
    onInterrupt();
  }
  else if (msg.type === "control_request" && msg.request.subtype === "cancel_async_message") {
    const at = held.findIndex((p) => p.uuid === msg.request.message_uuid);
    if (at >= 0) lifecycle(held.splice(at, 1)[0].uuid, "cancelled");
    success(msg.request_id, { cancelled: at >= 0 });
  }
  else if (msg.type === "control_request" && msg.request.subtype === "initialize") {
    sdkServers = msg.request.sdkMcpServers ?? [];
    const answer = () => ((initAnswered = true), success(msg.request_id, { models: MODELS }));
    if (INIT_DELAY > 0) setTimeout(answer, INIT_DELAY);
    else answer();
  }
  // Like the real CLI's (3z4): a short title for what it's told the session is about.
  else if (msg.type === "control_request" && msg.request.subtype === "generate_session_title") {
    success(msg.request_id, { title: `Title: ${msg.request.description.split("\n")[0].slice(0, 30)}` });
  }
  else if (msg.type === "control_request" && msg.request.subtype === "set_model") {
    model = msg.request.model;
    success(msg.request_id, {});
  }
  else if (msg.type === "control_request" && msg.request.subtype === "apply_flag_settings") {
    const level = msg.request.settings?.effortLevel;
    if (LEVELS.includes(level)) effortChoice = level;
    success(msg.request_id, {});
  }
  else if (msg.type === "control_request" && msg.request.subtype === "set_permission_mode") {
    const wanted = msg.request.mode === "manual" ? "default" : msg.request.mode;
    const error = (text) => out({ type: "control_response", response: { subtype: "error", request_id: msg.request_id, error: text } });
    if (!MODES.includes(wanted)) error(`Cannot set permission mode: must be one of ${MODES.join(", ")}`);
    else if (wanted === "bypassPermissions" && !process.argv.includes("--allow-dangerously-skip-permissions")) {
      error("Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions");
    } else {
      setMode(wanted);
      success(msg.request_id, { mode });
    }
  }
  else if (msg.type === "control_request" && msg.request.subtype === "get_settings") {
    success(msg.request_id, { effective: {}, sources: [], applied: { model, effort: appliedEffort() } });
  }
  else if (msg.type === "control_response") {
    const id = msg.response.request_id;
    if (cancelled.has(id)) responsesAfterCancel++;
    else waiting.get(id)?.(msg.response);
  }
}
process.exit(0); // stdin closed: the adapter stopped us
