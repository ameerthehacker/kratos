import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { extract } from "tar";
import { REPOSITORY } from "../version.js";

/** Where release files are downloaded from (tests point it at a local server). */
export const RELEASES = `${REPOSITORY}/releases/download`;

/** This machine's archive, named as the release workflow names it (D57). */
export const assetName = (version: string, target = `${process.platform}-${process.arch}`) => `kratos-${version}-${target}.tar.gz`;

/** A downloaded, checked release: the archive (brew installs from it, 3u5c) and the binary in it. */
export type Downloaded = { archive: string; binary: string };

/**
 * Fetches release `version` for this machine into `dir` and checks it against the release's
 * `SHA256SUMS` (3u5b, D61). Returns null when the release has no files for us yet — right after
 * publishing, the workflow is still building them. Throws on a checksum mismatch (the bad file is
 * deleted) and on network errors. A file already downloaded and still matching is reused.
 */
export async function downloadRelease(options: {
  version: string;
  dir: string;
  fetch: typeof fetch;
  base?: string;
  target?: string;
  /** Bytes of the archive so far, per chunk (`total` from Content-Length, if sent). */
  onProgress?: (received: number, total?: number) => void;
}): Promise<Downloaded | null> {
  const { version, dir } = options;
  const url = (file: string) => `${options.base ?? RELEASES}/v${version}/${file}`;
  const name = assetName(version, options.target);

  // SHA256SUMS is attached last (after every archive), so its absence means "not yet".
  const sums = await options.fetch(url("SHA256SUMS"), { signal: AbortSignal.timeout(30_000) });
  if (sums.status === 404) return null;
  if (!sums.ok) throw new Error(`SHA256SUMS: GitHub answered ${sums.status}`);
  const expected = parseSums(await sums.text())[name];
  if (!expected) return null;

  await mkdir(dir, { recursive: true });
  const archive = join(dir, name);
  const binary = join(dir, "kratos");
  if (!(existsSync(archive) && (await sha256(archive)) === expected)) {
    const response = await options.fetch(url(name), { signal: AbortSignal.timeout(10 * 60_000) });
    if (response.status === 404) return null;
    if (!response.ok || !response.body) throw new Error(`${name}: GitHub answered ${response.status}`);
    const part = `${archive}.part`;
    const hash = createHash("sha256");
    const total = Number(response.headers.get("content-length")) || undefined;
    let received = 0;
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          options.onProgress?.((received += chunk.length), total);
          yield chunk;
        }
      },
      createWriteStream(part),
    );
    const got = hash.digest("hex");
    if (got !== expected) {
      await rm(part, { force: true });
      throw new Error(`${name} doesn't match its checksum (expected ${expected.slice(0, 12)}…, got ${got.slice(0, 12)}…)`);
    }
    await rename(part, archive);
    options.onProgress?.(received, received); // complete, even if the server didn't send a length
  } else {
    const { size } = await stat(archive); // already here and still matching
    options.onProgress?.(size, size);
  }
  await rm(binary, { force: true }); // always unpacked from the archive just checked
  await extract({ file: archive, cwd: dir, filter: (path) => path === "kratos" });
  if (!existsSync(binary)) throw new Error(`${name} has no kratos binary in it`);
  return { archive, binary };
}

/** sha256sum's output ("<hash>  <file>" per line) → { file: hash }. */
export function parseSums(text: string): Record<string, string> {
  const sums: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64}) [ *]?(\S+)$/.exec(line.trim());
    if (match) sums[match[2]!] = match[1]!;
  }
  return sums;
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
