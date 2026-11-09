import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "./run.js";

const SRC = fileURLToPath(new URL(".", import.meta.url));

describe("run (3u5c, 3z7)", () => {
  it("gives the output as text, and fails with the command and its stderr", async () => {
    expect(await run(process.execPath, ["-e", "process.stdout.write('hi')"])).toBe("hi");
    await expect(run(process.execPath, ["-e", "console.error('nope'); process.exit(3)"])).rejects.toThrow(/-e .* failed: nope/);
  });

  it("is the only way src/ runs a command for its output: no promisify(exec…), broken in the binary", () => {
    const offenders = (readdirSync(SRC, { recursive: true }) as string[])
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) => /promisify\(\s*exec/.test(readFileSync(join(SRC, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
