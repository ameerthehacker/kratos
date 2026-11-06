import type { SessionSummary } from "@kratos/core";
import { cn } from "@/lib/utils";

const LABEL: Record<SessionSummary["status"], string> = {
  needs_approval: "Needs approval",
  working: "Working",
  idle: "Idle",
};

/** A session's live status: colored dot + label (owner's design, D41). */
export function SessionStatus({ status }: { status: SessionSummary["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs",
        status === "needs_approval" ? "text-wait" : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          status === "needs_approval" && "bg-wait",
          status === "working" && "size-1.5 animate-pulse bg-run",
          status === "idle" && "bg-input",
        )}
      />
      {LABEL[status]}
    </span>
  );
}

export const sessionTitle = (session: SessionSummary) => session.title ?? "New session";
