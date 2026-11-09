import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { silentLogger, type Logger } from "../logger.js";

/**
 * One project's plan files (D79), under `<project>/.kratos/`: a feature's in
 * `features/<dir>/plan.md`, a session's in `sessions/<id>/plan.md`. A plan is named here by its
 * folder relative to `.kratos/` ("features/csv-export", "sessions/<id>"); who owns it is the hub's
 * business. Plans change on disk from anywhere (Kratos, the agent, your editor): every change,
 * whoever made it, reaches `onChange` once.
 */
export interface PlanFiles {
  /** Its text as last seen (undefined: no plan). The same text the changes carried, so an answer
   * built from it can't arrive after, and contradict, a newer change; cheap enough for every list. */
  text(folder: string): string | undefined;
  /** Is the folder taken, by a plan or anything else someone put there? */
  taken(folder: string): boolean;
  /** Writes a plan, making its folder, and `.kratos/` with its `.gitignore`, as needed. */
  write(folder: string, markdown: string): Promise<void>;
  /** Writes a plan only if there's none on disk (checked by the write itself); false when there was. */
  create(folder: string, markdown: string): Promise<boolean>;
  /** A plan's folder, its new text (undefined: it was removed) and whether there was a plan
   * before (so a listener can tell an edit from a plan appearing), once per real change.
   * Returns a function that stops listening. */
  onChange(listener: PlanListener): () => void;
  close(): Promise<void>;
}

export type PlanListener = (folder: string, markdown: string | undefined, existed: boolean) => void;

/** The two kinds of plan folder; only these are watched, not the database that may sit beside them. */
const KINDS = ["features", "sessions"];
const PLAN = "plan.md";
/** Plans are Kratos's own working files, kept out of git without touching the project's ignores. */
const GITIGNORE = "# Kratos's own files (plans; in development, its database). Not for git.\n*\n";

export function diskPlans(projectDir: string, log: Logger = silentLogger): PlanFiles & { ready(): Promise<void> } {
  const root = join(projectDir, ".kratos");
  const known = new Map<string, string>(); // folder → the text last seen
  const listeners: PlanListener[] = [];
  let watcher: FSWatcher | undefined;
  let watching = Promise.resolve();
  /** Each folder's latest read or write: a slower, older read resolving after it is dropped. */
  const latest = new Map<string, number>();
  const next = (folder: string) => {
    const n = (latest.get(folder) ?? 0) + 1;
    latest.set(folder, n);
    return n;
  };

  const notify = (folder: string, markdown: string | undefined) => {
    if (known.get(folder) === markdown) return; // our own write, seen again by the watcher
    const existed = known.has(folder);
    if (markdown === undefined) known.delete(folder);
    else known.set(folder, markdown);
    for (const listener of listeners) listener(folder, markdown, existed);
  };

  const folderOf = (path: string) => relative(root, path).split(sep).join("/");

  const seen = (file: string) => {
    if (basename(file) !== PLAN) return;
    const folder = folderOf(dirname(file));
    const n = next(folder);
    readFile(file, "utf8").then(
      (text) => latest.get(folder) === n && notify(folder, text),
      () => latest.get(folder) === n && notify(folder, undefined), // gone again before we read it
    );
  };

  function watchFolders() {
    if (watcher) return;
    for (const kind of KINDS) mkdirSync(join(root, kind), { recursive: true });
    watcher = watch(
      KINDS.map((kind) => join(root, kind)),
      {
        ignoreInitial: true,
        depth: 1, // <kind>/<folder>/plan.md
        ignored: (path, stats) => stats?.isFile() === true && basename(path) !== PLAN,
      },
    );
    watcher
      .on("add", seen)
      .on("change", seen)
      .on("unlink", seen)
      .on("unlinkDir", (path) => known.has(folderOf(path)) && notify(folderOf(path), undefined))
      .on("error", (err) => log.warn({ err }, "watching plan files failed"));
    watching = new Promise((resolve) => watcher!.once("ready", () => resolve()));
  }

  // What's there already: read once at start, then the watcher keeps it current. A `.kratos/`
  // that's there (in development, the database's) is watched from the start, so a plan someone
  // else makes in it is seen even before Kratos writes one.
  for (const kind of KINDS) {
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, PLAN);
      if (existsSync(file)) known.set(`${kind}/${name}`, readFileSync(file, "utf8"));
    }
  }
  if (existsSync(root)) watchFolders();

  /** Makes `.kratos/` and the plan's folder, and tells the watcher about the folder at once
   * (found on its own, a new folder's first edits can go unseen for a moment on macOS). */
  async function prepare(folder: string) {
    await mkdir(root, { recursive: true });
    if (!existsSync(join(root, ".gitignore"))) await writeFile(join(root, ".gitignore"), GITIGNORE);
    watchFolders();
    if (!existsSync(join(root, folder))) {
      await mkdir(join(root, folder), { recursive: true });
      watcher!.add(join(root, folder));
    }
  }

  return {
    text: (folder) => known.get(folder),
    taken: (folder) => existsSync(join(root, folder)),
    async write(folder, markdown) {
      await prepare(folder);
      await writeFile(join(root, folder, PLAN), markdown);
      next(folder); // a watcher read already under way may have seen it half-written: drop it
      notify(folder, markdown);
    },
    async create(folder, markdown) {
      await prepare(folder);
      try {
        await writeFile(join(root, folder, PLAN), markdown, { flag: "wx" }); // fails if it exists
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw err;
      }
      next(folder);
      notify(folder, markdown);
      return true;
    },
    onChange: (listener) => {
      listeners.push(listener);
      return () => void listeners.splice(listeners.indexOf(listener), 1);
    },
    close: async () => watcher?.close(),
    /** Resolves once the watcher has started (tests: an outside edit before then isn't seen). */
    ready: () => watching,
  };
}

/** Plans in memory, for tests; `edit` changes one the way someone outside Kratos would. */
export function memoryPlans(): PlanFiles & { edit(folder: string, markdown: string | undefined): void } {
  const plans = new Map<string, string>();
  const listeners: PlanListener[] = [];
  const edit = (folder: string, markdown: string | undefined) => {
    if (plans.get(folder) === markdown) return;
    const existed = plans.has(folder);
    if (markdown === undefined) plans.delete(folder);
    else plans.set(folder, markdown);
    for (const listener of listeners) listener(folder, markdown, existed);
  };
  return {
    text: (folder) => plans.get(folder),
    taken: (folder) => plans.has(folder),
    write: async (folder, markdown) => edit(folder, markdown),
    create: async (folder, markdown) => !plans.has(folder) && (edit(folder, markdown), true),
    onChange: (listener) => {
      listeners.push(listener);
      return () => void listeners.splice(listeners.indexOf(listener), 1);
    },
    close: async () => {},
    edit,
  };
}
