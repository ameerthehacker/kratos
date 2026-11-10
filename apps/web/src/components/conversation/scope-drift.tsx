import { useState } from "react";
import { Check, CircleAlert } from "lucide-react";
import { Link } from "react-router";
import { scopeMatcher } from "@kratos/core";
import { usePlan } from "@/hooks/use-plan";
import { useKratos } from "@/lib/kratos-store";
import type { TimelineItem } from "@/lib/timeline";

/** How many paths it lists before "and N more". */
const SHOWN = 5;
/** The most paths one Add to scope takes (core's `add_scope`). */
const MAX_SCOPE_PATHS = 100;

/**
 * A turn changed files outside its step's Scope (4p7a; the design's Plans board §3): a notice
 * under the turn, the paths, Show diff (the review page) and Add to scope (4p7b), which puts them
 * in the step's Scope line. Added is read from the plan, so it holds after a reload. The first
 * piece of the scope fence.
 */
export function ScopeDrift({ item, reviewHref }: { item: Extract<TimelineItem, { type: "scope_drift" }>; reviewHref?: string }) {
  const count = item.paths.length;
  const send = useKratos((s) => s.send);
  const plan = usePlan(item.owner.kind, item.owner.id)?.plan;
  const step = plan?.steps.find((s) => s.id === item.stepId);
  // In its Scope now — added, or a glob widened over them — by the hub's own rule (core).
  const added = step !== undefined && item.paths.every(scopeMatcher(step.scope));
  // Sent, until the plan says so — or the server refuses a plan change (the step was renamed meanwhile).
  const [sent, setSent] = useState<number | null>(null);
  const lastError = useKratos((s) => s.lastError);
  const busy = sent !== null && !added && !(lastError?.about === "plan_action" && lastError.at > sent);
  // More than a plan action takes (core's add_scope): too many to add by hand from here anyway.
  const addable = item.paths.length <= MAX_SCOPE_PATHS;
  const add = () => {
    setSent(performance.now());
    send({ type: "plan_action", owner: item.owner, action: { kind: "add_scope", stepId: item.stepId, paths: item.paths } });
  };
  return (
    <div
      role="status"
      className={
        added
          ? "flex items-start gap-3 rounded-2xl bg-secondary/60 px-3.5 py-3 ring-1 ring-border"
          : "flex items-start gap-3 rounded-2xl bg-wait/7 px-3.5 py-3 ring-1 ring-wait/25"
      }
    >
      <span
        className={
          added
            ? "flex size-6.5 flex-none items-center justify-center rounded-full bg-add/15 text-add"
            : "flex size-6.5 flex-none items-center justify-center rounded-full bg-wait/15 text-wait"
        }
        aria-hidden="true"
      >
        {added ? <Check className="size-3.5" /> : <CircleAlert className="size-3.5" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm">
          {count} {count === 1 ? "file" : "files"} changed outside {item.stepId}'s scope
          {added && <span className="text-muted-foreground"> · added to its scope</span>}
        </p>
        <ul className="flex flex-col font-mono text-xs text-muted-foreground">
          {item.paths.slice(0, SHOWN).map((path) => (
            <li key={path} className="truncate">
              {path}
            </li>
          ))}
          {count > SHOWN && <li className="text-faint">and {count - SHOWN} more</li>}
        </ul>
      </div>
      <div className="flex flex-none items-center gap-1 self-center">
        {reviewHref && (
          <Link
            to={reviewHref}
            className="h-8 rounded-full px-3 text-sm leading-8 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            Show diff
          </Link>
        )}
        {step && !added && addable && (
          <button
            type="button"
            disabled={busy}
            onClick={add}
            title={`Put ${count === 1 ? "it" : "them"} in ${item.stepId}'s Scope line`}
            className="h-8 rounded-full bg-secondary px-3 text-sm text-secondary-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          >
            Add to scope
          </button>
        )}
      </div>
    </div>
  );
}
