import { describe, expect, it } from "vitest";
import { diffLinesOf, foldRows, lineSpans, pairRows, type DiffRow, type SplitRow } from "./diff-rows";

const numbered = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `line ${i + from}`).join("\n") + "\n";
/** A row as a short string: "  3 3 line 3", "+  4 new", "-5   old", "… 7". */
const show = (rows: DiffRow[]) =>
  rows.map((r) => (r.type === "fold" ? `… ${r.count}` : `${{ same: " ", add: "+", del: "-" }[r.line.kind]}${r.line.old ?? ""}/${r.line.new ?? ""} ${r.line.text}`));

describe("diffLinesOf (3v2)", () => {
  it("numbers both sides and marks the words that changed in a changed line", () => {
    const lines = diffLinesOf("import { log } from './log';\nkeep\n", "import { log, warn } from './log';\nkeep\nnew line\n");
    expect(lines).toEqual([
      { kind: "del", old: 1, text: "import { log } from './log';" },
      { kind: "add", new: 1, text: "import { log, warn } from './log';", marks: [[12, 19]] },
      { kind: "same", old: 2, new: 2, text: "keep" },
      { kind: "add", new: 3, text: "new line" },
    ]);
    expect(lines[1]!.text.slice(12, 19)).toBe(", warn "); // one mark, not "," and "warn "
  });

  it("no word marks when the lines have little in common", () => {
    const [del, add] = diffLinesOf("return a + b;\n", "throw new Error('nope');\n");
    expect(del).toEqual({ kind: "del", old: 1, text: "return a + b;" });
    expect(add).toEqual({ kind: "add", new: 1, text: "throw new Error('nope');" });
  });

  it("a missing newline at the end isn't a change; new and deleted files are all one side", () => {
    expect(diffLinesOf("a\nb", "a\nb\nc\n").map((l) => l.kind)).toEqual(["same", "same", "add"]);
    expect(diffLinesOf("", "x\ny\n")).toEqual([
      { kind: "add", new: 1, text: "x" },
      { kind: "add", new: 2, text: "y" },
    ]);
    expect(diffLinesOf("x\n", "").map((l) => l.kind)).toEqual(["del"]);
  });
});

describe("foldRows (3v2)", () => {
  it("folds unchanged lines beyond 3 around each change, and opens a fold by its id", () => {
    const before = numbered(20);
    const after = before.replace("line 10\n", "line ten\n");
    const lines = diffLinesOf(before, after);
    const rows = foldRows(lines);
    expect(show(rows)).toEqual([
      "… 6",
      " 7/7 line 7",
      " 8/8 line 8",
      " 9/9 line 9",
      "-10/ line 10",
      "+/10 line ten",
      " 11/11 line 11",
      " 12/12 line 12",
      " 13/13 line 13",
      "… 7",
    ]);
    const first = rows[0] as Extract<DiffRow, { type: "fold" }>;
    expect(show(foldRows(lines, new Set([first.id])))).toHaveLength(15); // 6 lines instead of the bar
  });

  it("shows short runs instead of folding them", () => {
    const before = numbered(9);
    const after = before.replace("line 1\n", "one\n").replace("line 9\n", "nine\n");
    // 7 unchanged lines between two changes: 3 + 3 kept, only 1 hidden → shown
    expect(foldRows(diffLinesOf(before, after)).every((r) => r.type === "line")).toBe(true);
  });
});

describe("lineSpans (3v2)", () => {
  it("cuts syntax tokens at changed-word edges", () => {
    const tokens = [
      { content: "import", color: "#f00" },
      { content: " { log, warn } ", color: "#fff" },
    ];
    expect(lineSpans("import { log, warn } ", tokens, [[12, 18]])).toEqual([
      { text: "import", color: "#f00", marked: false },
      { text: " { log", color: "#fff", marked: false },
      { text: ", warn", color: "#fff", marked: true },
      { text: " } ", color: "#fff", marked: false },
    ]);
  });

  it("plain text until highlighted", () => {
    expect(lineSpans("a b", undefined, [[2, 3]])).toEqual([
      { text: "a ", marked: false },
      { text: "b", marked: true },
    ]);
  });
});

describe("pairRows (3v3)", () => {
  /** A pair as "old | new" line numbers, "." for an empty side; folds as "…". */
  const sides = (rows: SplitRow[]) => rows.map((r) => (r.type === "fold" ? "…" : `${r.left?.old ?? "."} | ${r.right?.new ?? "."}`));

  it("puts unchanged lines on both sides and pairs each change's removed lines with its added ones", () => {
    const before = "a\nb\nc\nd\ne\n";
    const after = "a\nB\nC\nC2\nd\n"; // b,c → B,C,C2 (one more on the right); e removed (nothing on the right)
    expect(sides(pairRows(foldRows(diffLinesOf(before, after))))).toEqual(["1 | 1", "2 | 2", "3 | 3", ". | 4", "4 | 5", "5 | ."]);
  });

  it("keeps folds where they are", () => {
    const before = numbered(20);
    const rows = foldRows(diffLinesOf(before, before.replace("line 10\n", "line ten\n")));
    expect(sides(pairRows(rows))).toEqual(["…", "7 | 7", "8 | 8", "9 | 9", "10 | 10", "11 | 11", "12 | 12", "13 | 13", "…"]);
  });
});
