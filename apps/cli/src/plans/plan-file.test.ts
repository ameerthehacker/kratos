import { describe, expect, it } from "vitest";
import { Plan } from "@kratos/core";
import { answerQuestion, applyPlanAction, askWhy, markStep, parsePlan, planTemplate, reconcileAgentEdit, sendBack, setDecisionStatus } from "./plan-file.js";

const FEATURE = `# CSV export for reports

## Intent
Export the reports page as CSV,
with the filters you have on.

## Steps
- [x] **P1. Export button** — a button on the reports page.
  Scope: \`apps/web/src/pages/reports.tsx\`, \`apps/api/src/export/**\`
  Accept: clicking it downloads the rows.
  Proof: 14 tests pass; downloaded 120 rows by hand.
- [?] **P2. Filters in the export** — the rows you see.
- [~] **P2b. Saved filter presets**
- [ ] **P3. Stream large exports**

## Notes for later
Anything here is kept as written.

## Decisions
- **D1. CSV, not XLSX** (accepted) — simpler. Reverse: add an XLSX writer.
- **D2. Stream rows, don't buffer** (proposed) — exports can be big.

## Open questions
- [ ] Should exports respect the user's timezone?
- [x] Include hidden columns?
  Answer: No, only what you see.
`;

/** A session plan inside a feature: its "How" items have no ids, they're the agent's own. */
const FEATURE_SESSION = `# Filters in the export

## Approach
Filters ride on the export URL.

## Steps
- [x] Pass the filters to the export query
- [ ] Reuse the reports filter parser
`;

const ONE_OFF = `# Fix the scroll jump on replay

## Steps
- [ ] **S1. Reproduce with a long replay**
- [ ] **S2. Keep the anchor while replay streams**

## Decisions
- **D1. Anchor on the last message you read** — instead of the bottom.
`;

/** Each edit must change only its own characters: the rest byte for byte. */
function changedOnly(before: string, after: string): string {
  let head = 0;
  while (head < before.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && before.at(-1 - tail) === after.at(-1 - tail)) tail++;
  return `${before.slice(head, before.length - tail)} → ${after.slice(head, after.length - tail)}`;
}

