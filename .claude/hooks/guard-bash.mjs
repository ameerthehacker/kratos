// Kratos v0 guardrail: PreToolUse hook for Bash.
// Risky or decision-making commands are escalated to the owner ("ask") instead of auto-running.
// shell-quote tokenizes the command, so chains (`cd x && pnpm add y`) are checked piece by piece
// and quoted text (`echo "pnpm add"`) isn't mistaken for a command.
import { readFileSync } from "node:fs";
import { parse } from "shell-quote";

const DEP_REASON = "adds a dependency — explain why and log it in DECISIONS.md";

const RULES = [
  {
    why: DEP_REASON,
    test: ([cmd, ...args]) => {
      if (!["pnpm", "npm", "yarn", "bun"].includes(cmd)) return false;
      const sub = args.findIndex((a) => ["add", "install", "i"].includes(a));
      return sub !== -1 && args.slice(sub + 1).some((a) => !a.startsWith("-"));
    },
  },
  {
    why: DEP_REASON,
    test: ([cmd, ...args]) => ["pip", "pip3", "uv"].includes(cmd) && args.some((a) => a === "install" || a === "add"),
  },
  { why: "publishes commits", test: ([cmd, ...args]) => cmd === "git" && args.includes("push") },
  {
    why: "recursively force-deletes files",
    test: ([cmd, ...args]) => {
      if (cmd !== "rm") return false;
      const flags = args.filter((a) => a.startsWith("-")).join(" ");
      const recursive = /(^|\s)-[a-zA-Z]*[rR]|--recursive/.test(flags);
      const force = /(^|\s)-[a-zA-Z]*f|--force/.test(flags);
      return recursive && force;
    },
  },
];

const input = JSON.parse(readFileSync(0, "utf8"));
const command = input.tool_input?.command ?? "";

for (const words of simpleCommands(command)) {
  const hit = RULES.find((r) => r.test(words));
  if (hit) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `Kratos: \`${words.join(" ")}\` ${hit.why}.`,
      },
    }));
    break;
  }
}
process.exit(0);

/** Split a shell line into simple commands (word arrays), dropping env assignments and sudo. */
function simpleCommands(line) {
  const tokens = parse(line, (name) => `$${name}`);
  const commands = [[]];
  for (const t of tokens) {
    if (typeof t === "string") commands.at(-1).push(t);
    else if ("pattern" in t) commands.at(-1).push(t.pattern); // globs like *.ts
    else if ("op" in t) commands.push([]); // &&, ||, ;, |, (, )
  }
  return commands
    .map((words) => {
      let i = 0;
      while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || words[i] === "sudo")) i++;
      return words.slice(i);
    })
    .filter((words) => words.length > 0);
}
