import { fromMarkdown } from "mdast-util-from-markdown";
import type { Heading, ListItem, RootContent } from "mdast";
import type { DecisionStatus, Plan, PlanAction, PlanDecision, PlanKind, PlanQuestion, PlanStep, StepMark } from "@kratos/core";

/**
 * Plan files (D79): read them, change one thing in them, and hold an agent's edit to who-writes-
 * what. Reading is lenient (never throws; problems become `notes`). Every change is a splice at a
 * position the reader found, so the rest of the file stays exactly as its author wrote it.
 */

const MARK_OF: Record<string, StepMark> = { " ": "todo", "~": "doing", "?": "claimed", x: "ticked", X: "ticked" };
const CHAR_OF: Record<StepMark, string> = { todo: " ", doing: "~", claimed: "?", ticked: "x" };

/** Characters of the source, [start, end). Empty when the thing is missing and goes there. */
interface Span {
  start: number;
  end: number;
}

/** What the reader found, with where each editable bit is. */
interface Located {
  plan: Plan;
  steps: { step: PlanStep; mark: Span; notYet?: Span; end: number; indent: string }[];
  decisions: { decision: PlanDecision; status: Span }[];
  questions: { question: PlanQuestion; mark: Span; answer?: Span; end: number; indent: string }[];
  /** Where Open questions is: its heading's end, and its list's when it has one (4p4a). */
  questionsAt?: { heading: number; list?: number };
}

/** A list item's bullet and optional `[c]` box. The box isn't Markdown we parse (`[~]`, `[?]`). */
const BULLET = /^([-*+]|\d+[.)])([ \t]+)(?:\[([ xX~?])\][ \t]+)?/;
/** `**P3. Title** rest` and `**Title** rest`. */
const ID_HEAD = /^\*\*([A-Za-z]+\d+[a-z]?)\.\s*(.+?)\*\*\s*(.*)$/;
const PLAIN_HEAD = /^\*\*(.+?)\*\*\s*(.*)$/;
const FIELD = /^(Scope|Accept|Proof|Answer|Not yet):\s*(.*)$/i;
const STATUS = /^\((proposed|accepted)\)\s*/i;
/** The dash or colon between a title and its text. */
const LEAD = /^(?:[—–:]|-(?!\S))\s*/;

/** A Map, not an object: a `## Constructor` heading mustn't find `Object.prototype`'s. */
const SECTIONS = new Map<string, "intent" | "steps" | "decisions" | "questions">(Object.entries({
  intent: "intent",
  approach: "intent",
  steps: "steps",
  decisions: "decisions",
  "open questions": "questions",
  questions: "questions",
}));

export function parsePlan(markdown: string, kind: PlanKind): Plan {
  return locate(markdown, kind).plan;
}

/** A new plan's file: the sections to fill. */
export function planTemplate(title: string, kind: PlanKind): string {
  const sections = kind === "feature" ? ["Intent", "Steps", "Decisions", "Open questions"] : ["Approach", "Steps"];
  return `# ${title}\n\n${sections.map((s) => `## ${s}\n`).join("\n")}`;
}

/** Sets a step's mark; undefined when there's no step with that id. */
export function markStep(markdown: string, id: string, mark: StepMark): string | undefined {
  const found = locate(markdown, "session").steps.find((s) => s.step.id === id);
  if (!found) return undefined;
  return splice(markdown, [boxSplice(found.mark, mark)]);
}

export function setDecisionStatus(markdown: string, id: string, status: DecisionStatus): string | undefined {
  const found = locate(markdown, "session").decisions.find((d) => d.decision.id === id);
  if (!found) return undefined;
  return splice(markdown, [statusSplice(found.status, status)]);
}

/** Answers an open question (found by its text): ticks it and writes or replaces its `Answer:`. */
export function answerQuestion(markdown: string, text: string, answer: string): string | undefined {
  const found = locate(markdown, "session").questions.find((q) => q.question.text === text);
  if (!found) return undefined;
  return splice(markdown, [boxSplice(found.mark, "ticked"), answerSplice(found, answer)]);
}

