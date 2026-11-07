import { homedir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { detectEditors, openIn, squareTrim, type Probe } from "./editors.js";

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

describe("squareTrim (3u2: was sharp's trim + contain)", () => {
  /** A width×height image, fully transparent but for opaque pixels in the given box. */
  const image = (width: number, height: number, box: { x: number; y: number; w: number; h: number }) => {
    const png = new PNG({ width, height });
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) png.data[(y * width + x) * 4 + 3] = 255;
    return png;
  };
  const opaque = (png: PNG, x: number, y: number) => png.data[(y * png.width + x) * 4 + 3] === 255;

  it("crops the transparent border and centres the rest on a transparent square", () => {
    const out = squareTrim(image(100, 100, { x: 20, y: 10, w: 40, h: 60 })); // a tall tile, off-centre
    expect([out.width, out.height]).toEqual([60, 60]);
    expect(opaque(out, 10, 0)).toBe(true); // content starts 10px in: (60 - 40) / 2
    expect(opaque(out, 9, 30)).toBe(false); // padding is transparent
    expect(opaque(out, 49, 59)).toBe(true);
  });

  it("ignores near-invisible pixels (a faint shadow) and leaves an empty image alone", () => {
    const shadowed = image(50, 50, { x: 5, y: 5, w: 20, h: 20 });
    shadowed.data[(45 * 50 + 45) * 4 + 3] = 5; // faint
    expect(squareTrim(shadowed).width).toBe(20);
    const empty = new PNG({ width: 8, height: 8 });
    expect(squareTrim(empty)).toBe(empty);
  });
});
