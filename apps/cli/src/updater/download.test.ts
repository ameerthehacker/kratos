import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "tar";
import type { UpdateStatus } from "@kratos/core";
import { assetName, downloadRelease } from "./download.js";
import { Updater, type Applier } from "./updater.js";

// The machine running the test: the Updater downloads for its own platform (CI runs on Linux x64).
const TARGET = `${process.platform}-${process.arch}`;
const NAME = assetName("0.3.0", TARGET);

/** A release archive like the workflow's: one file, `kratos`. */
async function makeArchive(contents: string): Promise<Buffer> {
  const src = mkdtempSync(join(tmpdir(), "kratos-rel-src-"));
  writeFileSync(join(src, "kratos"), contents, { mode: 0o755 });
  const file = join(src, "out.tar.gz");
  await create({ gzip: true, cwd: src, file }, ["kratos"]);
  return readFileSync(file);
}
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** GitHub's release downloads, played by a local server: path → body (missing = 404). */
let files: Record<string, Buffer | string> = {};
const requests: string[] = [];
let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url!);
    const body = files[req.url!];
    if (body === undefined) return res.writeHead(404).end("Not Found");
    res.writeHead(200).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/download`;
});
afterAll(() => server.close());

async function publish(contents = "new kratos", sums?: string) {
  const archive = await makeArchive(contents);
  files = {
    [`/download/v0.3.0/${NAME}`]: archive,
    "/download/v0.3.0/SHA256SUMS": sums ?? `${sha(archive)}  ${NAME}\n${"0".repeat(64)}  ${assetName("0.3.0", "other-cpu")}\n`,
  };
}
const download = (dir: string) => downloadRelease({ version: "0.3.0", dir, fetch, base, target: TARGET });
const freshDir = () => mkdtempSync(join(tmpdir(), "kratos-updates-"));

describe("downloadRelease (3u5b)", () => {
  it("downloads this machine's archive, checks it against SHA256SUMS, and unpacks the binary", async () => {
    await publish("new kratos");
    const dir = freshDir();
    const got = await download(dir);
    expect(got).toEqual({ archive: join(dir, NAME), binary: join(dir, "kratos") });
    expect(readFileSync(got!.binary, "utf8")).toBe("new kratos");
    expect(readdirSync(dir).sort()).toEqual(["kratos", NAME]); // no .part left behind
  });

  it("a checksum mismatch throws and leaves nothing behind", async () => {
    await publish("new kratos", `${"a".repeat(64)}  ${NAME}\n`);
    const dir = freshDir();
    await expect(download(dir)).rejects.toThrow(/doesn't match its checksum/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("not attached yet (no SHA256SUMS, or not listed for us, or no archive): null, not an error", async () => {
    files = {};
    expect(await download(freshDir())).toBeNull();
    await publish();
    files["/download/v0.3.0/SHA256SUMS"] = `${"b".repeat(64)}  ${assetName("0.3.0", "other-cpu")}\n`;
    expect(await download(freshDir())).toBeNull();
    await publish();
    delete files[`/download/v0.3.0/${NAME}`];
    expect(await download(freshDir())).toBeNull();
  });

  it("reports progress as bytes arrive, ending at the archive's size (3u5e)", async () => {
    await publish();
    const size = (files[`/download/v0.3.0/${NAME}`] as Buffer).length;
    const seen: Array<[number, number | undefined]> = [];
    const dir = freshDir();
    await downloadRelease({ version: "0.3.0", dir, fetch, base, target: TARGET, onProgress: (r, t) => seen.push([r, t]) });
    expect(seen.at(-1)).toEqual([size, size]);
    seen.length = 0;
    await downloadRelease({ version: "0.3.0", dir, fetch, base, target: TARGET, onProgress: (r, t) => seen.push([r, t]) });
    expect(seen).toEqual([[size, size]]); // reused: one report, complete
  });

  it("reuses an archive already downloaded and still matching", async () => {
    await publish();
    const dir = freshDir();
    await download(dir);
    requests.length = 0;
    expect(await download(dir)).not.toBeNull();
    expect(requests).toEqual(["/download/v0.3.0/SHA256SUMS"]); // the archive wasn't fetched again
  });
});

/** GitHub: the API is faked (`latestTag` is latest; v0.3.0 unless a test moves it), downloads go
 * to the local server. */
let latestTag = "v0.3.0";
const github = (async (url: string | URL | Request, init?: RequestInit) =>
  String(url).includes("api.github.com")
    ? Response.json({ tag_name: latestTag, html_url: `https://github.com/ameerthehacker/kratos/releases/tag/${latestTag}`, prerelease: false })
    : fetch(url, init)) as typeof fetch;

