import { describe, expect, it } from "vitest";
import { featureNudge } from "./kratos-tools.js";

describe("the nudge (4m5, D77)", () => {
  it("a one-off is told it can offer to file itself and finish; never its feature", () => {
    const text = featureNudge({ inFeature: false });
    expect(text).toContain("list_features");
    expect(text).toContain("file_session");
    expect(text).toContain("mark_session_done");
    expect(text).not.toContain("mark_feature_done");
  });

  it("a session in a feature is told it can offer to finish it or its feature; not to file itself", () => {
    const text = featureNudge({ inFeature: true });
    expect(text).toContain("mark_session_done");
    expect(text).toContain("mark_feature_done");
    expect(text).not.toContain("file_session");
  });

  it("both: calling the tool is the asking, once, and not again after a no", () => {
    for (const inFeature of [false, true]) {
      const text = featureNudge({ inFeature });
      expect(text).toContain("don't ask in words first");
      expect(text).toContain("at most once in this session");
      expect(text).toContain("after the owner says no");
    }
  });
});
