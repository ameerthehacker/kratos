import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";
import { z } from "zod";
import type { UpdateStatus } from "@kratos/core";
import { silentLogger, type Logger } from "../logger.js";
import { REPOSITORY } from "../version.js";
import { downloadRelease, type Downloaded } from "./download.js";

/** What applying an update needs from the rest of Kratos (3u5c). */
export type Applier = {
  /** Resolves once no agent is working, waiting on you, or has prompts queued. */
  whenIdle: () => Promise<void>;
  /** Refuse new turns (true) from installing to the restart; allow them again (false) if it fails. */
  hold: (on: boolean) => void;
  /** Installs the release; returns the binary to restart into. */
  install: (downloaded: Downloaded, version: string) => Promise<string>;
  /** Stops this Kratos and becomes `binary` (never returns when it works). */
  restart: (binary: string) => Promise<void>;
};

/** How often a running Kratos looks for a new release (owner: at start, then hourly). */
export const CHECK_EVERY_MS = 60 * 60 * 1000;

/** The part of GitHub's release JSON we use. */
const Release = z.object({ tag_name: z.string(), html_url: z.string(), prerelease: z.boolean() });

/** The newest release, as GitHub's `releases/latest` reports it (never a draft or pre-release);
 * null if there's none yet. Throws on network errors, odd answers and odd tags. */
