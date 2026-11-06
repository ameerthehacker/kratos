import { homedir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { detectEditors, openIn, type Probe } from "./editors.js";

describe("editors (3d3)", () => {
  it("on macOS finds editors by their .app, even without their CLI on PATH", () => {
    const apps = new Set(["/Applications/Visual Studio Code.app", `${homedir()}/Applications/Zed.app`]);
    const mac: Probe = { platform: "darwin", exists: (p) => apps.has(p), onPath: () => false };
    expect(detectEditors(mac)).toEqual([
      { id: "vscode", label: "VS Code", icon: "/editor-icons/vscode.png", appPath: "/Applications/Visual Studio Code.app" },
      { id: "zed", label: "Zed", icon: "/editor-icons/zed.png", appPath: `${homedir()}/Applications/Zed.app` },
      { id: "files", label: "Reveal in Finder" }, // this fake Mac has no Finder.app: no icon
    ]);
  });

  it("elsewhere finds editors by their CLI on PATH", () => {
    const linux: Probe = { platform: "linux", exists: () => false, onPath: (cmd) => cmd === "cursor" };
    expect(detectEditors(linux).map((e) => e.id)).toEqual(["cursor", "files"]);
  });

  it("opens only the project folder, only with a listed editor", async () => {
    const opener = vi.fn(async () => ({}) as never);
    const available = [{ id: "vscode", label: "VS Code" }, { id: "files", label: "Reveal in Finder" }];
    await openIn("files", "/proj", available, opener);
    expect(opener).toHaveBeenLastCalledWith("/proj");
    await openIn("vscode", "/proj", available, opener);
    expect(opener).toHaveBeenLastCalledWith("/proj", { app: { name: expect.any(String) } });
    await expect(openIn("rm -rf /", "/proj", available, opener)).rejects.toThrow("Unknown editor");
    await expect(openIn("cursor", "/proj", available, opener)).rejects.toThrow("Unknown editor"); // known, not installed
    expect(opener).toHaveBeenCalledTimes(2);
  });
});
