import { describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "@kratos/core";
import { memoryLogger } from "../logger.js";
import { Updater } from "./updater.js";

const RELEASES = "https://github.com/ameerthehacker/kratos/releases/tag";

/** GitHub's `releases/latest`, faked: answers with this release (or status), records calls. */
function fakeGitHub(answer: { tag: string; prerelease?: boolean } | { status: number } | { body: string } | Error) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
    if (answer instanceof Error) throw answer;
    if ("status" in answer) return new Response("{}", { status: answer.status });
    if ("body" in answer) return new Response(answer.body);
    return Response.json({ tag_name: answer.tag, html_url: `${RELEASES}/${answer.tag}`, prerelease: answer.prerelease ?? false, draft: false });
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

async function checkOnce(running: string, answer: Parameters<typeof fakeGitHub>[0]) {
  const github = fakeGitHub(answer);
  const { log, lines } = memoryLogger();
  const updater = new Updater(running, { fetch: github.fetch, log });
  const seen: UpdateStatus[] = [];
  updater.subscribe((status) => seen.push(status));
  await updater.check();
  return { updater, seen, lines, calls: github.calls };
}

describe("updater: is there a newer release?", () => {
  it("a newer release is available, with its page; asks GitHub's API with a user agent", async () => {
    const { updater, seen, lines, calls } = await checkOnce("0.1.0", { tag: "v0.2.0" });
    expect(updater.status).toEqual({ state: "available", version: "0.2.0", url: `${RELEASES}/v0.2.0`, checkedAt: expect.any(Number) });
    expect(seen).toEqual([updater.status]);
    expect(calls).toEqual([
      {
        url: "https://api.github.com/repos/ameerthehacker/kratos/releases/latest",
        headers: expect.objectContaining({ "user-agent": "kratos/0.1.0" }),
      },
    ]);
    expect(lines.map((l) => l.msg)).toContain(`kratos 0.2.0 is available: ${RELEASES}/v0.2.0`);
  });

  it("the same or an older release: up to date (and when it was checked), nothing announced", async () => {
    for (const tag of ["v0.2.0", "v0.1.9", "0.2.0"]) {
      const { updater, seen, lines } = await checkOnce("0.2.0", { tag });
      expect(updater.status).toEqual({ state: "idle", checkedAt: expect.any(Number) });
      expect(seen).toEqual([updater.status]);
      expect(lines.filter((l) => String(l.msg).includes("is available"))).toEqual([]);
    }
  });

  it("a release beats the pre-release it came from (0.2.0-rc.1 → 0.2.0)", async () => {
    const { updater } = await checkOnce("0.2.0-rc.1", { tag: "v0.2.0" });
    expect(updater.status).toMatchObject({ state: "available", version: "0.2.0" });
  });

  it("ignores pre-releases and a repo without releases", async () => {
    for (const answer of [{ tag: "v0.2.0-rc.1", prerelease: true }, { status: 404 }]) {
      expect((await checkOnce("0.1.0", answer)).updater.status).toMatchObject({ state: "idle", checkedAt: expect.any(Number) });
    }
  });

  it("a failed check changes nothing and is only logged at debug", async () => {
    for (const answer of [new TypeError("fetch failed"), { status: 503 }, { body: "<html>rate limited</html>" }, { body: '{"tag_name": 5}' }, { tag: "nightly" }]) {
      const { updater, seen, lines } = await checkOnce("0.1.0", answer);
      expect(updater.status).toEqual({ state: "idle" }); // no checkedAt: GitHub didn't answer
      expect(seen).toEqual([]);
      expect(lines.filter((l) => (l.level as number) > 20)).toEqual([]); // nothing above debug
      expect(lines.map((l) => l.msg)).toContain("update check failed");
    }
  });

  it("a source run (commit hash, dev) never asks GitHub", async () => {
    for (const running of ["71d1fae", "dev"]) {
      const { updater, calls } = await checkOnce(running, { tag: "v9.9.9" });
      expect(updater.enabled).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it("checks at start and then on its interval; announces a version only once", async () => {
    vi.useFakeTimers();
    try {
      const github = fakeGitHub({ tag: "v0.2.0" });
      const { log, lines } = memoryLogger();
      const updater = new Updater("0.1.0", { fetch: github.fetch, log, everyMs: 1000 });
      updater.start();
      await vi.advanceTimersByTimeAsync(3000);
      updater.stop();
      await vi.advanceTimersByTimeAsync(3000);
      expect(github.calls).toHaveLength(4); // at start + three intervals, none after stop
      expect(lines.filter((l) => String(l.msg).includes("is available"))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
