import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORMULA, howInstalled, install, type Run } from "./install.js";

const dir = () => mkdtempSync(join(tmpdir(), "kratos-install-"));
/** A stand-in kratos: a script that answers --version. */
const fakeKratos = (path: string, version: string) => writeFileSync(path, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });

describe("howInstalled (3u5c)", () => {
  it("not a packaged binary: source", () => {
    expect(howInstalled("/usr/local/bin/node", false)).toEqual({ kind: "source" });
  });

  it("a binary under Homebrew's Cellar (even through its bin/ link): brew, with that prefix's brew", () => {
    const prefix = dir();
    mkdirSync(join(prefix, "Cellar/kratos/0.5.0/bin"), { recursive: true });
    mkdirSync(join(prefix, "bin"));
    fakeKratos(join(prefix, "Cellar/kratos/0.5.0/bin/kratos"), "0.5.0");
    symlinkSync(join(prefix, "Cellar/kratos/0.5.0/bin/kratos"), join(prefix, "bin/kratos"));
    const real = realpathSync(prefix); // macOS: /var/… is really /private/var/…
    expect(howInstalled(join(prefix, "bin/kratos"), true)).toEqual({ kind: "brew", brew: `${real}/bin/brew`, bin: `${real}/bin/kratos` });
  });

  it("any other binary: replace that file", () => {
    expect(howInstalled("/Users/me/bin/kratos", true)).toEqual({ kind: "binary", path: "/Users/me/bin/kratos" });
  });
});

describe("install: a plain binary (3u5c)", () => {
  it("checks the new binary's version, then renames it over the old one", async () => {
    const d = dir();
    fakeKratos(join(d, "kratos"), "0.5.0");
    fakeKratos(join(d, "new-kratos"), "0.6.0");
    const path = await install({ kind: "binary", path: join(d, "kratos") }, { binary: join(d, "new-kratos"), archive: "" }, "0.6.0");
    expect(path).toBe(join(d, "kratos"));
    expect(readFileSync(path, "utf8")).toContain("0.6.0");
    expect(readdirSync(d).sort()).toEqual(["kratos", "new-kratos"]); // no .new left
  });

  it("a binary that isn't the version it should be replaces nothing", async () => {
    const d = dir();
    fakeKratos(join(d, "kratos"), "0.5.0");
    fakeKratos(join(d, "new-kratos"), "0.5.9");
    await expect(install({ kind: "binary", path: join(d, "kratos") }, { binary: join(d, "new-kratos"), archive: "" }, "0.6.0")).rejects.toThrow(/says it's 0.5.9, not 0.6.0/);
    expect(readFileSync(join(d, "kratos"), "utf8")).toContain("0.5.0");
    expect(existsSync(join(d, "kratos.new"))).toBe(false);
  });

  it("a source run refuses", async () => {
    await expect(install({ kind: "source" }, { binary: "", archive: "" }, "0.6.0")).rejects.toThrow(/source/);
  });
});

describe("install: Homebrew (3u5c, D61)", () => {
  /** brew and git, played back: records every command, answers the ones whose output matters. */
  function fakeBrew(formulaVersion: string, cache: string) {
    const calls: string[] = [];
    let installed = "0.5.0";
    const exec: Run = async (file, args, env) => {
      const line = [file.split("/").pop(), ...args].join(" ") + (env?.HOMEBREW_NO_AUTO_UPDATE ? " [no auto-update]" : "");
      calls.push(line);
      if (args[0] === "--repository") return "/brew/Library/Taps/ameerthehacker/homebrew-kratos\n";
      if (args[0] === "info") return JSON.stringify({ formulae: [{ versions: { stable: formulaVersion } }] });
      if (args[0] === "--cache") return cache + "\n";
      if (args[0] === "upgrade") installed = formulaVersion;
      if (args[0] === "list") return `kratos ${installed}\n`;
      if (args[0] === "--version") return installed + "\n";
      return "";
    };
    return { exec, calls };
  }

  it("refreshes only our tap with git, checks the formula, hands brew our archive, upgrades, verifies", async () => {
    const d = dir();
    writeFileSync(join(d, "archive.tar.gz"), "verified bytes");
    const { exec, calls } = fakeBrew("0.6.0", join(d, "brew-cache.tar.gz"));
    const bin = await install({ kind: "brew", brew: "/opt/homebrew/bin/brew", bin: "/opt/homebrew/bin/kratos" }, { binary: "", archive: join(d, "archive.tar.gz") }, "0.6.0", exec);
    expect(bin).toBe("/opt/homebrew/bin/kratos");
    expect(calls).toEqual([
      "brew --repository ameerthehacker/kratos",
      "git -C /brew/Library/Taps/ameerthehacker/homebrew-kratos fetch --quiet origin main",
      "git -C /brew/Library/Taps/ameerthehacker/homebrew-kratos merge --ff-only --quiet FETCH_HEAD",
      `brew info --json=v2 ${FORMULA}`,
      `brew --cache --formula ${FORMULA}`,
      `brew upgrade ${FORMULA} [no auto-update]`,
      "brew list --versions kratos",
      "kratos --version",
    ]);
    expect(readFileSync(join(d, "brew-cache.tar.gz"), "utf8")).toBe("verified bytes"); // brew installs our file
  });

  it("the tap doesn't have the new version yet: stops before upgrading", async () => {
    const { exec, calls } = fakeBrew("0.5.0", "/unused");
    await expect(install({ kind: "brew", brew: "brew", bin: "kratos" }, { binary: "", archive: "" }, "0.6.0", exec)).rejects.toThrow(/doesn't list kratos 0.6.0 yet \(it has 0.5.0\)/);
    expect(calls.some((c) => c.includes("upgrade"))).toBe(false);
  });
});
