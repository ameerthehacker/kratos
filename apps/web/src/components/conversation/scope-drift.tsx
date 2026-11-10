import { CircleAlert } from "lucide-react";
import { Link } from "react-router";
import type { TimelineItem } from "@/lib/timeline";

/** How many paths it lists before "and N more". */
const SHOWN = 5;

/**
 * A turn changed files outside its step's Scope (4p7a; the design's Plans board §3): a notice
 * under the turn, the paths, and Show diff (the review page). The first piece of the scope fence.
 */
export function ScopeDrift({ item, reviewHref }: { item: Extract<TimelineItem, { type: "scope_drift" }>; reviewHref?: string }) {
  const count = item.paths.length;
  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl bg-wait/7 px-3.5 py-3 ring-1 ring-wait/25">
      <span className="flex size-6.5 flex-none items-center justify-center rounded-full bg-wait/15 text-wait" aria-hidden="true">
        <CircleAlert className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm">
          {count} {count === 1 ? "file" : "files"} changed outside {item.stepId}'s scope
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
      {reviewHref && (
        <Link
          to={reviewHref}
          className="h-8 flex-none self-center rounded-full px-3 text-sm leading-8 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Show diff
        </Link>
      )}
    </div>
  );
}
