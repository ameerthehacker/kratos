import { describe, expect, it } from "vitest";
import { scopeMatcher } from "./scope.js";

describe("scopeMatcher (4p7, D79)", () => {
  it("globs as globs; a plain path is itself or a folder", () => {
    const inScope = scopeMatcher(["src/**/*.ts", "apps/cli/src/plans/", "docs", "./README.md", "src/[id].tsx"]);
    expect(inScope("src/deep/a.ts")).toBe(true);
    expect(inScope("src/a.js")).toBe(false);
    expect(inScope("apps/cli/src/plans/plan-file.ts")).toBe(true);
    expect(inScope("docs/x/y.md")).toBe(true);
    expect(inScope("docs")).toBe(true);
    expect(inScope("docsy/x.md")).toBe(false);
    expect(inScope("README.md")).toBe(true);
    expect(inScope("src/[id].tsx")).toBe(true); // a literal path with glob characters covers itself
    expect(inScope(".github/x.yml")).toBe(false);
    expect(scopeMatcher([".github/**"])(".github/x.yml")).toBe(true);
  });

  it("an empty Scope covers nothing", () => {
    expect(scopeMatcher([])("a.ts")).toBe(false);
    expect(scopeMatcher(["  "])("a.ts")).toBe(false);
  });
});
