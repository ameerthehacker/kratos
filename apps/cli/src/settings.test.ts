import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Settings } from "@kratos/core";
import { memoryLogger } from "./logger.js";
import { SettingsStore } from "./settings.js";

const fileIn = () => join(mkdtempSync(join(tmpdir(), "kratos-settings-")), "nested", "settings.json");

describe("SettingsStore (3w)", () => {
  it("no file yet: the defaults", () => {
    expect(new SettingsStore(fileIn()).settings).toEqual({ theme: "kratos-dark" });
  });

  it("saves a change atomically, tells listeners, and reads it back next start", () => {
    const file = fileIn();
    const store = new SettingsStore(file);
    const seen: Settings[] = [];
    store.subscribe((s) => seen.push(s));
    store.update({ theme: "paper" });
    expect(seen).toEqual([{ theme: "paper" }]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "paper" });
    expect(readdirSync(join(file, ".."))).toEqual(["settings.json"]); // no temp file left
    expect(new SettingsStore(file).settings).toEqual({ theme: "paper" });
  });

  it("an unreadable file or an unknown theme falls back to the defaults (logged), until a change", () => {
    const file = fileIn();
    const store0 = new SettingsStore(file);
    store0.update({ theme: "mist" }); // creates the folder
    writeFileSync(file, "{ not json");
    const { log, lines } = memoryLogger();
    expect(new SettingsStore(file, log).settings).toEqual({ theme: "kratos-dark" });
    expect(lines.map((l) => l.msg)).toContain("settings file unreadable; using the defaults");
    writeFileSync(file, JSON.stringify({ theme: "neon", extra: 1 }));
    expect(new SettingsStore(file).settings).toEqual({ theme: "kratos-dark" });
  });
});