describe("parsePlan (D79)", () => {
  it("reads a feature plan: title, intent, steps with fields, decisions, questions", () => {
    const plan = parsePlan(FEATURE, "feature");
    expect(Plan.parse(plan)).toEqual(plan);
    expect(plan.title).toBe("CSV export for reports");
    expect(plan.intent).toBe("Export the reports page as CSV,\nwith the filters you have on.");
    expect(plan.steps).toEqual([
      {
        id: "P1",
        title: "Export button",
        mark: "ticked",
        goal: "a button on the reports page.",
        scope: ["apps/web/src/pages/reports.tsx", "apps/api/src/export/**"],
        accept: "clicking it downloads the rows.",
        proof: "14 tests pass; downloaded 120 rows by hand.",
      },
      { id: "P2", title: "Filters in the export", mark: "claimed", goal: "the rows you see.", scope: [] },
      { id: "P2b", title: "Saved filter presets", mark: "doing", scope: [] },
      { id: "P3", title: "Stream large exports", mark: "todo", scope: [] },
    ]);
    expect(plan.decisions).toEqual([
      { id: "D1", title: "CSV, not XLSX", status: "accepted", text: "simpler. Reverse: add an XLSX writer." },
      { id: "D2", title: "Stream rows, don't buffer", status: "proposed", text: "exports can be big." },
    ]);
    expect(plan.questions).toEqual([
      { text: "Should exports respect the user's timezone?", answered: false },
      { text: "Include hidden columns?", answered: true, answer: "No, only what you see." },
    ]);
    expect(plan.notes).toEqual([]);
  });

  it("reads a feature's session plan: Approach as its intent, id-less steps, no notes", () => {
    const plan = parsePlan(FEATURE_SESSION, "session");
    expect(plan.intent).toBe("Filters ride on the export URL.");
    expect(plan.steps.map((s) => [s.id, s.title, s.mark])).toEqual([
      [undefined, "Pass the filters to the export query", "ticked"],
      [undefined, "Reuse the reports filter parser", "todo"],
    ]);
    expect(plan.notes).toEqual([]);
  });

  it("reads a one-off's session plan; a decision without a status is proposed", () => {
    const plan = parsePlan(ONE_OFF, "session");
    expect(plan.steps.map((s) => s.id)).toEqual(["S1", "S2"]);
    expect(plan.decisions).toEqual([
      { id: "D1", title: "Anchor on the last message you read", status: "proposed", text: "instead of the bottom." },
    ]);
  });

  it("keeps a messy plan and says what's wrong, never throws", () => {
    const plan = parsePlan(
      `Some text before any title.

## steps
* [ ] **P1. One**
* **P1. Same id again**
* [ ] a step with no id
  - [ ] a nested list is left out
1. [?] **P2. Numbered** - with a hyphen
`,
      "feature",
    );
    expect(plan.title).toBe("");
    expect(plan.steps.map((s) => [s.id, s.title, s.mark, s.goal])).toEqual([
      ["P1", "One", "todo", undefined],
      ["P1", "Same id again", "todo", undefined],
      [undefined, "a step with no id", "todo", undefined],
      ["P2", "Numbered", "claimed", "with a hyphen"],
    ]);
    expect(plan.notes).toEqual([
      "No title: the first line should be `# Title`.",
      "Two steps are P1; ids must be unique.",
      "A step without an id: “a step with no id”. Feature plan steps need one (P1, P2…).",
    ]);
  });

  it("reads an empty file and the templates", () => {
    expect(parsePlan("", "feature")).toEqual({
      title: "",
      steps: [],
      decisions: [],
      questions: [],
      notes: ["No title: the first line should be `# Title`."],
    });
    const template = planTemplate("CSV export", "feature");
    expect(template).toBe("# CSV export\n\n## Intent\n\n## Steps\n\n## Decisions\n\n## Open questions\n");
    expect(parsePlan(template, "feature")).toMatchObject({ title: "CSV export", steps: [], notes: [] });
    expect(planTemplate("Fix it", "session")).toBe("# Fix it\n\n## Approach\n\n## Steps\n");
  });
});

describe("plan edits change only their characters (D79)", () => {
  it("markStep sets the box, adds one where there was none, and misses an unknown id", () => {
    const ticked = markStep(FEATURE, "P2", "ticked")!;
    expect(changedOnly(FEATURE, ticked)).toBe("? → x");
    expect(parsePlan(ticked, "feature").steps[1]!.mark).toBe("ticked");

    const boxless = "# T\n\n## Steps\n- **P1. No box yet**\n";
    expect(markStep(boxless, "P1", "doing")).toBe("# T\n\n## Steps\n- [~] **P1. No box yet**\n");
    expect(markStep(FEATURE, "P9", "ticked")).toBeUndefined();
  });

  it("setDecisionStatus swaps the word, or adds it after the title", () => {
    expect(changedOnly(FEATURE, setDecisionStatus(FEATURE, "D2", "accepted")!)).toBe("propos → accept");
    const added = setDecisionStatus(ONE_OFF, "D1", "accepted")!;
    expect(added).toContain("- **D1. Anchor on the last message you read** (accepted) — instead of the bottom.");
    expect(changedOnly(ONE_OFF, added)).toBe(" → (accepted) ");
  });

  it("answerQuestion ticks it and writes its Answer line, or replaces the one there", () => {
    const answered = answerQuestion(FEATURE, "Should exports respect the user's timezone?", "Yes, the viewer's.")!;
    expect(answered).toContain("- [x] Should exports respect the user's timezone?\n  Answer: Yes, the viewer's.\n- [x] Include hidden columns?");
    expect(parsePlan(answered, "feature").questions[0]).toEqual({
      text: "Should exports respect the user's timezone?",
      answered: true,
      answer: "Yes, the viewer's.",
    });
    const replaced = answerQuestion(FEATURE, "Include hidden columns?", "Only with a toggle.")!;
    expect(replaced).toBe(FEATURE.replace("Answer: No, only what you see.", "Answer: Only with a toggle."));
  });
});

