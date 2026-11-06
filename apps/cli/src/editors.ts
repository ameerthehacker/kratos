import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import open from "open";
import sharp from "sharp";
import which from "which";
import type { Editor } from "@kratos/core";

/** Editors Kratos knows how to open a folder in (3d3): macOS app name, and CLI elsewhere. */
const KNOWN: Array<{ id: string; label: string; macApp: string; cli: string }> = [
  { id: "vscode", label: "VS Code", macApp: "Visual Studio Code", cli: "code" },
  { id: "cursor", label: "Cursor", macApp: "Cursor", cli: "cursor" },
  { id: "zed", label: "Zed", macApp: "Zed", cli: "zed" },
  { id: "windsurf", label: "Windsurf", macApp: "Windsurf", cli: "windsurf" },
  { id: "webstorm", label: "WebStorm", macApp: "WebStorm", cli: "webstorm" },
  { id: "intellij", label: "IntelliJ IDEA", macApp: "IntelliJ IDEA", cli: "idea" },
  { id: "sublime", label: "Sublime Text", macApp: "Sublime Text", cli: "subl" },
  { id: "xcode", label: "Xcode", macApp: "Xcode", cli: "xed" },
];

/** The file manager: always there. */
const FILES_ID = "files";

/** What detection looks at; real by default, faked in tests. */
export type Probe = { platform: NodeJS.Platform; exists: (path: string) => boolean; onPath: (cmd: string) => boolean };

const realProbe: Probe = {
  platform: process.platform,
  exists: existsSync,
  onPath: (cmd) => which.sync(cmd, { nothrow: true }) !== null,
};

/** An editor found on this machine; on macOS also where its .app is (for its real icon). */
export type DetectedEditor = Editor & { appPath?: string };

const FINDER_APP = "/System/Library/CoreServices/Finder.app";

/**
 * The editors installed on this machine, plus the file manager. On macOS an editor counts if its
 * .app is in /Applications or ~/Applications (its CLI often isn't on PATH — e.g. VS Code's `code`);
 * elsewhere, if its CLI is on PATH. Mac apps get an `icon` URL: their own icon (3d3).
 */
export function detectEditors(probe: Probe = realProbe): DetectedEditor[] {
  const withIcon = (editor: Editor, appPath: string | undefined): DetectedEditor =>
    appPath ? { ...editor, icon: `/editor-icons/${editor.id}.png`, appPath } : editor;
  const found = KNOWN.flatMap((e) => {
    if (probe.platform !== "darwin") return probe.onPath(e.cli) ? [{ id: e.id, label: e.label }] : [];
    const appPath = [join("/Applications", `${e.macApp}.app`), join(homedir(), "Applications", `${e.macApp}.app`)].find(probe.exists);
    return appPath ? [withIcon({ id: e.id, label: e.label }, appPath)] : [];
  });
  const files = probe.platform === "darwin" ? "Finder" : probe.platform === "win32" ? "Explorer" : "file manager";
  const finder = probe.platform === "darwin" && probe.exists(FINDER_APP) ? FINDER_APP : undefined;
  return [...found, withIcon({ id: FILES_ID, label: `Reveal in ${files}` }, finder)];
}

/** What tabs see: no local app paths. */
export const publicEditors = (editors: DetectedEditor[]): Editor[] => editors.map(({ appPath: _, ...editor }) => editor);

const run = promisify(execFile);

/**
 * An editor's own app icon as a 64px PNG, made once and cached: macOS's built-in `plutil` (which
 * icon file the app names) and `sips` (.icns → PNG), then sharp trims the transparent padding
 * macOS icons carry, so the tile fills its box and sits level with text. null if no .icns.
 */
export async function editorIcon(editor: DetectedEditor, cacheDir: string): Promise<string | null> {
  if (!editor.appPath) return null;
  const png = join(cacheDir, `${editor.id}-trimmed.png`);
  if (existsSync(png)) return png;
  const plist = join(editor.appPath, "Contents", "Info.plist");
  const { stdout } = await run("plutil", ["-extract", "CFBundleIconFile", "raw", plist]).catch(() => ({ stdout: "" }));
  const name = stdout.trim();
  if (!name) return null;
  const icns = join(editor.appPath, "Contents", "Resources", name.endsWith(".icns") ? name : `${name}.icns`);
  if (!existsSync(icns)) return null;
  mkdirSync(cacheDir, { recursive: true });
  const raw = join(cacheDir, `${editor.id}-raw.png`);
  await run("sips", ["-s", "format", "png", "--resampleHeightWidth", "256", "256", icns, "--out", raw]);
  await sharp(raw)
    .trim() // drop the transparent border (incl. the shadow room below the tile)
    .resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(png);
  return existsSync(png) ? png : null;
}

/**
 * Open `dir` (always the project folder) with an editor from `available`. The id is checked
 * against that list, so nothing the browser sends becomes a command or a path.
 */
export async function openIn(editorId: string, dir: string, available: Editor[], opener: typeof open = open): Promise<void> {
  if (!available.some((e) => e.id === editorId)) throw new Error(`Unknown editor "${editorId}"`);
  if (editorId === FILES_ID) {
    await opener(dir);
    return;
  }
  const editor = KNOWN.find((e) => e.id === editorId)!;
  await opener(dir, { app: { name: process.platform === "darwin" ? editor.macApp : editor.cli } });
}
