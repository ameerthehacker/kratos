import { describe, expect, it } from "vitest";
import { kratosVersion } from "./version.js";

describe("kratosVersion (3u1)", () => {
  it("a release shows its version and links to its GitHub release", () => {
    expect(kratosVersion({ packageVersion: () => "0.3.1", commit: () => "ab9151c" })).toEqual({
      version: "0.3.1",
      url: "https://github.com/ameerthehacker/kratos/releases/tag/v0.3.1",
    });
  });

  it("unreleased code (0.0.0) shows the commit it runs from, else 'dev'", () => {
    expect(kratosVersion({ packageVersion: () => "0.0.0", commit: () => "ab9151c" })).toEqual({
      version: "ab9151c",
      url: "https://github.com/ameerthehacker/kratos/commit/ab9151c",
    });
    expect(kratosVersion({ packageVersion: () => "0.0.0", commit: () => undefined })).toEqual({ version: "dev" });
  });

  it("KRATOS_VERSION makes a source run act as that release, to try updates locally (3u5d)", () => {
    process.env.KRATOS_VERSION = "0.0.9";
    try {
      expect(kratosVersion()).toEqual({ version: "0.0.9", url: "https://github.com/ameerthehacker/kratos/releases/tag/v0.0.9" });
    } finally {
      delete process.env.KRATOS_VERSION;
    }
  });

  it("this checkout is unreleased: its commit", () => {
    expect(kratosVersion().version).toMatch(/^[0-9a-f]{7,}$/);
  });
});
