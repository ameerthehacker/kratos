import { Ellipsis, Eye, Globe, GitFork, Hand, Pencil, Search, SquareTerminal, Wrench, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { PermissionDecision } from "@kratos/core";
import { Command } from "@/components/conversation/command";
import type { Chip, OpenAsk, Step } from "@/lib/timeline";
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
};

/** Answer a permission ask (the hub routes it to the session that asked; first answer wins). */
export type Decide = (askId: string, decision: PermissionDecision) => void;

/** A run of consecutive agent steps: "Claude Code · 4 steps", a line, and the raw toggle. */
export function StepGroup(props: { agent: string; steps: Step[]; raw: boolean; onToggleRaw: () => void; onDecide: Decide }) {
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
        <StepRow key={step.id} step={step} raw={props.raw} agent={props.agent} onDecide={props.onDecide} />
      ))}
    </section>
  );
}

function StepRow({ step, raw, agent, onDecide }: { step: Step; raw: boolean; agent: string; onDecide: Decide }) {
  const { icon: Icon, tint } = LOOK[step.kind];
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className={cn("flex size-6.5 shrink-0 items-center justify-center rounded-full", step.ask ? "bg-wait/10 text-wait" : cn("bg-secondary", tint))}
      >
        {step.ask ? <Hand className="size-3.5" /> : <Icon className="size-3.5" strokeWidth={2.2} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        {step.ask ? (
          <AskCard step={step} ask={step.ask} agent={agent} onDecide={onDecide} />
        ) : (
          <>
            <div className="text-sm leading-snug">{step.title}</div>
            {step.chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {step.chips.map((chip, i) => (
                  <span key={i} className={cn("inline-flex h-5 items-center rounded-full bg-secondary px-2 text-xs", CHIP[chip.tone])}>
                    {chip.text}
                  </span>
                ))}
              </div>
            )}
            {raw && <RawBlock step={step} />}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The design's amber "needs a call" card: what the agent wants to do, the exact command or call
 * (always shown — you approve what will actually run), and Allow / Deny.
 */
function AskCard({ step, ask, agent, onDecide }: { step: Step; ask: OpenAsk; agent: string; onDecide: Decide }) {
  const [sent, setSent] = useState(false); // until the server confirms; the card then becomes a step
  const decide = (decision: PermissionDecision) => {
    setSent(true);
    onDecide(ask.id, decision);
  };
  return (
    <div role="group" aria-label={`${agent} needs your OK`} className="flex flex-col gap-3 rounded-2xl bg-wait/10 px-5 py-4">
      <div className="flex items-center gap-2 text-sm font-medium text-wait">
        <span className="size-1.75 rotate-45 bg-wait" aria-hidden="true" />
        {agent} needs your OK
      </div>
      <div className="text-base">{step.intent}</div>
      {ask.reason && <div className="text-sm text-muted-foreground">{ask.reason}</div>}
      <RawBlock step={step} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={sent}
          onClick={() => decide({ decision: "allow" })}
          className="h-10 rounded-full bg-foreground px-4.5 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Allow
        </button>
        <button
          type="button"
          disabled={sent}
          onClick={() => decide({ decision: "deny", message: "The owner denied this in Kratos." })}
          className="h-10 rounded-full bg-card px-4 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

/** The raw command (Shiki) or tool call, and its output when there is one. */
function RawBlock({ step }: { step: Step }) {
  const rawLines = step.raw.command ?? step.raw.call;
  if (!rawLines) return null;
  return (
    <div
      role="group"
      aria-label={`Raw: ${rawLines}`}
      className="flex max-h-80 flex-col gap-1 overflow-auto rounded-lg bg-well px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre"
    >
      <div>{step.raw.command ? <Command text={step.raw.command} /> : <span className="text-secondary-foreground">{rawLines}</span>}</div>
      {step.raw.output && <div className="text-muted-foreground">{step.raw.output}</div>}
    </div>
  );
}
