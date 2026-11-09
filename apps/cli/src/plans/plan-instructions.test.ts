import { describe, expect, it } from "vitest";
import { parsePlan } from "./plan-file.js";
import { movedNote, PLAN_FORMAT, planInstructions } from "./plan-instructions.js";

describe("planInstructions (4p2, D79)", () => {
  it("shows the agent the very format Kratos reads: it parses with no notes", () => {
    const plan = parsePlan(PLAN_FORMAT.replace("<title>", "Example"), "feature");
    expect(plan.notes).toEqual([]);
    expect(plan.steps.map((s) => [s.id, s.mark])).toEqual([
      ["P1", "todo"],
      ["P2", "todo"],
    ]);
    expect(plan.steps[0]).toMatchObject({ scope: ["path/or/glob", "another/**"], accept: "what will prove it works." });
    expect(plan.decisions).toMatchObject([{ id: "D1", status: "proposed" }]);
    expect(plan.questions).toEqual([{ text: "<a question for the owner>", answered: false }]);
  });

  it("a one-off: only its own plan, which is the whole plan", () => {
    const text = planInstructions({ session: ".kratos/sessions/s1/plan.md" });
    expect(text).toContain("This session's plan: .kratos/sessions/s1/plan.md (this session isn't part of a feature");
    expect(text).not.toContain("feature plan, for");
    expect(text).not.toContain("belong in the feature plan");
    expect(text).toContain("Never write [x] on it yourself.");
    expect(text).toContain('A step the owner sent back is [~] again with a "Not yet:" line'); // 4p4a
    expect(text).toContain('The owner\'s questions to you (like "Why D2 (…)?")');
  });

  it("in a feature: both plans, and new steps and decisions go to the feature's", () => {
    const text = planInstructions({ session: ".kratos/sessions/s1/plan.md", feature: { title: "CSV export", path: ".kratos/features/csv-export/plan.md" } });
    expect(text).toContain("The feature plan, for “CSV export”: what and why, shared by every session working on it: .kratos/features/csv-export/plan.md");
    expect(text).toContain("This session's plan: how this session does its part");
    expect(text).toContain("New steps and decisions belong in the feature plan");
    expect(text).toContain("If the feature plan hasn't been started, the plan you write is the feature plan");
  });

  it("the note after a move says where the plans are now", () => {
    expect(movedNote({ session: "s.md", feature: { title: "CSV export", path: "f.md" } })).toBe(
      "[Kratos] This session is now part of the feature “CSV export”; its feature plan is f.md. This session's plan is still s.md. Read the plans before going on.",
    );
    expect(movedNote({ session: "s.md" })).toMatch(/^\[Kratos\] This session is no longer part of a feature/);
  });
});
