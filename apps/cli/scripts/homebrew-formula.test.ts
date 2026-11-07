import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain .mjs build script, no types
import { formula, parseSums } from "./homebrew-formula.mjs";

const hash = (c: string) => c.repeat(64);
const sums = parseSums(
  [
    `${hash("a")}  kratos-1.2.3-darwin-arm64.tar.gz`,
    `${hash("b")}  kratos-1.2.3-darwin-x64.tar.gz`,
    `${hash("c")} *kratos-1.2.3-linux-arm64.tar.gz`,
    `${hash("d")}  kratos-1.2.3-linux-x64.tar.gz`,
    "",
  ].join("\n"),
);

describe("homebrew formula", () => {
  it("reads sha256sum output, text or binary mode", () => {
    expect(sums["kratos-1.2.3-linux-arm64.tar.gz"]).toBe(hash("c"));
    expect(Object.keys(sums)).toHaveLength(4);
  });

  it("pairs each OS and CPU with its archive and checksum", () => {
    const ruby: string = formula("1.2.3", sums);
    expect(ruby).toContain('version "1.2.3"');
    const macArm = ruby.slice(ruby.indexOf("on_macos do"), ruby.indexOf("on_linux do"));
    expect(macArm).toMatch(/on_arm do\n\s+url "https:\/\/github.com\/ameerthehacker\/kratos\/releases\/download\/v1.2.3\/kratos-1.2.3-darwin-arm64.tar.gz"\n\s+sha256 "a{64}"/);
    expect(macArm).toMatch(/on_intel do\n\s+url "[^"]+darwin-x64.tar.gz"\n\s+sha256 "b{64}"/);
    const linux = ruby.slice(ruby.indexOf("on_linux do"));
    expect(linux).toMatch(/on_arm do\n\s+url "[^"]+linux-arm64.tar.gz"\n\s+sha256 "c{64}"/);
    expect(linux).toMatch(/on_intel do\n\s+url "[^"]+linux-x64.tar.gz"\n\s+sha256 "d{64}"/);
  });

  it("refuses a missing archive or an odd version", () => {
    const { ["kratos-1.2.3-linux-x64.tar.gz"]: _, ...three } = sums;
    expect(() => formula("1.2.3", three)).toThrow("No checksum for kratos-1.2.3-linux-x64.tar.gz");
    expect(() => formula("v1.2.3", sums)).toThrow("Not a release version");
  });
});
