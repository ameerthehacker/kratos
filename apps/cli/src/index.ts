#!/usr/bin/env node
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import open from "open";
import { createClaudeCodeAdapter } from "@kratos/adapter-claude-code";
import { DEFAULT_PORT } from "@kratos/core";
import { diskFiles } from "./attachment-files.js";
import { DEFAULT_DB, DEFAULT_LOG_DIR, KRATOS_HOME } from "./data-home.js";
import { detectEditors } from "./editors.js";
import { createLogger } from "./logger.js";
import { SessionHub } from "./session-hub.js";
import { DEFAULT_HOST, startServer } from "./server.js";
import { SettingsStore } from "./settings.js";
import { SessionStore } from "./store/store.js";
import { howInstalled, install } from "./updater/install.js";
import { Updater } from "./updater/updater.js";
import { kratosVersion } from "./version.js";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

type Options = { port: string; host: string; db: string; logDir: string; logLevel: string; open: boolean };

const version = kratosVersion(); // 3u1: a release's version, or the commit this runs from

const program = new Command()
  .name("kratos")
  .description("Mindful, controllable coding-agent harness")
  .version(version.version)
  .argument("[project-dir]", "folder the agent works in (default: current directory)")
  .option("-p, --port <number>", "port for the local web UI", String(DEFAULT_PORT))
  .option("-H, --host <host>", "interface to listen on (0.0.0.0 = all; see warning)", DEFAULT_HOST)
  .option("--db <file>", "SQLite file for session history", DEFAULT_DB)
  .option("--log-dir <dir>", "folder for rotating log files (always at debug level)", DEFAULT_LOG_DIR)
  .option("--log-level <level>", "console log level: debug, info, warn, error", "info")
  .option("--no-open", "don't open the web UI in your browser")
  .action(async (projectDir: string | undefined, opts: Options) => {
    const cwd = resolve(projectDir ?? process.cwd()); // D31
    if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) program.error(`Not a folder: ${cwd}`);

    const log = await createLogger({ logDir: resolve(opts.logDir), consoleLevel: opts.logLevel }); // D44
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
    // 3u5: releases only (a source run never checks); new ones are downloaded to ~/.kratos/updates
    // and, on "Update & restart", installed once no agent is busy, then restarted into (3u5c).
    const installed = howInstalled();
    const updater = new Updater(version.version, {
      log,
      downloadTo: join(KRATOS_HOME, "updates"),
      apply: {
        whenIdle: () => hub.whenIdle(),
        hold: (on) => hub.holdNewTurns(on),
        install: async (downloaded, next) => {
          // Checked before anything is installed: without it Kratos couldn't come back by itself.
          if (!process.execve) throw new Error("this system can't restart Kratos in place; update it another way");
          return install(installed, downloaded, next);
        },
        restart: async (binary) => {
          // The same Kratos again (rebuilt from the options, so nothing depends on how argv looked),
          // without a new browser tab: the open ones reconnect, and reload for the new version (3u8).
          const { execve } = process;
          if (!execve) throw new Error("this system can't restart Kratos in place");
          if (stopping) throw new Error("Kratos is shutting down");
          const args = [cwd, "--port", String(server.port), "--host", opts.host, "--db", dbPath, "--log-dir", resolve(opts.logDir), "--log-level", opts.logLevel, "--no-open"];
          stopping = true;
          await server.close(); // frees the port; agents are idle, their sessions resume after
          store.close();
          await new Promise<void>((done) => log.flush(() => done()));
          try {
            execve.call(process, binary, [binary, ...args], process.env); // this process becomes the new Kratos: same PID, same terminal
          } catch (err) {
            // The server is already closed, so there is nothing to go back to: say so and stop.
            // The new version is installed; starting Kratos again runs it.
            log.error({ err }, `kratos is updated but couldn't restart into ${binary}: start it again`);
            log.flush(() => process.exit(1));
          }
        },
      },
    });
    const settings = new SettingsStore(join(KRATOS_HOME, "settings.json"), log); // 3w: per user, not per project
    const port = Number(opts.port);
    const server = await startServer({ port, host: opts.host, hub, cwd, agent: adapter.displayName, log, editors, iconCacheDir, version, updater, settings }).catch(
      (err: unknown) => {
        if (!(err instanceof Error && "code" in err && err.code === "EADDRINUSE")) throw err;
        store.close(); // nothing else has started yet: no agent runs before a tab connects
        // A clear stop, not a quiet fallback to another port (D60).
        return program.error(`Port ${port} is already in use (another kratos running?). Stop it, or pick another: kratos --port ${port + 1}`);
      },
    );
    let stopping = false; // shutting down, or restarting into an update
    const shownHost = LOOPBACK.has(opts.host) ? "localhost" : opts.host;
    const url = `http://${shownHost}:${server.port}`;
    log.info(`kratos ${version.version} running at ${url}`);
    log.info(`${adapter.displayName} will act in: ${cwd}`);
    log.info(`Session history: ${dbPath}`);
    log.info(`Logs: ${resolve(opts.logDir)}/current.log`);
    if (!LOOPBACK.has(opts.host)) {
      log.warn(
        `Listening on ${opts.host}: anyone who can reach this address can make ${adapter.displayName} ` +
          `edit files and run commands in ${cwd}. There is no login yet.`,
      );
    }
    updater.start(); // now, then hourly
    // The UI opens in the default browser (3u3, owner); `--no-open` for `pnpm dev` and headless use.
    if (opts.open) open(url).catch((err: unknown) => log.warn({ err }, `Couldn't open a browser: visit ${url}`));

    // Ctrl-C / kill: stop the agent process cleanly before exiting. `on`, not `once`: execa's exit
    // cleanup re-raises the signal (killing us mid-shutdown) if it sees no other listener left.
    const shutdown = async (signal: string) => {
      if (stopping) return;
      stopping = true;
      log.info({ signal }, "shutting down");
      updater.cancel(); // an update waiting for the agents must not install while we quit
      updater.stop();
      await server.close(); // stops the agent; its last messages are written to the store
      store.close();
      log.flush(() => process.exit(0)); // let the log file finish writing
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

await program.parseAsync();
