import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "tar";
import type { UpdateStatus } from "@kratos/core";
import { assetName, downloadRelease } from "./download.js";
import { Updater } from "./updater.js";

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

  it("reuses an archive already downloaded and still matching", async () => {
    await publish();
    const dir = freshDir();
    await download(dir);
    requests.length = 0;
    expect(await download(dir)).not.toBeNull();
    expect(requests).toEqual(["/download/v0.3.0/SHA256SUMS"]); // the archive wasn't fetched again
  });
});

describe("Updater downloads a newer release (3u5b)", () => {
  /** GitHub: the API is faked (v0.3.0 is latest), downloads go to the local server. */
  const github = (async (url: string | URL | Request, init?: RequestInit) =>
    String(url).includes("api.github.com")
      ? Response.json({ tag_name: "v0.3.0", html_url: "https://github.com/ameerthehacker/kratos/releases/tag/v0.3.0", prerelease: false })
      : fetch(url, init)) as typeof fetch;

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
    expect(seen).toEqual(["available", "downloading", "ready"]);
    expect(updater.status).toMatchObject({ state: "ready", version: "0.3.0" });
    expect(existsSync(updater.downloaded!.binary)).toBe(true);
  });

  it("a bad download goes back to available, with the error, to be tried again", async () => {
    await publish("new kratos", `${"a".repeat(64)}  ${NAME}\n`);
    const { updater } = await run();
    expect(updater.status).toMatchObject({ state: "available", version: "0.3.0", error: expect.stringMatching(/checksum/) });
    expect(updater.downloaded).toBeUndefined();
  });
});