/** Sends a step back (4p4a): `[~]` again, with your note as its `Not yet:` line (replacing one). */
export function sendBack(markdown: string, id: string, note: string): string | undefined {
  const found = locate(markdown, "session").steps.find((s) => s.step.id === id);
  if (!found) return undefined;
  const text = note.replace(/\s+/g, " ").trim();
  const line = found.notYet ? { ...found.notYet, text: ` ${text}` } : { start: found.end, end: found.end, text: `\n${found.indent}Not yet: ${text}` };
  return splice(markdown, [boxSplice(found.mark, "doing"), line]);
}

/** Asks the agent why about a decision (4p4a): an open question, Open questions made if missing.
 * Asked already: unchanged. */
export function askWhy(markdown: string, id: string, note?: string): string | undefined {
  const found = locate(markdown, "session");
  const decision = found.decisions.find((d) => d.decision.id === id)?.decision;
  if (!decision) return undefined;
  const more = note?.replace(/\s+/g, " ").trim();
  const question = `Why ${id} (${decision.title})?${more ? ` ${more}` : ""}`;
  if (found.plan.questions.some((q) => q.text === question)) return markdown;
  const item = `- [ ] ${question}`;
  const at = found.questionsAt;
  if (at) return splice(markdown, [{ start: at.list ?? at.heading, end: at.list ?? at.heading, text: `\n${item}` }]);
  const gap = markdown === "" || markdown.endsWith("\n\n") ? "" : markdown.endsWith("\n") ? "\n" : "\n\n";
  return `${markdown}${gap}## Open questions\n${item}\n`;
}

/** Your change from the plan page (4p4a), as the new text; undefined when what it names isn't there. */
export function applyPlanAction(markdown: string, action: PlanAction): string | undefined {
  switch (action.kind) {
    case "tick":
      return markStep(markdown, action.stepId, "ticked");
    case "not_yet":
      return sendBack(markdown, action.stepId, action.note);
    case "accept":
      return setDecisionStatus(markdown, action.decisionId, "accepted");
    case "ask_why":
      return askWhy(markdown, action.decisionId, action.note);
    case "answer":
      return answerQuestion(markdown, action.question, action.answer);
  }
}

export interface Reconciled {
  markdown: string;
  /** What was put back, in words, for you and the agent. */
  undone: string[];
  intentChanged: boolean;
}

/**
 * Holds an agent's edit (`before` → `after`, one turn) to who writes what (D79): ticks on steps
 * with an id, accepted decisions and answers are yours, both ways. The agent's `[x]` becomes `[?]`
 * and your `[x]` it removed comes back; likewise accepted ↔ proposed; an answer it wrote stays,
 * as a suggestion, with the question open. Everything else it changed is kept.
 */
