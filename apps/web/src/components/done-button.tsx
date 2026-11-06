import { Check, RotateCcw } from "lucide-react";
import type { SessionSummary } from "@kratos/core";
import { useKratos } from "@/lib/kratos-store";
import { cn } from "@/lib/utils";

/**
 * Mark a session done, or reopen it (3d2). `icon`: a small round button for list rows (shown on
 * hover/focus by the row); `full`: a labelled pill for the session header.
 */
export function DoneButton({ session, variant, className }: { session: SessionSummary; variant: "icon" | "full"; className?: string }) {
  const send = useKratos((s) => s.send);
  const label = session.done ? "Reopen" : "Mark as done";
  const Icon = session.done ? RotateCcw : Check;
  const toggle = (event: React.MouseEvent) => {
    event.preventDefault(); // rows sit inside links' hover areas: don't navigate
    event.stopPropagation();
    send({ type: "set_done", id: session.id, done: !session.done });
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={`${label}: ${session.title ?? "New session"}`}
        title={label}
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
          className,
        )}
      >
        <Icon className="size-3.5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-sm text-secondary-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