describe("reconcileAgentEdit (D79)", () => {
  it("the agent's [x] on an id'd step becomes [?]; on its own id-less item it stays", () => {
    const after = FEATURE.replace("- [ ] **P3.", "- [x] **P3.");
    const out = reconcileAgentEdit(FEATURE, after);
    expect(out.markdown).toBe(FEATURE.replace("- [ ] **P3.", "- [?] **P3."));
    expect(out.undone).toEqual(["P3: only you tick a step; marked [?] for you to check."]);

    const own = FEATURE_SESSION.replace("- [ ] Reuse", "- [x] Reuse");
    expect(reconcileAgentEdit(FEATURE_SESSION, own)).toEqual({ markdown: own, undone: [], intentChanged: false });
  });

  it("a new step the agent adds already ticked is [?] too; your tick it removed comes back", () => {
    const after = FEATURE.replace("- [x] **P1.", "- [ ] **P1.").replace("## Notes", "- [x] **P4. Sneaky**\n\n## Notes");
    const out = reconcileAgentEdit(FEATURE, after);
    expect(out.markdown).toBe(FEATURE.replace("## Notes", "- [?] **P4. Sneaky**\n\n## Notes"));
    expect(out.undone).toHaveLength(2);
  });

  it("accepted ↔ proposed are yours; an agent's answer stays as a suggestion, the question open", () => {
    const after = FEATURE.replace("(proposed)", "(accepted)").replace(
      "- [ ] Should exports respect the user's timezone?",
      "- [x] Should exports respect the user's timezone?\n  Answer: Probably UTC.",
    );
    const out = reconcileAgentEdit(FEATURE, after);
    expect(out.markdown).toBe(after.replace("(accepted) — exports", "(proposed) — exports").replace("- [x] Should", "- [ ] Should"));
    expect(parsePlan(out.markdown, "feature").questions[0]).toMatchObject({ answered: false, answer: "Probably UTC." });
    expect(out.undone).toHaveLength(2);
  });

  it("flags an intent change and keeps everything else the agent wrote", () => {
    const after = FEATURE.replace("with the filters you have on.", "with filters and totals.").replace(
      "- [?] **P2. Filters in the export** — the rows you see.",
      "- [?] **P2. Filters in the export** — the rows you see.\n  Proof: 6 filter tests pass.",
    );
    expect(reconcileAgentEdit(FEATURE, after)).toEqual({ markdown: after, undone: [], intentChanged: true });
  });
});

describe("review fixes (D79)", () => {
  it("reads a file with a byte-order mark, and edits it in place", () => {
    const bom = "﻿# T\n\n## Steps\n- [ ] **P1. One**\n";
    expect(parsePlan(bom, "session")).toMatchObject({ title: "T", notes: [] });
    expect(markStep(bom, "P1", "ticked")).toBe("﻿# T\n\n## Steps\n- [x] **P1. One**\n");
  });

  it("a heading named like an Object method isn't a section; two Approach sections don't swallow Steps", () => {
    expect(parsePlan("# T\n\n## Constructor\n- [x] hi\n", "session").questions).toEqual([]);
    const two = "# T\n\n## Intent\nA\n\n## Steps\n- [ ] **P1. x**\n\n## Approach\nB\n";
    expect(parsePlan(two, "session").intent).toBe("A\n\nB");
  });

  it("a multi-line answer reads back whole, and a new answer replaces all of it", () => {
    const q = "# T\n\n## Open questions\n-   [ ] Q?\n";
    const once = answerQuestion(q, "Q?", "line one\nline two")!;
    expect(once).toBe("# T\n\n## Open questions\n-   [x] Q?\n    Answer: line one\n    line two\n");
    expect(parsePlan(once, "session").questions[0]!.answer).toBe("line one\nline two");
    expect(answerQuestion(once, "Q?", "new")).toBe("# T\n\n## Open questions\n-   [x] Q?\n    Answer: new\n");
  });

  it("the agent rewording your accepted decision makes it proposed; your answer it rewrote comes back", () => {
    const after = FEATURE.replace("simpler.", "smaller.").replace("Answer: No, only what you see.", "Answer: Yes, all.");
    const out = reconcileAgentEdit(FEATURE, after);
    expect(out.markdown).toBe(after.replace("(accepted) — smaller.", "(proposed) — smaller.").replace("Answer: Yes, all.", "Answer: No, only what you see."));
    expect(out.undone).toHaveLength(2);
  });
});

