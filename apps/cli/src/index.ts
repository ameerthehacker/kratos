#!/usr/bin/env node
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import { createClaudeCodeAdapter } from "@kratos/adapter-claude-code";
import { DEFAULT_PORT } from "@kratos/core";
import { diskFiles } from "./attachment-files.js";
import { DEFAULT_DB, DEFAULT_LOG_DIR, KRATOS_HOME } from "./data-home.js";
import { detectEditors } from "./editors.js";
import { createLogger } from "./logger.js";
import { SessionHub } from "./session-hub.js";
import { DEFAULT_HOST, startServer } from "./server.js";
import { SessionStore } from "./store/store.js";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

type Options = { port: string; host: string; db: string; logDir: string; logLevel: string };

const program = new Command()
  .name("kratos")
  .description("Mindful, controllable coding-agent harness")
  .argument("[project-dir]", "folder the agent works in (default: current directory)")
  .option("-p, --port <number>", "port for the local web UI", String(DEFAULT_PORT))
  .option("-H, --host <host>", "interface to listen on (0.0.0.0 = all; see warning)", DEFAULT_HOST)
  .option("--db <file>", "SQLite file for session history", DEFAULT_DB)
  .option("--log-dir <dir>", "folder for rotating log files (always at debug level)", DEFAULT_LOG_DIR)
  .option("--log-level <level>", "console log level: debug, info, warn, error", "info")
  .action(async (projectDir: string | undefined, opts: Options) => {
    const cwd = resolve(projectDir ?? process.cwd()); // D31
    if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) program.error(`Not a folder: ${cwd}`);

    const log = createLogger({ logDir: resolve(opts.logDir), consoleLevel: opts.logLevel }); // D44
    const adapter = (() => {
      try {
        return createClaudeCodeAdapter();
      } catch (err) {
        return program.error(err instanceof Error ? err.message : String(err)); // e.g. `claude` not installed
      }
    })();

    const dbPath = resolve(opts.db);
    const store = SessionStore.open(dbPath);
    // Attachment bytes live next to the database (D55): .kratos/attachments/ for `pnpm dev`.
    const files = diskFiles(join(dirname(dbPath), "attachments"));
    const hub = new SessionHub(adapter, cwd, store, log, files); // loads (or starts) this project's latest session
    const editors = detectEditors(); // 3d3: what "Open in…" offers
    log.debug({ editors: editors.map((e) => e.id) }, "editors found");
    const iconCacheDir = join(KRATOS_HOME, "cache", "editor-icons");
    const server = await startServer({ port: Number(opts.port), host: opts.host, hub, cwd, agent: adapter.displayName, log, editors, iconCacheDir });
    const shownHost = LOOPBACK.has(opts.host) ? "localhost" : opts.host;
    log.info(`kratos running at http://${shownHost}:${server.port}`);
    log.info(`${adapter.displayName} will act in: ${cwd}`);
    log.info(`Session history: ${dbPath}`);
    log.info(`Logs: ${resolve(opts.logDir)}/current.log`);
    if (!LOOPBACK.has(opts.host)) {
      log.warn(
        `Listening on ${opts.host}: anyone who can reach this address can make ${adapter.displayName} ` +
          `edit files and run commands in ${cwd}. There is no login yet.`,
      );
    }

    // Ctrl-C / kill: stop the agent process cleanly before exiting. `on`, not `once`: execa's exit
    // cleanup re-raises the signal (killing us mid-shutdown) if it sees no other listener left.
    let stopping = false;
    const shutdown = async (signal: string) => {
      if (stopping) return;
      stopping = true;
      log.info({ signal }, "shutting down");
      await server.close(); // stops the agent; its last messages are written to the store
      store.close();
      log.flush(() => process.exit(0)); // the log transport runs in a worker: let it finish writing
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

await program.parseAsync();
