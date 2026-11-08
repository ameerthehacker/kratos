import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SessionSummary } from "@kratos/core";
import { StopAndDoneDialog, isBusy } from "@/components/stop-and-done-dialog";
import { useKratos } from "@/lib/kratos-store";
import { cn } from "@/lib/utils";

/**
 * Mark a session done, or reopen it (3d2). `icon`: a small round button for list rows (shown on
 * hover/focus by the row); `header` (3d7, owner): a quiet check icon with a tooltip while the
 * session is open, and a green "✓ Done" chip once it's done ("↺ Reopen" on hover), which reopens it.
 * Marking the session you're looking at done takes you Home: it's off your plate (owner). While its
 * agent is busy it asks first: done means stopping it (4c5).
 */
/** `tabIndex`: -1 inside a tree, where ↑/↓ move between rows and Tab shouldn't stop at each. */
export function DoneButton({ session, variant, className, tabIndex }: { session: SessionSummary; variant: "icon" | "header"; className?: string; tabIndex?: number }) {
  const send = useKratos((s) => s.send);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const label = session.done ? "Reopen" : "Mark as done";
  const Icon = session.done ? RotateCcw : Check;
  const [confirming, setConfirming] = useState(false);
  const markDone = (stop: boolean) => {
    send({ type: "set_done", id: session.id, done: true, ...(stop ? { stop: true } : {}) });
    if (pathname === `/s/${session.id}`) navigate("/");
  };
  const toggle = (event: React.MouseEvent) => {
    event.preventDefault(); // rows sit inside links' hover areas: don't navigate
    event.stopPropagation();
    if (session.done) send({ type: "set_done", id: session.id, done: false });
    else if (isBusy(session)) setConfirming(true);
    else markDone(false);
  };
  const dialog = <StopAndDoneDialog open={confirming} onOpenChange={setConfirming} what="session" busy={1} onConfirm={() => markDone(true)} />;

  if (variant === "icon") {
    return (
      <>
        <button
          type="button"
          onClick={toggle}
          aria-label={`${label}: ${session.title ?? "New session"}`}
          title={label}
          tabIndex={tabIndex}
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            className,
          )}
        >
          <Icon className="size-3.5" />
        </button>
        {dialog}
      </>
    );
  }
  if (session.done) {
    // Says the state ("✓ Done", green) at rest and the action ("↺ Reopen", red: it undoes it;
    // owner) on hover/focus: the chip is the header's only sign that the session is done, so it
    // can't just say "Reopen".
    // Both labels share one grid cell, so the chip keeps the wider one's width: no jump on hover.
    const slot = "col-start-1 row-start-1 inline-flex items-center gap-1.5";
    const atRest = "group-hover:invisible group-focus-visible:invisible";
    const onHover = "invisible group-hover:visible group-focus-visible:visible";
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="Done. Reopen this session"
        className={cn(
          "group grid h-7 items-center rounded-full bg-add/15 px-2.5 text-xs font-medium text-add hover:bg-destructive/15 hover:text-destructive focus-visible:bg-destructive/15 focus-visible:text-destructive focus-visible:outline-2 focus-visible:outline-ring",
          className,
        )}
      >
        <span className={cn(slot, atRest)}>
          <Check className="size-3.5" strokeWidth={2.5} />
          Done
        </span>
        <span className={cn(slot, "justify-center", onHover)}>
          <RotateCcw className="size-3.5" />
          Reopen
        </span>
      </button>
    );
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          onClick={toggle}
          aria-label="Mark as done"
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-add/15 hover:text-add focus-visible:outline-2 focus-visible:outline-ring",
            className,
          )}
        >
          <Check className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="bottom">Mark as done</TooltipContent>
      </Tooltip>
      {dialog}
    </>
  );
}
