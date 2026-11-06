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
const cancelled = new Set();
let responsesAfterCancel = 0;
let onInterrupt = () => {};
// The model: from --model, switched by set_model (D43). A tiny version of the real `initialize` list.
let model = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "default";
const MODELS = [
  { value: "default", displayName: "Default (recommended)", description: "Best for everyday tasks" },
  { value: "haiku", displayName: "Haiku 5.5", description: "Fastest" },
  { value: "claude-opus-4-8", displayName: "Opus 4.8", description: "Pinned older version" },
];
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
const finish = (subtype = "success") => out({ type: "result", subtype });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const turns = {
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
  // Report the command-line arguments the adapter started us with.
  async args() {
    report(JSON.stringify(process.argv.slice(2)));
    finish();
  },
};

for await (const line of createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line);
  if (msg.type === "user") void turns[msg.message.content]?.();
  else if (msg.type === "control_request" && msg.request.subtype === "interrupt") onInterrupt();
  else if (msg.type === "control_request" && msg.request.subtype === "initialize") success(msg.request_id, { models: MODELS });
  else if (msg.type === "control_request" && msg.request.subtype === "set_model") {
    model = msg.request.model;
    success(msg.request_id, {});
  }
  else if (msg.type === "control_response") {
    const id = msg.response.request_id;
    if (cancelled.has(id)) responsesAfterCancel++;
    else waiting.get(id)?.(msg.response);
  }
}
process.exit(0); // stdin closed: the adapter stopped us
