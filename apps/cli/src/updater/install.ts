import { execFile } from "node:child_process";
import { chmod, copyFile, rename, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { isSea } from "node:sea";
import type { Downloaded } from "./download.js";

/** Kratos's Homebrew formula (3u4, D57). */
export const FORMULA = "ameerthehacker/kratos/kratos";
const TAP = "ameerthehacker/kratos";

/** How this Kratos was installed, which decides how it updates (3u5c, D61). */
export type Installed =
  | { kind: "source" } // `pnpm dev` / `pnpm start`: git owns it
  | { kind: "binary"; path: string } // a release binary somewhere: replace the file
  | { kind: "brew"; brew: string; bin: string }; // Homebrew: brew installs it, and knows

export function howInstalled(execPath = process.execPath, packaged = isSea()): Installed {
  if (!packaged) return { kind: "source" };
  let real = execPath;
  try {
    real = realpathSync(execPath);
  } catch {}
  // e.g. /opt/homebrew/Cellar/kratos/0.5.0/bin/kratos → /opt/homebrew
  const prefix = /^(.*)\/Cellar\/kratos\/[^/]+\/bin\/kratos$/.exec(real)?.[1];
  return prefix ? { kind: "brew", brew: `${prefix}/bin/brew`, bin: `${prefix}/bin/kratos` } : { kind: "binary", path: execPath };
}

/** Runs a program (no shell) and gives its output; throws with its stderr if it fails. */
export type Run = (file: string, args: string[], env?: Record<string, string>) => Promise<string>;

// A plain callback, not `promisify(execFile)`: inside the packaged binary pkg patches
// child_process and execFile loses the promise form that gives `{ stdout }` (3u5c, found end to end).
export const run: Run = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      if (!err) return resolve(String(stdout));
      const why = (String(stderr ?? "") || err.message).trim().split("\n").slice(-3).join(" ");
      reject(new Error(`${[file, ...args].join(" ")} failed: ${why}`));
    });
  });

/**
 * Installs the downloaded release `version` the way this Kratos was installed; returns the binary
 * to restart into. Nothing is replaced until the new binary has said it is `version`.
 * - binary: copied next to the old one, checked, then renamed over it (atomic on one disk; the
 *   running process keeps its old file).
 * - brew: not `brew update` (it refreshes every tap and can be throttled; owner saw it miss new
 *   versions) — our tap is fast-forwarded with git, its formula must list `version` (the tap job
 *   finishes minutes after the release), our verified archive goes where brew looks for its
 *   download, `brew upgrade` installs it (checking the sha256 again), and both brew and the new
 *   binary must then report `version`.
 */
export async function install(installed: Installed, downloaded: Downloaded, version: string, exec: Run = run): Promise<string> {
  const reports = async (binary: string) => {
    const said = (await exec(binary, ["--version"])).trim();
    if (said !== version) throw new Error(`the new kratos says it's ${said || "nothing"}, not ${version}`);
  };
  switch (installed.kind) {
    case "source":
      throw new Error("this Kratos runs from source: update it with git, not from here");
    case "binary": {
      const next = `${installed.path}.new`;
      await copyFile(downloaded.binary, next);
      await chmod(next, 0o755);
      try {
        await reports(next);
      } catch (err) {
        await rm(next, { force: true });
        throw err;
      }
      await rename(next, installed.path);
      return installed.path;
    }
    case "brew": {
      const { brew } = installed;
      const tap = (await exec(brew, ["--repository", TAP])).trim();
      await exec("git", ["-C", tap, "fetch", "--quiet", "origin", "main"]);
      await exec("git", ["-C", tap, "merge", "--ff-only", "--quiet", "FETCH_HEAD"]);
      const info = JSON.parse(await exec(brew, ["info", "--json=v2", FORMULA])) as { formulae?: Array<{ versions?: { stable?: string } }> };
      const listed = info.formulae?.[0]?.versions?.stable;
      if (listed !== version) throw new Error(`Homebrew doesn't list kratos ${version} yet (it has ${listed ?? "none"}); try again in a few minutes`);
      await copyFile(downloaded.archive, (await exec(brew, ["--cache", "--formula", FORMULA])).trim());
      await exec(brew, ["upgrade", FORMULA], { HOMEBREW_NO_AUTO_UPDATE: "1" });
      const versions = (await exec(brew, ["list", "--versions", "kratos"])).trim().split(/\s+/).slice(1);
      if (!versions.includes(version)) throw new Error(`brew upgrade finished, but brew lists kratos ${versions.join(", ") || "nothing"}`);
      await reports(installed.bin);
      return installed.bin;
    }
  }
}
