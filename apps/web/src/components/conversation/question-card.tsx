import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, MessageCircleQuestion } from "lucide-react";
import { checkQuestionReply, type AgentQuestion, type QuestionAnswer, type QuestionReply, type QuestionRequest } from "@kratos/core";
import { cn } from "@/lib/utils";

/** Send the owner's reply to the agent's questions (the hub checks it; first answer wins). */
export type AnswerQuestions = (questionId: string, reply: QuestionReply) => void;

/** One question's answer while it's being given: picked labels and the "Other" text. */
type Draft = { selected: string[]; other: string };

const toAnswer = (draft: Draft): QuestionAnswer => ({
  selected: draft.selected,
  ...(draft.other.trim() ? { other: draft.other.trim() } : {}),
});

/** Does this draft answer its question? The same rule the server checks (core, D54). */
const isAnswered = (question: AgentQuestion, draft: Draft) =>
  checkQuestionReply({ questions: [question] }, { outcome: "answered", answers: [toAnswer(draft)] }) === null;

/**
 * The agent's questions, docked above the composer like a permission ask (3r2, the design's
 * "question widget"): one question at a time with tabs for several, radio or checkbox rows with
 * the agent's "Recommended" pick tagged (never pre-picked), an "Other" field for your own answer,
 * Back / Next / Send answers, and Skip (the agent then decides itself). Keys: 1–9 pick, ↵ next or
 * send, Esc skip. Shows the oldest open set of questions.
 */
export function QuestionDock(props: {
  questions: Array<{ id: string; request: QuestionRequest }>;
  agent: string;
  onAnswer: AnswerQuestions;
}) {
  const open = props.questions[0];
  if (!open) return null;
  // Keyed by id: a new set of questions starts with fresh answers.
  return <QuestionCard key={open.id} id={open.id} request={open.request} agent={props.agent} onAnswer={props.onAnswer} />;
}

function QuestionCard({ id, request, agent, onAnswer }: { id: string; request: QuestionRequest; agent: string; onAnswer: AnswerQuestions }) {
  const { questions } = request;
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(() => ({ selected: [], other: "" })));
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState(false); // until the server settles it
  const card = useRef<HTMLDivElement>(null);
  const question = questions[index]!;
  const draft = drafts[index]!;
  const last = index === questions.length - 1;
  const canGoOn = isAnswered(question, draft);
  const allAnswered = questions.every((q, i) => isAnswered(q, drafts[i]!));

  // Keys work as soon as the card shows — unless you're typing somewhere else.
  useEffect(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) card.current?.focus();
  }, []);

  const update = (change: (draft: Draft) => Draft) => setDrafts((all) => all.map((d, i) => (i === index ? change(d) : d)));
  const pick = (label: string) =>
    update((d) =>
      question.multiSelect
        ? { ...d, selected: d.selected.includes(label) ? d.selected.filter((l) => l !== label) : [...d.selected, label] }
        : { selected: [label], other: "" }, // single choice: a pick replaces your own text
    );
  const type = (text: string) => update((d) => (question.multiSelect ? { ...d, other: text } : { selected: [], other: text }));
  const reply = (answer: QuestionReply) => {
    setSent(true);
    onAnswer(id, answer);
  };
  const next = () => {
    if (!canGoOn || sent) return;
    if (!last) setIndex(index + 1);
    else if (allAnswered) reply({ outcome: "answered", answers: drafts.map(toAnswer) });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const typing = event.target instanceof HTMLInputElement;
    if (event.key === "Escape" && !sent) {
      event.preventDefault();
      reply({ outcome: "skipped" });
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      next();
    } else if (!typing && /^[1-9]$/.test(event.key)) {
      const option = question.options[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        pick(option.label);
      }
    }
  };

  const count = questions.length;
  return (
    <div
      ref={card}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="group"
      aria-label={`${agent} has ${count === 1 ? "a question" : `${count} questions`}`}
      className="mb-2 flex flex-col gap-3 rounded-2xl bg-card p-3.5 ring-1 ring-border outline-none"
    >
      <div className="flex items-center gap-2.5">
        <MessageCircleQuestion className="size-4 shrink-0 text-wait" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm text-secondary-foreground">
          {agent} has <span className="font-medium text-foreground">{count === 1 ? "a question" : `${count} questions`}</span>
        </span>
        <button
          type="button"
          disabled={sent}
          onClick={() => reply({ outcome: "skipped" })}
          className="h-7 rounded-full px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Skip
        </button>
      </div>

      {count > 1 && (
        <div role="tablist" aria-label="Questions" className="flex flex-wrap gap-1.5">
          {questions.map((q, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs focus-visible:outline-2 focus-visible:outline-ring",
                i === index ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {isAnswered(q, drafts[i]!) && <Check className="size-3 text-add" strokeWidth={2.6} aria-label="answered" />}
              {q.header || `Question ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      <p className="text-body">{question.question}</p>

      <div role={question.multiSelect ? "group" : "radiogroup"} aria-label={question.header || question.question} className="flex flex-col gap-1.5">
        {question.options.map((option, i) => {
          const picked = draft.selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              role={question.multiSelect ? "checkbox" : "radio"}
              aria-checked={picked}
              onClick={() => pick(option.label)}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                picked && "bg-secondary ring-1 ring-primary/45",
              )}
            >
              <Mark multi={question.multiSelect} on={picked} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-sm">
                  {option.label}
                  {option.recommended && <span className="rounded-full bg-add/10 px-1.5 text-xs text-add">Recommended</span>}
                </span>
                {option.description && <span className="text-xs text-muted-foreground">{option.description}</span>}
              </span>
              {i < 9 && <span className="font-mono text-xs text-faint">{i + 1}</span>}
            </button>
          );
        })}
        {/* Your own answer: typing in it picks it (single choice: instead of an option). */}
        <label
          className={cn(
            "flex min-h-11 w-full cursor-text items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent",
            draft.other.trim() && "bg-secondary ring-1 ring-primary/45",
          )}
        >
          <Mark multi={question.multiSelect} on={Boolean(draft.other.trim())} />
          <input
            value={draft.other}
            onChange={(e) => type(e.target.value)}
            placeholder="Other — type your own answer"
            aria-label="Other: type your own answer"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-faint">
          1–{Math.min(question.options.length, 9)} to pick · ↵ {last ? "to send" : "for next"} · Esc to skip
        </span>
        {index > 0 && (
          <button
            type="button"
            onClick={() => setIndex(index - 1)}
            className="h-8 rounded-full bg-secondary px-3.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            Back
          </button>
        )}
        <button
          type="button"
          disabled={sent || !canGoOn || (last && !allAnswered)}
          onClick={next}
          className="h-8 rounded-full bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
        >
          {last ? "Send answers" : "Next"}
        </button>
      </div>
    </div>
  );
}

/** The radio dot or checkbox in front of an option. */
function Mark({ multi, on }: { multi: boolean; on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center ring-1",
        multi ? "rounded-sm" : "rounded-full",
        on ? "bg-primary ring-primary" : "ring-muted-foreground/60", // `border` is too faint on the card
      )}
    >
      {on && (multi ? <Check className="size-3 text-primary-foreground" strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-primary-foreground" />)}
    </span>
  );
}
