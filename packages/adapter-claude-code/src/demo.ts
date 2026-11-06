#!/usr/bin/env node
// Demo: `pnpm --filter @kratos/adapter-claude-code demo --cwd <dir> "your prompt"`
// Prints every normalized AgentEvent; you answer each permission request in the terminal.
// --cwd is required: pnpm runs scripts from this package's folder, so "current dir" would make
// Claude act inside Kratos itself.
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import type { RequestPermission } from "@kratos/core";
import { createClaudeCodeAdapter } from "./index.js";

const { values, positionals } = parseArgs({ options: { cwd: { type: "string" } }, allowPositionals: true });
const prompt = positionals[0];
if (!prompt || !values.cwd) {
  console.error('usage: demo --cwd <dir> "<prompt>"');
  process.exit(1);
}
const cwd = resolve(values.cwd);
console.log(`Claude Code will act in: ${cwd}`);

// Read answers via readline's line iterator: it buffers lines, so piped answers work too.
const rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();

const askOwner: RequestPermission = async (req) => {
  console.log(`\n🔐 ${req.tool} wants to run with ${JSON.stringify(req.input)}`);
  if (req.reason) console.log(`   reason: ${req.reason}`);
  console.log("   allow? [y = yes, anything else = deny with that as the reason]");
  const next = await lines.next();
  const answer = next.done ? "" : next.value.trim();
  return answer === "y"
    ? { decision: "allow" }
    : { decision: "deny", message: answer || "The owner denied this." };
};

const session = createClaudeCodeAdapter().startSession({ cwd, requestPermission: askOwner });
session.send(prompt);

for await (const event of session.events) {
  console.log(JSON.stringify(event));
  if (event.kind === "turn_end") await session.stop();
}
rl.close();
