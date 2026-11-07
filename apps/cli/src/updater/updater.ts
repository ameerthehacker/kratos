import semver from "semver";
import { z } from "zod";
import type { UpdateStatus } from "@kratos/core";
import { silentLogger, type Logger } from "../logger.js";
import { REPOSITORY } from "../version.js";

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

  constructor(
    /** The version running now (`kratosVersion()`). */
    private readonly running: string,
    options: { log?: Logger; fetch?: typeof fetch; everyMs?: number } = {},
  ) {
    this.log = (options.log ?? silentLogger).child({ component: "updater" });
    this.fetch = options.fetch ?? fetch;
    this.everyMs = options.everyMs ?? CHECK_EVERY_MS;
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
        return this.set({ state: "idle" });
      }
      if (this.now.version !== latest.version) this.log.info(`kratos ${latest.version} is available: ${latest.url}`);
      this.set({ state: "available", ...latest });
    } catch (err) {
      this.log.debug({ err }, "update check failed");
    }
  }

  private set(status: UpdateStatus): void {
    if (JSON.stringify(status) === JSON.stringify(this.now)) return;
    this.now = status;
    for (const listener of this.listeners) listener(status);
  }
}
