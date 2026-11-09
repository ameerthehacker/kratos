import { execFile } from "node:child_process";

/** Runs a program (no shell) and gives its output; throws with its stderr if it fails. */
export type Run = (file: string, args: string[], env?: Record<string, string>) => Promise<string>;

/**
 * The one way Kratos runs a short command and reads its output (3u5c, 3z7). A plain callback, never
 * `util.promisify` on `execFile`: inside the single binary pkg's SEA bootstrap wraps it without
 * `util.promisify.custom`, so the promise form gives the output string instead of `{ stdout }`
 * — it broke the updater (3u5c) and then the editor icons (3z7). A test keeps it out of `src/`.
 */
export const run: Run = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      if (!err) return resolve(String(stdout));
      const why = (String(stderr ?? "") || err.message).trim().split("\n").slice(-3).join(" ");
      reject(new Error(`${[file, ...args].join(" ")} failed: ${why}`));
    });
  });
