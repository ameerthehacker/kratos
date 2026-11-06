import { afterEach, describe, expect, it } from "vitest";
import { JsonLinesProcess } from "./json-lines-process.js";

const spawned: JsonLinesProcess[] = [];

/** A fake child: a Node one-liner, so tests are fast and need no real CLI. */
const fake = (code: string, options: { forceKillAfterMs?: number } = {}) => {
  const proc = new JsonLinesProcess(process.execPath, ["-e", code], { cwd: process.cwd(), ...options });
  spawned.push(proc);
  return proc;
};

// If a test fails mid-way (e.g. stop() is broken), its child must not outlive it and hang the run.
afterEach(() => {
  for (const proc of spawned.splice(0)) {
    if (proc.isRunning && proc.pid) process.kill(proc.pid, "SIGKILL");
  }
});

async function collect(proc: JsonLinesProcess): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const message of proc.messages()) out.push(message);
  return out;
}

describe("JsonLinesProcess", () => {
  it("parses JSON lines, skips other output, and reports an unrequested crash", async () => {
    const proc = fake(`console.log('{"n":1}'); console.log("not json"); console.log('{"n":2}'); process.exit(3)`);

    expect(await collect(proc)).toEqual([{ n: 1 }, { n: 2 }]);
    const exit = await proc.exited;
    expect(exit).toMatchObject({ requested: false, code: 3 });
    expect(exit.message).toBeTruthy();
  });

  it("send() after exit returns false and never throws, even while the child is dying", async () => {
    const proc = fake(`process.exit(0)`);
    // Hammer writes during shutdown. (EPIPE itself doesn't reproduce on Node 22/macOS — D26 —
    // so this guards the contract, not the stdin error handler.)
    const spam = setInterval(() => proc.send({ spam: true }), 1);
    await proc.exited;
    await new Promise((resolve) => setTimeout(resolve, 50));
    clearInterval(spam);

    expect(proc.isRunning).toBe(false);
    expect(proc.send({ late: true })).toBe(false);
  });

  it("round-trips a message and stops gracefully when the child exits on stdin close", async () => {
    const proc = fake(
      `process.stdin.on("data", (d) => process.stdout.write(d)); process.stdin.on("end", () => process.exit(0))`,
    );
    expect(proc.send({ ping: 1 })).toBe(true);
    const first = await proc.messages().next();
    expect(first.value).toEqual({ ping: 1 });

    const exit = await proc.stop(5_000); // generous grace: it should exit on stdin close, not timeout
    expect(exit).toMatchObject({ requested: true, code: 0 });
    expect(exit.signal).toBeUndefined();
  });

  it("escalates to SIGKILL when the child ignores stdin close and SIGTERM", async () => {
    const proc = fake(
      `process.on("SIGTERM", () => {}); console.log('{"ready":true}'); setInterval(() => {}, 1000)`,
      { forceKillAfterMs: 200 },
    );
    // Wait until the SIGTERM handler is installed, so the test is deterministic.
    expect((await proc.messages().next()).value).toEqual({ ready: true });

    const exit = await proc.stop(100);
    expect(exit).toMatchObject({ requested: true, signal: "SIGKILL" });
    expect(proc.isRunning).toBe(false);
  });
});