export function reconcileAgentEdit(before: string, after: string): Reconciled {
  const was = locate(before, "session");
  const now = locate(after, "session");
  const edits: Edit[] = [];
  const undone: string[] = [];

  const wasMark = new Map(was.plan.steps.filter((s) => s.id).map((s) => [s.id, s.mark]));
  for (const { step, mark } of now.steps) {
    if (!step.id) continue;
    const yours = wasMark.get(step.id) === "ticked";
    if (step.mark === "ticked" && !yours) {
      edits.push(boxSplice(mark, "claimed"));
      undone.push(`${step.id}: only you tick a step; marked [?] for you to check.`);
    } else if (step.mark !== "ticked" && yours) {
      edits.push(boxSplice(mark, "ticked"));
      undone.push(`${step.id}: you ticked it; the tick stays.`);
    }
  }

  const wasDecision = new Map(was.plan.decisions.filter((d) => d.id).map((d) => [d.id, d]));
  for (const { decision, status } of now.decisions) {
    if (!decision.id) continue;
    const yours = wasDecision.get(decision.id);
    const accepted = yours?.status === "accepted";
    const reworded = yours !== undefined && (yours.title !== decision.title || yours.text !== decision.text);
    if (decision.status === "accepted" && accepted && reworded) {
      // What you accepted isn't what it says now: the new wording waits for you again.
      edits.push(statusSplice(status, "proposed"));
      undone.push(`${decision.id}: changed after you accepted it; proposed again for you to accept.`);
    } else if (decision.status === "accepted" && !accepted) {
      edits.push(statusSplice(status, "proposed"));
      undone.push(`${decision.id}: only you accept a decision; left proposed.`);
    } else if (decision.status === "proposed" && accepted && !reworded) {
      edits.push(statusSplice(status, "accepted"));
      undone.push(`${decision.id}: you accepted it; it stays accepted.`);
    }
  }

  const wasAnswered = new Map(was.plan.questions.map((q) => [q.text, q]));
  for (const found of now.questions) {
    const { question, mark } = found;
    const yours = wasAnswered.get(question.text);
    if (question.answered && !yours?.answered) {
      edits.push(boxSplice(mark, "todo"));
      undone.push(`“${question.text}”: only you answer; its answer is kept as a suggestion, the question open.`);
    } else if (yours?.answered && (!question.answered || (yours.answer !== undefined && question.answer !== yours.answer))) {
      if (!question.answered) edits.push(boxSplice(mark, "ticked"));
      if (yours.answer !== undefined && question.answer !== yours.answer) edits.push(answerSplice(found, yours.answer));
      undone.push(`“${question.text}”: you answered it; your answer stays.`);
    }
  }

  const intentChanged = squash(was.plan.intent) !== squash(now.plan.intent);
  return { markdown: splice(after, edits), undone, intentChanged };
}

// --- reading ---

function locate(md: string, kind: PlanKind): Located {
  // micromark drops a leading byte-order mark and counts offsets without it; a space in its place
  // keeps every offset pointing into `md` (it's still the first line's indent, which is harmless).
  const tree = fromMarkdown(md.startsWith("\uFEFF") ? ` ${md.slice(1)}` : md);
  const found: Located = {
    plan: { title: "", steps: [], decisions: [], questions: [], notes: [] },
    steps: [],
    decisions: [],
    questions: [],
  };
  let section: ReturnType<typeof SECTIONS.get>;
  // One span per Intent / Approach section, so text between two of them isn't swallowed.
  const intents: Span[] = [];
  let freshSection = false;

  for (const node of tree.children) {
    if (node.type === "heading" && node.depth <= 2) {
      const text = headingText(md, node);
      if (node.depth === 1 && !found.plan.title) found.plan.title = text;
      section = node.depth === 2 ? SECTIONS.get(text.toLowerCase()) : undefined;
      if (section === "questions" && !found.questionsAt) found.questionsAt = { heading: end(node) };
      freshSection = true;
      continue;
    }
    if (section === "intent") {
      if (freshSection) intents.push({ start: start(node), end: end(node) });
      else intents[intents.length - 1]!.end = end(node);
      freshSection = false;
    } else if (section && node.type === "list") {
      if (section === "questions" && found.questionsAt) found.questionsAt.list = end(node);
      for (const item of node.children) {
        if (section === "steps") readStep(md, item, found);
        else if (section === "decisions") readDecision(md, item, found);
        else readQuestion(md, item, found);
      }
    }
  }

  const { plan } = found;
  if (intents.length) plan.intent = intents.map((s) => md.slice(s.start, s.end).trim()).join("\n\n");
  if (!plan.title) plan.notes.push("No title: the first line should be `# Title`.");
  for (const id of duplicates(plan.steps.map((s) => s.id))) plan.notes.push(`Two steps are ${id}; ids must be unique.`);
  for (const id of duplicates(plan.decisions.map((d) => d.id))) plan.notes.push(`Two decisions are ${id}; ids must be unique.`);
  if (kind === "feature") {
    for (const s of plan.steps.filter((s) => !s.id)) plan.notes.push(`A step without an id: “${s.title}”. Feature plan steps need one (P1, P2…).`);
  }
  for (const d of plan.decisions.filter((d) => !d.id)) plan.notes.push(`A decision without an id: “${d.title}”.`);
  return found;
}