describe("your side from the plan page (4p4a)", () => {
  it("sendBack: [~] with your note as a Not yet line, replacing the one there; read back as notYet", () => {
    const sent = sendBack(FEATURE, "P2", "the date\nfilter is ignored")!;
    expect(sent).toContain("- [~] **P2. Filters in the export** — the rows you see.\n  Not yet: the date filter is ignored\n- [~] **P2b.");
    expect(parsePlan(sent, "feature").steps[1]).toMatchObject({ id: "P2", mark: "doing", notYet: "the date filter is ignored" });
    const again = sendBack(sent, "P2", "still ignored")!;
    expect(again).toBe(sent.replace("Not yet: the date filter is ignored", "Not yet: still ignored"));
    expect(sendBack(FEATURE, "P9", "x")).toBeUndefined();
  });

  it("askWhy: an open question after the others, once; in an empty section; the section made if missing", () => {
    const asked = askWhy(FEATURE, "D2", "can't it share search's code?")!;
    expect(asked).toBe(FEATURE.replace("  Answer: No, only what you see.\n", "  Answer: No, only what you see.\n- [ ] Why D2 (Stream rows, don't buffer)? can't it share search's code?\n"));
    expect(askWhy(asked, "D2", "can't it share search's code?")).toBe(asked); // asked already
    expect(askWhy("# T\n\n## Decisions\n- **D1. A** (proposed)\n\n## Open questions\n", "D1")).toBe(
      "# T\n\n## Decisions\n- **D1. A** (proposed)\n\n## Open questions\n- [ ] Why D1 (A)?\n",
    );
    expect(askWhy("# T\n\n## Decisions\n- **D1. A** (proposed)\n", "D1")).toBe("# T\n\n## Decisions\n- **D1. A** (proposed)\n\n## Open questions\n- [ ] Why D1 (A)?\n");
    expect(parsePlan(asked, "feature").questions.at(-1)).toEqual({ text: "Why D2 (Stream rows, don't buffer)? can't it share search's code?", answered: false });
  });

  it("applyPlanAction does each of them, and says when what it names isn't there", () => {
    expect(applyPlanAction(FEATURE, { kind: "tick", stepId: "P2" })).toBe(markStep(FEATURE, "P2", "ticked"));
    expect(applyPlanAction(FEATURE, { kind: "accept", decisionId: "D2" })).toBe(setDecisionStatus(FEATURE, "D2", "accepted"));
    expect(applyPlanAction(FEATURE, { kind: "answer", question: "Should exports respect the user's timezone?", answer: "Yes" })).toBe(
      answerQuestion(FEATURE, "Should exports respect the user's timezone?", "Yes"),
    );
    expect(applyPlanAction(FEATURE, { kind: "not_yet", stepId: "P1", note: "n" })).toBe(sendBack(FEATURE, "P1", "n"));
    expect(applyPlanAction(FEATURE, { kind: "ask_why", decisionId: "D9" })).toBeUndefined();
  });
});
