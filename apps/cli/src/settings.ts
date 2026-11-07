import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Settings } from "@kratos/core";
import { silentLogger, type Logger } from "./logger.js";

/**
 * The owner's settings (3w, D63), in one JSON file per user (`~/.kratos/settings.json`), shared by
 * every tab and browser. A missing file means the defaults; an unreadable one is logged and treated
 * as the defaults too, and is only replaced once a setting changes.
 */
export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<(settings: Settings) => void>();

  constructor(
    private readonly file: string,
    private readonly log: Logger = silentLogger,
  ) {
    this.current = this.load();
  }

  get settings(): Settings {
    return this.current;
  }

  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Merge `patch`, save (atomically: a temp file renamed over the old one), tell every listener. */
  update(patch: Partial<Settings>): void {
    this.current = Settings.parse({ ...this.current, ...patch });
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.current, null, 2) + "\n");
    renameSync(temp, this.file);
    for (const listener of this.listeners) listener(this.current);
  }

  private load(): Settings {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return Settings.parse({}); // no file yet: the defaults
    }
    try {
      return Settings.parse(JSON.parse(raw));
    } catch (err) {
      this.log.warn({ err, file: this.file }, "settings file unreadable; using the defaults");
      return Settings.parse({});
    }
  }
}
