import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pino, type Logger } from "pino";
import pretty from "pino-pretty";
import roll from "pino-roll";

export type { Logger };

const FILE_LEVEL = "debug";

/**
 * Where Kratos's logs go (D44): readable console at `consoleLevel` (pino-pretty), and JSON lines
 * at debug in `${logDir}/kratos.N.log`, rotated at 10 MB keeping 5 files (pino-roll), with
 * `current.log` linking to the active one.
 */
export function logTargets(options: { logDir: string; consoleLevel?: string }) {
  return {
    console: {
      level: options.consoleLevel ?? "info",
      options: { destination: 1, colorize: true, singleLine: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
    },
    file: {
      level: FILE_LEVEL,
      options: {
        file: join(options.logDir, "kratos.log"),
        size: "10m",
        // count = files kept *besides* the active one (5 in all); removeOtherLogFiles makes the cap
        // hold across restarts — otherwise files from earlier runs are never cleaned up.
        limit: { count: 4, removeOtherLogFiles: true },
        symlink: true, // current.log → the active file (handy for `tail -f`)
        mkdir: true,
      },
    },
  };
}

/**
 * Kratos's logger. Components log through children: `log.child({ component: "hub" })`. Both
 * outputs run in-process (`multistream`), not as pino transports: transports load their modules
 * by name in worker threads, which a single binary can't do (3u3, D57).
 */
export async function createLogger(options: { logDir: string; consoleLevel?: string }): Promise<Logger> {
  const consoleLevel = options.consoleLevel ?? "info";
  // The logger itself must pass everything any target wants (the lower of the two levels).
  const level = pino.levels.values[consoleLevel]! < pino.levels.values[FILE_LEVEL]! ? consoleLevel : FILE_LEVEL;
  // pino-roll's own `mkdir` is async but it creates current.log right away: on a fresh folder the
  // symlink would fail (ENOENT) and crash the worker. Make the folder first.
  mkdirSync(options.logDir, { recursive: true });
  const targets = logTargets(options);
  const file = await roll(targets.file.options);
  return pino(
    { level },
    pino.multistream([
      { level: targets.console.level as pino.Level, stream: pretty(targets.console.options) },
      { level: targets.file.level as pino.Level, stream: file },
    ]),
  );
}

/** For tests and library use: a logger that drops everything. */
export const silentLogger: Logger = pino({ level: "silent" });

/** For tests: a debug-level logger that keeps its lines, parsed (`lines`) and as written (`raw`). */
export function memoryLogger(): { log: Logger; lines: Array<Record<string, unknown>>; raw: string[] } {
  const lines: Array<Record<string, unknown>> = [];
  const raw: string[] = [];
  const write = (line: string) => void (raw.push(line), lines.push(JSON.parse(line)));
  return { log: pino({ level: "debug" }, { write }), lines, raw };
}
