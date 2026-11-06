import { execa } from "execa";

/** The spawn settings for every JsonLinesProcess, in one place. */
const spawnChild = (command: string, args: string[], cwd: string, forceKillAfterMs: number) =>
  execa(command, args, {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    buffer: false, // long-lived: don't keep all output in memory
    reject: false, // a crash resolves `exited` instead of throwing
    cleanup: true, // killed if Kratos itself exits: no orphans
    forceKillAfterDelay: forceKillAfterMs, // SIGTERM ignored → SIGKILL
  });

/** How a JsonLinesProcess ended. */
export type ProcessExit = {
  /** True if `stop()` asked for it; false means it exited or crashed on its own. */
  requested: boolean;
  code?: number;
  signal?: string;
  /** Human-readable reason when it failed (e.g. command not found, killed, non-zero exit). */
  message?: string;
};

/**
 * A long-lived child process that speaks JSON lines: one JSON value per line on stdin/stdout.
 * Owns the whole lifecycle so adapters never touch raw streams or signals (D26). Agent-agnostic.
 */
export class JsonLinesProcess {
  /** Resolves once the process is gone, for any reason. Never rejects. */
  readonly exited: Promise<ProcessExit>;
  private readonly child: ReturnType<typeof spawnChild>;
  private running = true;
  private stopRequested = false;

  constructor(command: string, args: string[], options: { cwd: string; forceKillAfterMs?: number }) {
    this.child = spawnChild(command, args, options.cwd, options.forceKillAfterMs ?? 3000);
    // A write racing a crash raises EPIPE on stdin; swallow it, `exited` explains what happened.
    this.child.stdin.on("error", () => {});
    this.exited = this.child.then((result) => {
      this.running = false;
      return {
        requested: this.stopRequested,
        code: result.exitCode,
        signal: result.signal,
        message: result.failed ? result.shortMessage : undefined,
      };
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** OS process id (undefined if it failed to start). For diagnostics and test cleanup. */
  get pid(): number | undefined {
    return this.child.pid;
  }

  /** Write one JSON value as a line. Returns false (writes nothing) once the process has ended. */
  send(message: unknown): boolean {
    if (!this.running || !this.child.stdin.writable) return false;
    this.child.stdin.write(JSON.stringify(message) + "\n");
    return true;
  }

  /**
   * Parsed stdout lines (non-JSON lines skipped). Ends when the process exits. Iterate once.
   * If the consumer stops early (break/return), the process is stopped first: execa's line
   * iterator only finishes closing once the process has exited, so otherwise it hangs forever.
   */
  async *messages(): AsyncGenerator<unknown> {
    const lines = this.child[Symbol.asyncIterator]();
    try {
      while (true) {
        const next = await lines.next();
        if (next.done) return;
        const message = parseJson(next.value);
        if (message !== undefined) yield message;
      }
    } finally {
      if (this.running) await this.stop();
      await lines.return?.();
    }
  }

  /**
   * Graceful stop: close stdin so the process can finish and exit on its own; after `graceMs`
   * send SIGTERM, which execa escalates to SIGKILL if ignored. Resolves when it's gone.
   */
  async stop(graceMs = 2000): Promise<ProcessExit> {
    this.stopRequested = true;
    if (this.running) {
      this.child.stdin.end();
      const timer = setTimeout(() => this.child.kill(), graceMs);
      await this.exited;
      clearTimeout(timer);
    }
    return this.exited;
  }
}

/** undefined for lines that aren't JSON (e.g. stray log output); JSON itself never yields it. */
function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
