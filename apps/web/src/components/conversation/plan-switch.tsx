import { ListTodo } from "lucide-react";
import type { TimelineItem } from "@/lib/timeline";

/**
 * The agent put itself in plan mode (4p6c; the design's Plans board §1, "tell, don't ask"): a line
 * in the chat, not an ask — plan mode can't change your files, so telling is enough. Its reason
 * when it gave one; Skip planning while it's still planning from this switch, which puts the
 * session back in the mode it had and tells the agent to go ahead.
 */
export function PlanSwitch({ item, agent, mode = "plan mode", onSkip }: { item: Extract<TimelineItem, { type: "plan_switch" }>; agent: string; mode?: string; onSkip?: () => void }) {
  return (
    <div role="status" className="flex gap-3 rounded-2xl bg-run/7 px-3.5 py-3 ring-1 ring-run/20">
      <span className="flex size-6.5 flex-none items-center justify-center rounded-full bg-run/15 text-run" aria-hidden="true">
        <ListTodo className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm">
          {agent} switched to <span className="font-medium text-run">{mode}</span>
        </p>
        {item.reason && <p className="text-sm text-secondary-foreground">“{item.reason.trim()}”</p>}
        <p className="text-xs text-muted-foreground">Nothing changes in your files until you approve the plan.</p>
      </div>
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="h-8 flex-none self-center rounded-full px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Skip planning
        </button>
      )}
    </div>
  );
}
