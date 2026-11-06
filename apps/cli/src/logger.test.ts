import { mkdtempSync, readFileSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLogger, logTargets } from "./logger.js";

describe("logger (D44)", () => {
  it("rotates files at 10 MB, keeping 5 in all, and prints info+ to the console", () => {
    const [consoleTarget, fileTarget] = logTargets({ logDir: "/logs" });
    expect(consoleTarget).toMatchObject({ target: "pino-pretty", level: "info", options: { destination: 1 } });
    expect(fileTarget).toMatchObject({
      target: "pino-roll",
      level: "debug",
      // count excludes the active file: 4 + 1 = 5; removeOtherLogFiles keeps the cap across restarts
      options: { file: "/logs/kratos.log", size: "10m", limit: { count: 4, removeOtherLogFiles: true }, symlink: true },
    });
    expect(logTargets({ logDir: "/logs", consoleLevel: "warn" })[0]!.level).toBe("warn");
  });

  it("writes JSON lines, debug included, to a file that current.log points at", async () => {
    const logDir = join(mkdtempSync(join(tmpdir(), "kratos-logs-")), "not", "yet"); // first run: no folder
    const log = createLogger({ logDir, consoleLevel: "error" }); // keep the test output clean
    log.child({ component: "hub" }).debug({ count: 3 }, "models loaded");
    await new Promise<void>((resolve, reject) => log.flush((err) => (err ? reject(err) : resolve())));

    const current = join(logDir, "current.log");
    await vi.waitFor(() => {
      const lines = readFileSync(current, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(lines).toContainEqual(expect.objectContaining({ level: 20, component: "hub", count: 3, msg: "models loaded" }));
    });
    expect(readlinkSync(current)).toMatch(/^kratos\.1\.log$/);
  });
});
