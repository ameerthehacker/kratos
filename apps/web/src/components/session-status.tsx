import type { SessionSummary } from "@kratos/core";
import { cn } from "@/lib/utils";

const LABEL: Record<SessionSummary["status"], string> = {
  needs_approval: "Needs approval",
  needs_answer: "Needs your answer", // the agent asked you questions (D54)
  working: "Working",
  idle: "Idle",
};

/** A session's live status: colored dot + label (owner's design, D41). */
/** `queued`: prompts waiting for the agent (D56) — "Working · 2 queued", plain: they wait on the
 * agent, not on you (the design). */
export function SessionStatus({ status, queued = 0 }: { status: SessionSummary["status"]; queued?: number }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs",
        status === "needs_approval" || status === "needs_answer" ? "text-wait" : "text-muted-foreground",
      )}
    >
      <StatusDot status={status} />
      {LABEL[status]}
      {queued > 0 && ` · ${queued} queued`}
    </span>
  );
}

/** Just the dot: where a label doesn't fit, e.g. a closed folder's row (D73). */
export function StatusDot({ status, className }: { status: SessionSummary["status"]; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        (status === "needs_approval" || status === "needs_answer") && "bg-wait",
        status === "working" && "size-1.5 animate-pulse bg-run",
        status === "idle" && "bg-input",
        className,
      )}
    />
  );
}

export const statusLabel = (status: SessionSummary["status"]) => LABEL[status];

export const sessionTitle = (session: SessionSummary) => session.title ?? "New session";
