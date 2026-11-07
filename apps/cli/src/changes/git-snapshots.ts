import { randomUUID } from "node:crypto";
import { copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffLines } from "diff";
import { simpleGit, type DiffResultNameStatusFile, type SimpleGit } from "simple-git";
import type { ChangedFile } from "@kratos/core";

/** Snapshots of the project's files (3v1, D65): what a session changed is the difference between
 * two of them. */
export interface Snapshots {
  /** Record the files as they are now; resolves to the snapshot's id, or null when the project
   * isn't in a git repository (nothing to review). */
  take(): Promise<string | null>;
  /** Is this snapshot still there? `git gc` prunes unreferenced trees after its grace period. */
  exists(id: string): Promise<boolean>;
  /** The files that differ between two snapshots, with both texts. */
  diff(from: string, to: string): Promise<ChangedFile[]>;
}

/** Bigger sides aren't sent: the review page couldn't show them usefully anyway. */
const MAX_SIDE_BYTES = 256 * 1024;
/** All the texts of one `changes` message together; files past it are `too_big`. */
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
/** Git's own test for binary: a NUL byte in the first 8000 bytes. */
const BINARY_PROBE = 8000;

/**
 * Snapshots as git tree objects (D65). `take` writes the working tree to the object database the
 * way `git add -A && git write-tree` would, but through a temporary copy of the index, so your
 * index, stash, branches and commits never change. The copy keeps git's file-stat cache: only
 * files changed since your last `git add`/`status` are read again. `.gitignore` is respected.
 */
export function gitSnapshots(dir: string): Snapshots {
  // Located once: the repository root (snapshots cover the whole repo) and its index file.
  let repo: Promise<{ git: SimpleGit; root: string; index: string } | null> | undefined;
  const locate = () =>
    (repo ??= (async () => {
      try {
        const root = (await gitIn(dir).revparse(["--show-toplevel"])).trim();
        const gitDir = (await gitIn(dir).revparse(["--absolute-git-dir"])).trim();
        return { git: gitIn(root), root, index: join(gitDir, "index") };
      } catch {
        repo = undefined; // not kept: a `git init` (or a git that failed once) is seen next time
        return null; // not a repository, or no git installed
      }
    })());

  return {
    async take() {
      const found = await locate();
      if (!found) return null;
      const index = join(tmpdir(), `kratos-index-${randomUUID()}`);
      try {
        await copyFile(found.index, index).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== "ENOENT") throw err; // a repo with nothing added yet has no index
        });
        // Its own instance: `env` changes the instance it's called on, and two snapshots can run
        // at once (one turn's end, the next one's start).
        const git = gitIn(found.root, ["GIT_INDEX_FILE"]).env({ ...plainEnv(), GIT_INDEX_FILE: index });
        await git.raw(["add", "--all"]);
        return (await git.raw(["write-tree"])).trim();
      } finally {
        await rm(index, { force: true });
      }
    },

    async exists(id) {
      const found = await locate();
      if (!found) return false;
      return found.git.raw(["cat-file", "-e", `${id}^{tree}`]).then(
        () => true,
        () => false,
      );
    },

    async diff(from, to) {
      const found = await locate();
      if (!found) return [];
      const summary = await found.git.diffSummary(["--name-status", "--find-renames", from, to]);
      let budget = MAX_TOTAL_BYTES;
      const files: ChangedFile[] = [];
      for (const entry of summary.files as DiffResultNameStatusFile[]) {
        const status = statusOf(entry);
        const oldPath = status === "renamed" ? entry.from : undefined;
        const before = status === "added" ? EMPTY : await blob(found.git, from, oldPath ?? entry.file);
        const after = status === "deleted" ? EMPTY : await blob(found.git, to, entry.file);
        const base = { path: entry.file, ...(oldPath ? { oldPath } : {}), status };
        if (!("text" in before) || !("text" in after)) {
          const skipped = SKIP_ORDER.find((reason) => [before, after].some((side) => "skipped" in side && side.skipped === reason));
          files.push({ ...base, additions: 0, deletions: 0, skipped: skipped! });
          continue;
        }
        const size = Buffer.byteLength(before.text) + Buffer.byteLength(after.text);
        if (size > budget) {
          files.push({ ...base, additions: 0, deletions: 0, skipped: "too_big" });
          continue;
        }
        budget -= size;
        files.push({ ...base, ...countLines(before.text, after.text), before: before.text, after: after.text });
      }
      return files;
    },
  };
}

/** Paths as they are (no octal escapes for non-ASCII names); a git that hangs is stopped. */
const gitIn = (baseDir: string, allowEnvironment: string[] = []) =>
  simpleGit({ baseDir, config: ["core.quotePath=false"], timeout: { block: 60_000 }, allowEnvironment });

/** Our environment minus the keys simple-git guards (every `GIT_*`, editors, pagers, askpass…):
 * passed through `env()` it refuses them, inherited it would strip them anyway. None of them
 * matter to `add` / `write-tree`, and an inherited `GIT_DIR` would point at another repo. */
function plainEnv(): Record<string, string> {
  const drop = /^(git_.*|editor|visual|pager|prefix|ssh_askpass)$/i;
  return Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !drop.test(e[0])));
}

type Skipped = NonNullable<ChangedFile["skipped"]>;
type Blob = { text: string } | { skipped: Skipped };
const EMPTY: Blob = { text: "" };
/** When the two sides are skipped for different reasons, the file is shown as the first. */
const SKIP_ORDER: Skipped[] = ["submodule", "binary", "too_big"];

/** A file's text in a snapshot, or why there's none: too big, binary per git's NUL-byte test, or a
 * submodule / nested repository (a gitlink: its commit lives in the other repo, not this one). */
async function blob(git: SimpleGit, tree: string, path: string): Promise<Blob> {
  // "<mode> <type> <object> <size>\t<path>"; literal, so a `*` or `?` in a name is just that.
  const entry = (await git.raw(["--literal-pathspecs", "ls-tree", "-l", tree, "--", path])).trim();
  const [, type, object, size] = entry.split(/\s+/);
  if (!object) throw new Error(`${path} isn't in snapshot ${tree}`);
  if (type === "commit") return { skipped: "submodule" };
  if (Number(size) > MAX_SIDE_BYTES) return { skipped: "too_big" };
  const bytes = await git.showBuffer([object]);
  if (bytes.subarray(0, BINARY_PROBE).includes(0)) return { skipped: "binary" };
  return { text: bytes.toString("utf8") };
}

function statusOf(entry: DiffResultNameStatusFile): ChangedFile["status"] {
  switch (entry.status) {
    case "A":
    case "C": // copied: new to the review
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified"; // M, and T (type change, e.g. file ↔ symlink)
  }
}

/** How lines are compared, here and on the review page (apps/web `diff-rows.ts`): a missing
 * newline at the end isn't a change of its own. */
const LINE_DIFF = { ignoreNewlineAtEof: true };

/** Lines added and removed, counted the way the review page draws them (jsdiff). */
function countLines(before: string, after: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(before, after, LINE_DIFF)) {
    if (part.added) additions += part.count;
    else if (part.removed) deletions += part.count;
  }
  return { additions, deletions };
}