/** One list item's text after its bullet and box, as lines with their offsets; nested lists left out. */
interface Body {
  mark: Span;
  box: string | undefined;
  lines: { text: string; at: number }[];
  end: number;
  indent: string;
}

function body(md: string, item: ListItem): Body {
  const from = start(item);
  const nested = item.children.find((c) => c.type === "list");
  const content = item.children.filter((c) => c.type !== "list");
  const to = content.length ? end(content[content.length - 1]!) : from;
  const head = BULLET.exec(md.slice(from, to));
  const bulletEnd = from + (head ? head[0].length : 0);
  // The box character, or where a box would go when the item has none.
  const boxAt = head?.[3] !== undefined ? from + head[0].indexOf("[") + 1 : bulletEnd;
  const mark = head?.[3] !== undefined ? { start: boxAt, end: boxAt + 1 } : { start: bulletEnd, end: bulletEnd };
  const lines: Body["lines"] = [];
  let at = bulletEnd;
  for (const raw of md.slice(bulletEnd, nested ? Math.min(to, start(nested)) : to).split("\n")) {
    const lead = raw.length - raw.trimStart().length;
    if (raw.trim()) lines.push({ text: raw.trim(), at: at + lead });
    at += raw.length + 1;
  }
  const column = (item.position?.start.column ?? 1) - 1;
  // The item's content column (CommonMark): the bullet plus its 1–4 spaces (5+ means 1 and code).
  const gap = head ? head[2]!.length : 1;
  const bullet = head ? head[1]!.length + (gap > 4 ? 1 : gap) : 2;
  return { mark, box: head?.[3], lines, end: to, indent: " ".repeat(column + bullet) };
}

function readStep(md: string, item: ListItem, found: Located) {
  const { mark, box, lines, end, indent } = body(md, item);
  if (!lines.length) return;
  const [first, ...rest] = lines;
  const withId = ID_HEAD.exec(first!.text);
  const plain = withId ? undefined : PLAIN_HEAD.exec(first!.text);
  // Your `Not yet:` line (4p4a): from right after the colon to its end, to replace.
  const back = rest.find((l) => /^Not yet:/i.test(l.text));
  const notYet = back && { start: back.at + back.text.indexOf(":") + 1, end: back.at + back.text.length };
  const step: PlanStep = {
    id: withId?.[1],
    title: (withId?.[2] ?? plain?.[1] ?? first!.text).trim(),
    mark: box === undefined ? "todo" : MARK_OF[box]!,
    scope: [],
  };
  const fields = gather((withId?.[3] ?? plain?.[2] ?? "").replace(LEAD, ""), rest);
  if (fields.goal) step.goal = fields.goal;
  if (fields.scope) step.scope = scopeList(fields.scope);
  if (fields.accept) step.accept = fields.accept;
  if (fields.proof) step.proof = fields.proof;
  if (fields["not yet"]) step.notYet = fields["not yet"];
  found.plan.steps.push(step);
  found.steps.push({ step, mark, notYet, end, indent });
}

function readDecision(md: string, item: ListItem, found: Located) {
  const { lines } = body(md, item);
  if (!lines.length) return;
  const [first, ...rest] = lines;
  const withId = ID_HEAD.exec(first!.text);
  const plain = withId ? undefined : PLAIN_HEAD.exec(first!.text);
  const tail = withId?.[3] ?? plain?.[2] ?? "";
  const status = STATUS.exec(tail);
  // Where the status word is, or where ` (proposed)` would go: right after the bold title.
  const tailAt = first!.at + first!.text.length - tail.length;
  const boldEnd = first!.text.startsWith("**") ? first!.at + first!.text.indexOf("**", 2) + 2 : first!.at + first!.text.length;
  const span = status ? { start: tailAt + 1, end: tailAt + 1 + status[1]!.length } : { start: boldEnd, end: boldEnd };
  const decision: PlanDecision = {
    id: withId?.[1],
    title: (withId?.[2] ?? plain?.[1] ?? first!.text).trim(),
    status: status?.[1]?.toLowerCase() === "accepted" ? "accepted" : "proposed",
    text: [tail.replace(STATUS, "").replace(LEAD, ""), ...rest.map((l) => l.text)].filter(Boolean).join("\n"),
  };
  found.plan.decisions.push(decision);
  found.decisions.push({ decision, status: span });
}