describe("Updater downloads a newer release (3u5b)", () => {
  async function run() {
    const updater = new Updater("0.2.0", { fetch: github, downloadTo: freshDir(), releases: base });
    const seen: UpdateStatus["state"][] = [];
    updater.subscribe((status) => seen.push(status.state));
    await updater.check();
    await vi.waitFor(() => expect(["ready", "available"]).toContain(updater.status.state === "downloading" ? "" : updater.status.state));
    return { updater, seen };
  }

  it("available → downloading → ready, with the binary on disk", async () => {
    await publish();
    const { updater, seen } = await run();
    expect(seen.filter((state, i) => state !== seen[i - 1])).toEqual(["available", "downloading", "ready"]); // + progress updates
    expect(updater.status).toMatchObject({ state: "ready", version: "0.3.0", progress: { received: expect.any(Number), total: expect.any(Number) } });
    expect(existsSync(updater.downloaded!.binary)).toBe(true);
  });

  it("a bad download goes back to available, with the error, to be tried again", async () => {
    await publish("new kratos", `${"a".repeat(64)}  ${NAME}\n`);
    const { updater } = await run();
    expect(updater.status).toMatchObject({ state: "available", version: "0.3.0", error: expect.stringMatching(/checksum/) });
    expect(updater.downloaded).toBeUndefined();
  });
});

describe("Updater applies a ready release (3u5c)", () => {
  async function readyUpdater(apply: Applier) {
    await publish();
    const updater = new Updater("0.2.0", { fetch: github, downloadTo: freshDir(), releases: base, apply });
    await updater.check();
    await vi.waitFor(() => expect(updater.status.state).toBe("ready"));
    return updater;
  }

  it("waits until no agent is busy, holds new turns, installs, restarts into the new binary", async () => {
    let idle!: () => void;
    const installs: string[] = [];
    const restarts: string[] = [];
    const holds: boolean[] = [];
    const updater = await readyUpdater({
      whenIdle: () => new Promise<void>((resolve) => (idle = resolve)),
      hold: (on) => holds.push(on),
      install: async (_, version) => (installs.push(version), "/new/kratos"),
      restart: async (binary) => void restarts.push(binary),
    });
    const seen: UpdateStatus["state"][] = [];
    updater.subscribe((status) => seen.push(status.state));
    const applying = updater.apply();
    await vi.waitFor(() => expect(updater.status.state).toBe("waiting"));
    await updater.check(); // an hourly check while waiting doesn't start over
    expect(updater.status.state).toBe("waiting");
    expect(installs).toEqual([]);
    idle();
    await applying;
    expect(seen).toEqual(["waiting", "waiting", "applying"]); // the check only moved checkedAt
    expect(installs).toEqual(["0.3.0"]);
    expect(restarts).toEqual(["/new/kratos"]);
    expect(holds).toEqual([true]); // held from installing to the restart
  });

  it("a newer release found mid-update waits: the check only moves checkedAt", async () => {
    let idle!: () => void;
    const updater = await readyUpdater({ whenIdle: () => new Promise<void>((resolve) => (idle = resolve)), hold: () => {}, install: async () => "x", restart: async () => {} });
    void updater.apply();
    await vi.waitFor(() => expect(updater.status.state).toBe("waiting"));
    latestTag = "v0.4.0"; // published while we wait
    try {
      await updater.check();
    } finally {
      latestTag = "v0.3.0";
    }
    expect(updater.status).toMatchObject({ state: "waiting", version: "0.3.0" });
    idle();
  });

  it("an install that fails: ready again with the error, no restart, can be tried again", async () => {
    const restarts: string[] = [];
    const holds: boolean[] = [];
    const updater = await readyUpdater({
      whenIdle: async () => {},
      hold: (on) => holds.push(on),
      install: async () => {
        throw new Error("Homebrew doesn't list kratos 0.3.0 yet");
      },
      restart: async (binary) => void restarts.push(binary),
    });
    await updater.apply();
    expect(updater.status).toMatchObject({ state: "ready", version: "0.3.0", error: expect.stringMatching(/doesn't list/) });
    expect(restarts).toEqual([]);
    expect(holds).toEqual([true, false]); // turns allowed again
    expect(existsSync(updater.downloaded!.binary)).toBe(true); // still there: "Try again" works
  });

  it("cancel while waiting: ready again, and nothing is installed when the agents finish (3u5e)", async () => {
    let idle!: () => void;
    const installs: string[] = [];
    const updater = await readyUpdater({
      whenIdle: () => new Promise<void>((resolve) => (idle = resolve)),
      hold: () => {},
      install: async (_, version) => (installs.push(version), "/new/kratos"),
      restart: async () => {},
    });
    const applying = updater.apply();
    await vi.waitFor(() => expect(updater.status.state).toBe("waiting"));
    updater.cancel();
    expect(updater.status.state).toBe("ready");
    idle();
    await applying;
    expect(installs).toEqual([]);
    expect(updater.status.state).toBe("ready");
  });

  it("only a ready release is applied", async () => {
    const updater = new Updater("0.2.0", { apply: { whenIdle: async () => {}, hold: () => {}, install: async () => "x", restart: async () => {} } });
    await updater.apply();
    expect(updater.status.state).toBe("idle");
  });
});

describe("Updater cleans up downloads (3u5c)", () => {
  it("at start, removes the downloads of this version and older ones, keeps newer ones", async () => {
    const dir = freshDir();
    for (const v of ["0.2.0", "0.3.0", "0.4.0", "notes"]) mkdirSync(join(dir, v));
    const updater = new Updater("0.3.0", { fetch: github, downloadTo: dir });
    updater.start();
    await vi.waitFor(() => expect(readdirSync(dir).sort()).toEqual(["0.4.0", "notes"]));
    updater.stop();
  });
});
