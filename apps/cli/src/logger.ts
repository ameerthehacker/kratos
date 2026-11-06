import { join } from "node:path";
import { pino, type Logger, type TransportTargetOptions } from "pino";

export type { Logger };

const FILE_LEVEL = "debug";

/**
 * Where Kratos's logs go (D44): readable console at `consoleLevel` (pino-pretty), and JSON lines
 * at debug in `${logDir}/kratos.N.log`, rotated at 10 MB keeping 5 files (pino-roll), with
 * `current.log` linking to the active one.
 */
export function logTargets(options: { logDir: string; consoleLevel?: string }): TransportTargetOptions[] {
  return [
    {
      target: "pino-pretty",
      level: options.consoleLevel ?? "info",
      options: { destination: 1, colorize: true, singleLine: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
    },
    {
      target: "pino-roll",
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
  ];
}

/** Kratos's logger. Components log through children: `log.child({ component: "hub" })`. */
export function createLogger(options: { logDir: string; consoleLevel?: string }): Logger {
  const consoleLevel = options.consoleLevel ?? "info";
  // The logger itself must pass everything any target wants (the lower of the two levels).
  const level = pino.levels.values[consoleLevel]! < pino.levels.values[FILE_LEVEL]! ? consoleLevel : FILE_LEVEL;
  return pino({ level }, pino.transport({ targets: logTargets(options) }));
}

/** For tests and library use: a logger that drops everything. */
export const silentLogger: Logger = pino({ level: "silent" });

/** For tests: a debug-level logger that keeps its lines (parsed) in `lines`. */
export function memoryLogger(): { log: Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const log = pino({ level: "debug" }, { write: (line: string) => void lines.push(JSON.parse(line)) });
  return { log, lines };
}
