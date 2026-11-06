#!/usr/bin/env node
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import envPaths from "env-paths";
import { createClaudeCodeAdapter } from "@kratos/adapter-claude-code";
import { DEFAULT_PORT } from "@kratos/core";
import { SessionHub } from "./session-hub.js";
import { DEFAULT_HOST, startServer } from "./server.js";
import { SessionStore } from "./store/store.js";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
/** One database for all projects, in the OS user data folder (D36). macOS: ~/Library/Application Support/kratos */
const DEFAULT_DB = join(envPaths("kratos", { suffix: "" }).data, "kratos.db");

const program = new Command()
  .name("kratos")
  .description("Mindful, controllable coding-agent harness")
  .argument("[project-dir]", "folder the agent works in (default: current directory)")
  .option("-p, --port <number>", "port for the local web UI", String(DEFAULT_PORT))
  .option("-H, --host <host>", "interface to listen on (0.0.0.0 = all; see warning)", DEFAULT_HOST)
  .option("--db <file>", "SQLite file for session history", DEFAULT_DB)
  .action(async (projectDir: string | undefined, opts: { port: string; host: string; db: string }) => {
    const cwd = resolve(projectDir ?? process.cwd()); // D31
    if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) program.error(`Not a folder: ${cwd}`);

    const adapter = (() => {
      try {
        return createClaudeCodeAdapter();
      } catch (err) {
        return program.error(err instanceof Error ? err.message : String(err)); // e.g. `claude` not installed
      }
    })();

    const dbPath = resolve(opts.db);
    const store = SessionStore.open(dbPath);
    const hub = new SessionHub(adapter, cwd, store); // loads (or starts) this project's latest session
    const server = await startServer({ port: Number(opts.port), host: opts.host, hub, cwd, agent: adapter.displayName });
    const shownHost = LOOPBACK.has(opts.host) ? "localhost" : opts.host;
    console.log(`kratos running at http://${shownHost}:${server.port}`);
    console.log(`${adapter.displayName} will act in: ${cwd}`);
    console.log(`Session history: ${dbPath}`);
    if (!LOOPBACK.has(opts.host)) {
      console.warn(
        `⚠️  Listening on ${opts.host}: anyone who can reach this address can make ${adapter.displayName} ` +
          `edit files and run commands in ${cwd}. There is no login yet.`,
      );
    }

    // Ctrl-C / kill: stop the agent process cleanly before exiting. `on`, not `once`: execa's exit
    // cleanup re-raises the signal (killing us mid-shutdown) if it sees no other listener left.
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      await server.close(); // stops the agent; its last messages are written to the store
      store.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

await program.parseAsync();
