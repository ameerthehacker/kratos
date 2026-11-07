import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitSnapshots } from "./git-snapshots.js";

/** A throwaway repo with one commit: a.txt, b.txt, .gitignore (ignores *.log). */
function repo(): { dir: string; git: (...args: string[]) => string; write: (path: string, text: string | Buffer) => void } {
  const dir = mkdtempSync(join(tmpdir(), "kratos-snap-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const write = (path: string, text: string | Buffer) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  write("a.txt", "one\ntwo\nthree\n");
  write("b.txt", "keep me\n".repeat(20));
  write(".gitignore", "*.log\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return { dir, git, write };
}

describe("gitSnapshots (3v1, D65)", () => {
  it("edit, new file, delete, rename: each file with both texts and counts", async () => {
    const { dir, write } = repo();
    const snapshots = gitSnapshots(dir);
    const start = (await snapshots.take())!;
    write("a.txt", "one\nTWO\nthree\nfour\n");
    write("src/new.ts", "export const x = 1;\n");
    renameSync(join(dir, "b.txt"), join(dir, "c.txt"));
    write("debug.log", "ignored\n");
    rmSync(join(dir, ".gitignore"));
    write(".gitignore", "*.log\n"); // deleted and recreated as it was: no change
    const files = await snapshots.diff(start, (await snapshots.take())!);
    expect(files).toEqual([
      { path: "a.txt", status: "modified", additions: 2, deletions: 1, before: "one\ntwo\nthree\n", after: "one\nTWO\nthree\nfour\n" },
      { path: "c.txt", oldPath: "b.txt", status: "renamed", additions: 0, deletions: 0, before: "keep me\n".repeat(20), after: "keep me\n".repeat(20) },
      { path: "src/new.ts", status: "added", additions: 1, deletions: 0, before: "", after: "export const x = 1;\n" },
    ]);
  });

  it("a deleted file, a binary one and one too big to send", async () => {
    const { dir, write } = repo();
    const snapshots = gitSnapshots(dir);
    const start = (await snapshots.take())!;
    rmSync(join(dir, "a.txt"));
    write("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]));
    write("big.json", "x".repeat(300 * 1024));
    const files = await snapshots.diff(start, (await snapshots.take())!);
    expect(files).toEqual([
      { path: "a.txt", status: "deleted", additions: 0, deletions: 3, before: "one\ntwo\nthree\n", after: "" },
      { path: "big.json", status: "added", additions: 0, deletions: 0, skipped: "too_big" },
      { path: "logo.png", status: "added", additions: 0, deletions: 0, skipped: "binary" },
    ]);
  });

  it("leaves your index, stash and branches as they were", async () => {
    const { dir, git, write } = repo();
    write("a.txt", "staged\n");
    git("add", "a.txt");
    write("b.txt", "not staged\n");
    write("untracked.txt", "new\n");
    const index = readFileSync(join(dir, ".git", "index"));
    const before = { status: git("status", "--porcelain"), refs: git("for-each-ref"), stash: git("stash", "list") };
    expect(await gitSnapshots(dir).take()).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
    expect({ status: git("status", "--porcelain"), refs: git("for-each-ref"), stash: git("stash", "list") }).toEqual(before);
  });

  it("works from a folder inside the repo; paths are from the repo root", async () => {
    const { dir, write } = repo();
    write("pkg/x.txt", "x\n");
    const snapshots = gitSnapshots(join(dir, "pkg"));
    const start = (await snapshots.take())!;
    write("pkg/x.txt", "y\n");
    expect((await snapshots.diff(start, (await snapshots.take())!)).map((f) => f.path)).toEqual(["pkg/x.txt"]);
  });

  it("a repo with no commits yet, and one that's no repo at all", async () => {
    const fresh = mkdtempSync(join(tmpdir(), "kratos-snap-"));
    execFileSync("git", ["init", "-q"], { cwd: fresh });
    writeFileSync(join(fresh, "first.txt"), "hello\n");
    const snapshots = gitSnapshots(fresh);
    const start = (await snapshots.take())!;
    writeFileSync(join(fresh, "first.txt"), "hello again\n");
    expect((await snapshots.diff(start, (await snapshots.take())!)).map((f) => [f.path, f.status])).toEqual([["first.txt", "modified"]]);

    const plain = mkdtempSync(join(tmpdir(), "kratos-snap-")); // tmpdir is never inside a repo here
    expect(await gitSnapshots(plain).take()).toBeNull();
  });

  it("a nested repository (or submodule) is skipped, not a failure of the whole review", async () => {
    const { dir, write } = repo();
    const snapshots = gitSnapshots(dir);
    const start = (await snapshots.take())!;
    const nested = join(dir, "vendor");
    mkdirSync(nested);
    const inNested = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args], { cwd: nested });
    inNested("init", "-q");
    writeFileSync(join(nested, "x.txt"), "x\n");
    inNested("add", "-A");
    inNested("commit", "-qm", "init");
    write("a.txt", "changed\n");
    const files = await snapshots.diff(start, (await snapshots.take())!);
    expect(files.map((f) => [f.path, f.skipped])).toEqual([
      ["a.txt", undefined],
      ["vendor", "submodule"],
    ]);
  });

  it("knows a snapshot that's gone (pruned by git gc)", async () => {
    const { dir } = repo();
    const snapshots = gitSnapshots(dir);
    expect(await snapshots.exists((await snapshots.take())!)).toBe(true);
    expect(await snapshots.exists("0123456789abcdef0123456789abcdef01234567")).toBe(false);
  });
});