function readQuestion(md: string, item: ListItem, found: Located) {
  const { mark, box, lines, end, indent } = body(md, item);
  if (!lines.length) return;
  const [first, ...rest] = lines;
  const question: PlanQuestion = { text: first!.text, answered: box === "x" || box === "X" };
  // The answer is its `Answer:` line and every line after it (answerQuestion writes several).
  const at = rest.findIndex((l) => /^Answer:/i.test(l.text));
  let answer: Span | undefined;
  if (at >= 0) {
    const [line, ...more] = rest.slice(at);
    question.answer = [FIELD.exec(line!.text)![2]!, ...more.map((l) => l.text)].filter(Boolean).join("\n");
    const last = more.length ? more[more.length - 1]! : line!;
    // From right after `Answer:` to the end of its last line; a new answer is written as ` text`.
    answer = { start: line!.at + line!.text.indexOf(":") + 1, end: last.at + last.text.length };
  }
  found.plan.questions.push(question);
  found.questions.push({ question, mark, answer, end, indent });
}

/** A step's or decision's text after its title: the goal, then `Scope:` / `Accept:` / `Proof:`. */
function gather(goal: string, lines: { text: string }[]) {
  const fields: Record<string, string> = { goal };
  let current = "goal";
  for (const { text } of lines) {
    const field = FIELD.exec(text);
    if (field) {
      current = field[1]!.toLowerCase();
      fields[current] = field[2]!;
    } else fields[current] = [fields[current], text].filter(Boolean).join(" ");
  }
  return fields as { goal?: string; scope?: string; accept?: string; proof?: string; "not yet"?: string };
}

/** `` `a/**`, `b.ts` `` → its backticked parts; without backticks, split on commas. */
function scopeList(text: string): string[] {
  const ticked = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  return ticked.length ? ticked : text.split(",").map((s) => s.trim()).filter(Boolean);
}

function headingText(md: string, heading: Heading): string {
  const kids = heading.children;
  return kids.length ? md.slice(start(kids[0]!), end(kids[kids.length - 1]!)).trim() : "";
}

const start = (node: RootContent | ListItem) => node.position?.start.offset ?? 0;
const end = (node: RootContent | ListItem) => node.position?.end.offset ?? 0;
const squash = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const duplicates = (ids: (string | undefined)[]) =>
  [...new Set(ids.filter((id, i) => id && ids.indexOf(id) !== i))] as string[];

// --- writing ---

interface Edit extends Span {
  text: string;
}

/** A box set to `mark`; an item without a box gets one. */
function boxSplice(at: Span, mark: StepMark): Edit {
  return { ...at, text: at.start === at.end ? `[${CHAR_OF[mark]}] ` : CHAR_OF[mark] };
}

/** Writes a question's answer, its later lines indented under the item; adds `Answer:` if missing. */
function answerSplice(q: Located["questions"][number], answer: string): Edit {
  const text = answer.trim().split("\n").join(`\n${q.indent}`);
  return q.answer ? { ...q.answer, text: ` ${text}` } : { start: q.end, end: q.end, text: `\n${q.indent}Answer: ${text}` };
}

function statusSplice(at: Span, status: DecisionStatus): Edit {
  return { ...at, text: at.start === at.end ? ` (${status})` : status };
}

/** Applies edits from the back, so earlier offsets stay right. */
function splice(text: string, edits: Edit[]): string {
  return [...edits].sort((a, b) => b.start - a.start).reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), text);
}
