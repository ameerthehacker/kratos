import { diffLines, diffWordsWithSpace } from "diff";

/**
 * A file's change as rows to draw (3v2, D65): line changes and the words that changed inside them
 * come from jsdiff, compared the same way the server counts +/− (`ignoreNewlineAtEof`).
 */

/** One line of the diff. `old`/`new` are 1-based line numbers on each side (absent where the line
 * doesn't exist); `marks` are the changed parts of a changed line, as [start, end) offsets. */
export type DiffLine = { kind: "same" | "add" | "del"; old?: number; new?: number; text: string; marks?: Array<[number, number]> };

/** A row: a line, or unchanged lines folded away (`id` stays the same while the text does). */
export type DiffRow = { type: "line"; line: DiffLine } | { type: "fold"; id: number; count: number };

/** Unchanged lines kept around each change. */
const CONTEXT = 3;
/** Fewer hidden lines than this are just shown: a bar would take as much room as they do. */
const MIN_FOLD = 4;
/** Word highlights only when at least this share of the line stayed: otherwise it's a new line,
 * and marking nearly all of it says nothing. Low enough for a rename in a short line
 * (`this.broadcastSessionList();` → `this.announceSessions();` keeps ~30%). */
const MIN_KEPT = 0.25;

export function diffLinesOf(before: string, after: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let old = 1;
  let now = 1;
  for (const part of diffLines(before, after, { ignoreNewlineAtEof: true })) {
    for (const text of splitLines(part.value)) {
      if (part.added) lines.push({ kind: "add", new: now++, text });
      else if (part.removed) lines.push({ kind: "del", old: old++, text });
      else lines.push({ kind: "same", old: old++, new: now++, text });
    }
  }
  markWords(lines);
  return lines;
}

/** Rows to draw: unchanged runs longer than the context around changes fold into one bar, unless
 * opened (`open` holds fold ids). */
export function foldRows(lines: readonly DiffLine[], open: ReadonlySet<number> = new Set()): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "same") {
      rows.push({ type: "line", line: lines[i++]! });
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end]!.kind === "same") end++;
    // Keep the context next to a change: after the one before the run, before the one after it.
    const keepTop = i === 0 ? 0 : CONTEXT;
    const keepBottom = end === lines.length ? 0 : CONTEXT;
    const hidden = end - i - keepTop - keepBottom;
    if (hidden < MIN_FOLD || open.has(i + keepTop)) {
      for (let k = i; k < end; k++) rows.push({ type: "line", line: lines[k]! });
    } else {
      for (let k = i; k < i + keepTop; k++) rows.push({ type: "line", line: lines[k]! });
      rows.push({ type: "fold", id: i + keepTop, count: hidden });
      for (let k = end - keepBottom; k < end; k++) rows.push({ type: "line", line: lines[k]! });
    }
    i = end;
  }
  return rows;
}

/** A piece of a line to draw: its text, its syntax colour, and whether it's a changed word. */
export type Span = { text: string; color?: string; marked: boolean };

/** Cut a line's syntax tokens (Shiki) at the edges of its changed words. Without tokens (not
 * highlighted yet), the plain text. */
export function lineSpans(text: string, tokens: ReadonlyArray<{ content: string; color?: string }> | undefined, marks: ReadonlyArray<[number, number]> = []): Span[] {
  const pieces = tokens && tokens.length > 0 ? tokens : [{ content: text }];
  const cuts = [...new Set(marks.flat())].sort((a, b) => a - b);
  const isMarked = (at: number) => marks.some(([start, end]) => at >= start && at < end);
  const spans: Span[] = [];
  let offset = 0;
  for (const token of pieces) {
    const start = offset;
    const end = offset + token.content.length;
    let from = start;
    for (const cut of [...cuts.filter((c) => c > start && c < end), end]) {
      if (cut > from) spans.push({ text: token.content.slice(from - start, cut - start), ...(token.color ? { color: token.color } : {}), marked: isMarked(from) });
      from = cut;
    }
    offset = end;
  }
  return spans;
}

/** A part's text as lines (jsdiff keeps each line's newline; the last may have none). */
function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Pair each run of removed lines with the added run right after it, line by line, and mark the
 * words that differ — when enough of the line stayed for that to help. */
function markWords(lines: DiffLine[]): void {
  for (let i = 0; i < lines.length; ) {
    if (lines[i]!.kind !== "del") {
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "del") dels.push(lines[i++]!);
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "add") adds.push(lines[i++]!);
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) markPair(dels[k]!, adds[k]!);
  }
}

function markPair(del: DiffLine, add: DiffLine): void {
  const delMarks: Array<[number, number]> = [];
  const addMarks: Array<[number, number]> = [];
  let inDel = 0;
  let inAdd = 0;
  let kept = 0;
  for (const part of diffWordsWithSpace(del.text, add.text)) {
    const length = part.value.length;
    if (part.removed) delMarks.push([inDel, (inDel += length)]);
    else if (part.added) addMarks.push([inAdd, (inAdd += length)]);
    else {
      kept += part.value.trim().length; // whitespace staying put doesn't make lines alike
      inDel += length;
      inAdd += length;
    }
  }
  if (kept < MIN_KEPT * Math.max(del.text.trim().length, add.text.trim().length)) return;
  if (delMarks.length > 0) del.marks = joinMarks(delMarks, del.text);
  if (addMarks.length > 0) add.marks = joinMarks(addMarks, add.text);
}

/** One mark for changes only whitespace apart: jsdiff gives `log, warn }` vs `log }` as "," and
 * "warn " around a kept space; it reads as one change. */
function joinMarks(marks: Array<[number, number]>, text: string): Array<[number, number]> {
  const joined: Array<[number, number]> = [];
  for (const mark of marks) {
    const last = joined.at(-1);
    if (last && text.slice(last[1], mark[0]).trim() === "") last[1] = mark[1];
    else joined.push([...mark]);
  }
  return joined;
}
