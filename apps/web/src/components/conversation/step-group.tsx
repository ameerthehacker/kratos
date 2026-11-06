import { Ellipsis, Eye, Globe, GitFork, Hand, Pencil, Search, SquareTerminal, Wrench, type LucideIcon } from "lucide-react";
import { Command } from "@/components/conversation/command";
import type { Chip, Step } from "@/lib/timeline";
import { cn } from "@/lib/utils";

/** Icon and tint per kind of step (the chat design: read grey, edit blue, run violet…). */
const LOOK: Record<Step["kind"], { icon: LucideIcon; tint: string }> = {
  read: { icon: Eye, tint: "text-muted-foreground" },
  edit: { icon: Pencil, tint: "text-run" },
  run: { icon: SquareTerminal, tint: "text-vio" },
  search: { icon: Search, tint: "text-muted-foreground" },
  web: { icon: Globe, tint: "text-run" },
  task: { icon: GitFork, tint: "text-primary" },
  think: { icon: Ellipsis, tint: "text-faint" },
  other: { icon: Wrench, tint: "text-muted-foreground" },
};

const CHIP: Record<Chip["tone"], string> = {
  path: "font-mono text-secondary-foreground",
  muted: "font-mono text-muted-foreground",
  ok: "text-add",
  bad: "text-destructive",
  wait: "bg-wait/10 text-wait",
};

/** A run of consecutive agent steps: "Claude Code · 4 steps", a line, and the raw toggle. */
export function StepGroup(props: { agent: string; steps: Step[]; raw: boolean; onToggleRaw: () => void }) {
  const count = props.steps.length;
  return (
    <section aria-label={`${props.agent}: ${count} steps`} className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {props.agent} · {count} {count === 1 ? "step" : "steps"}
        </span>
        <span className="h-px flex-1 bg-border" />
        <button
          type="button"
          onClick={props.onToggleRaw}
          aria-pressed={props.raw}
          className="h-6.5 rounded-full bg-secondary px-2.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {props.raw ? "Hide raw" : "Show raw"}
        </button>
      </div>
      {props.steps.map((step) => (
        <StepRow key={step.id} step={step} raw={props.raw} />
      ))}
    </section>
  );
}

function StepRow({ step, raw }: { step: Step; raw: boolean }) {
  const { icon: Icon, tint } = LOOK[step.kind];
  const chips: Chip[] = step.waiting ? [...step.chips, { text: "Waiting for you", tone: "wait" }] : step.chips;
  const rawLines = step.raw.command ?? step.raw.call;
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className={cn("flex size-6.5 shrink-0 items-center justify-center rounded-full", step.waiting ? "bg-wait/10 text-wait" : cn("bg-secondary", tint))}
      >
        {step.waiting ? <Hand className="size-3.5" /> : <Icon className="size-3.5" strokeWidth={2.2} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        <div className="text-sm leading-snug">{step.title}</div>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((chip, i) => (
              <span key={i} className={cn("inline-flex h-5 items-center rounded-full bg-secondary px-2 text-xs", CHIP[chip.tone])}>
                {chip.text}
              </span>
            ))}
          </div>
        )}
        {raw && rawLines && (
          <div
            role="group"
            aria-label={`Raw: ${rawLines}`}
            className="flex max-h-80 flex-col gap-1 overflow-auto rounded-lg bg-well px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre"
          >
            <div>{step.raw.command ? <Command text={step.raw.command} /> : <span className="text-secondary-foreground">{rawLines}</span>}</div>
            {step.raw.output && <div className="text-muted-foreground">{step.raw.output}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