export async function latestRelease(fetchFn: typeof fetch, userAgent: string): Promise<{ version: string; url: string } | null> {
  const api = REPOSITORY.replace("https://github.com/", "https://api.github.com/repos/") + "/releases/latest";
  const response = await fetchFn(api, {
    headers: { accept: "application/vnd.github+json", "user-agent": userAgent }, // GitHub requires a user agent
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null; // no release published yet
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release = Release.parse(await response.json());
  const version = semver.valid(semver.clean(release.tag_name));
  if (!version) throw new Error(`Not a version tag: ${release.tag_name}`);
  return release.prerelease ? null : { version, url: release.html_url };
}

/**
 * Looks for a newer Kratos release (3u5a, D61): at `start()`, then every hour. Only a release
 * (a semver version) checks; a source run ("ab9151c", "dev") stays `idle`. A failed check is
 * logged at debug and changes nothing — the next one tries again.
 */
export class Updater {
  private now: UpdateStatus = { state: "idle" };
  private readonly listeners = new Set<(status: UpdateStatus) => void>();
  private timer: NodeJS.Timeout | undefined;
  private readonly log: Logger;
  private readonly fetch: typeof fetch;
  private readonly everyMs: number;
  private readonly downloadTo: string | undefined;
  private readonly releases: string | undefined;
  private downloading = false;
  private readonly applier: Applier | undefined;
  /** Bumped by `cancel()`: an apply waiting for idle agents gives up if it changed. */
  private applyRun = 0;
  /** The verified release on disk, once `ready` (3u5c installs it). */
  downloaded: Downloaded | undefined;

  constructor(
    /** The version running now (`kratosVersion()`). */
    private readonly running: string,
    options: {
      log?: Logger;
      fetch?: typeof fetch;
      everyMs?: number;
      /** Folder for downloaded releases (`~/.kratos/updates`); none = only check, never download. */
      downloadTo?: string;
      /** Where release files come from (default GitHub's; tests use a local server). */
      releases?: string;
      /** How to install and restart (3u5c); none = `apply_update` is refused. */
      apply?: Applier;
    } = {},
  ) {
    this.log = (options.log ?? silentLogger).child({ component: "updater" });
    this.fetch = options.fetch ?? fetch;
    this.everyMs = options.everyMs ?? CHECK_EVERY_MS;
    this.downloadTo = options.downloadTo;
    this.releases = options.releases;
    this.applier = options.apply;
  }

  /** Whether this Kratos can update at all: only releases know where they stand. */
  get enabled(): boolean {
    return semver.valid(this.running) !== null;
  }

  get status(): UpdateStatus {
    return this.now;
  }

  /** Calls `listener` on every change; returns the unsubscribe. */
  subscribe(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    void this.removeOldDownloads();
    void this.check();
    this.timer = setInterval(() => void this.check(), this.everyMs);
    this.timer.unref(); // never what keeps the process alive
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One look at GitHub. Never throws. */
  async check(): Promise<void> {
    if (!this.enabled) return;
    try {
      const latest = await latestRelease(this.fetch, `kratos/${this.running}`);
      if (!latest || !semver.gt(latest.version, this.running)) {
        this.log.debug({ latest: latest?.version, running: this.running }, "up to date");
        return this.set({ state: "idle", checkedAt: Date.now() });
      }
      const checkedAt = Date.now();
      // Mid-update, even a newer release waits: the one being applied finishes first.
      const applying = this.now.state === "waiting" || this.now.state === "applying";
      if (applying || (this.now.version === latest.version && (this.now.state === "downloading" || this.now.state === "ready"))) {
        return this.set({ ...this.now, checkedAt }); // already on it
      }
      if (this.now.version !== latest.version) this.log.info(`kratos ${latest.version} is available: ${latest.url}`);
      this.set({ state: "available", ...latest, checkedAt });
      void this.download();
    } catch (err) {
      this.log.debug({ err }, "update check failed");
    }
  }

  /** Fetch and verify the `available` release in the background (3u5b). Never throws. */
  private async download(): Promise<void> {
    const { version } = this.now;
    if (!this.downloadTo || !version || this.downloading) return;
    this.downloading = true;
    const available = { state: "available" as const, version, url: this.now.url, checkedAt: this.now.checkedAt };
    this.set({ ...available, state: "downloading" });
    let progress: UpdateStatus["progress"];
    let sentAt = 0;
    try {
      const got = await downloadRelease({
        version,
        dir: join(this.downloadTo, version),
        fetch: this.fetch,
        base: this.releases,
        onProgress: (received, total) => {
          // A total below what has arrived is wrong (a compressed response): show bytes only.
          progress = { received, ...(total && total >= received ? { total } : {}) };
          if (Date.now() - sentAt < 250) return; // a few updates a second is plenty for a bar
          sentAt = Date.now();
          this.set({ ...available, state: "downloading", progress });
        },
      });
      if (!got) {
        this.log.debug({ version }, "release files not attached yet; trying again at the next check");
        return this.set(available);
      }
      this.downloaded = got;
      this.log.info(`kratos ${version} is downloaded and verified`);
      this.set({ ...available, state: "ready", progress });
    } catch (err) {
      this.log.warn({ err }, `couldn't download kratos ${version}; trying again at the next check`);
      this.set({ ...available, error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.downloading = false;
    }
  }

  /**
   * Install the `ready` release and restart into it (3u5c), once no agent is busy: `waiting` until
   * then, `applying` while installing, with new turns held so the restart cuts nothing off. On
   * failure it's `ready` again with the error, turns are allowed again, and this Kratos keeps
   * running. Never throws; ignored unless `ready`. (The download is removed at the next start.)
   */
  async apply(): Promise<void> {
    const { version } = this.now;
    const applier = this.applier;
    if (this.now.state !== "ready" || !version || !this.downloaded || !applier) return;
    const downloaded = this.downloaded;
    const run = ++this.applyRun;
    this.set({ ...this.withoutError(), state: "waiting" });
    await applier.whenIdle();
    if (run !== this.applyRun) return; // cancelled meanwhile (or Kratos is quitting)
    applier.hold(true);
    this.set({ ...this.now, state: "applying" });
    let installed = false;
    try {
      this.log.info(`installing kratos ${version}`);
      const binary = await applier.install(downloaded, version);
      installed = true;
      this.log.info(`kratos ${version} is installed; restarting into it`);
      this.stop();
      await applier.restart(binary); // doesn't come back when it works
    } catch (err) {
      applier.hold(false);
      const why = err instanceof Error ? err.message : String(err);
      this.log.warn({ err }, installed ? `kratos ${version} is installed but didn't restart` : `couldn't install kratos ${version}`);
      this.set({ ...this.now, state: "ready", error: installed ? `installed, but couldn't restart (${why}); quit Kratos and start it again` : why });
    }
  }

  /** Releases already installed (this version or older) leave their download behind: remove it. */
  private async removeOldDownloads(): Promise<void> {
    if (!this.downloadTo) return;
    try {
      for (const name of await readdir(this.downloadTo)) {
        if (semver.valid(name) && semver.lte(name, this.running)) await rm(join(this.downloadTo, name), { recursive: true, force: true });
      }
    } catch {
      // no folder yet
    }
  }

  private withoutError(): UpdateStatus {
    const { error: _, ...status } = this.now;
    return status;
  }

  /** Stop waiting to apply (3u5e): back to `ready`. Once installing has begun it can't be. */
  cancel(): void {
    if (this.now.state !== "waiting") return;
    this.applyRun++;
    this.log.info("update cancelled while waiting for the agents");
    this.set({ ...this.now, state: "ready" });
  }

  private set(status: UpdateStatus): void {
    if (JSON.stringify(status) === JSON.stringify(this.now)) return;
    this.now = status;
    for (const listener of this.listeners) listener(status);
  }
}
