import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import type { FeatureSummary } from "@kratos/core";
import { StopAndDoneDialog, isBusy } from "@/components/stop-and-done-dialog";
import { useKratos } from "@/lib/kratos-store";
import { cn } from "@/lib/utils";

/** Mark a feature done, or reopen it (D73): a folder row's hover button, like a session's, or with
 * `labelled`, a pill that says it (4p4a: the plan page, once every step is ticked). While any of
 * its sessions is busy it asks first: done means stopping them (4c5). */
export function FeatureDoneButton({ feature, labelled, className }: { feature: FeatureSummary; labelled?: boolean; className?: string }) {
  const send = useKratos((s) => s.send);
  const busy = useKratos((s) => s.sessions.filter((x) => x.featureId === feature.id && isBusy(x)).length);
  // How many were busy when you asked: the dialog says that, not a count that runs down while
  // it's open (to "0 still working"). Sessions that finish meanwhile just have nothing to stop.
  const [confirming, setConfirming] = useState<number | null>(null);
  const label = feature.done ? "Reopen feature" : "Mark feature done";
  const Icon = feature.done ? RotateCcw : Check;
  const markDone = (stop: boolean) => send({ type: "set_feature_done", id: feature.id, done: true, ...(stop ? { stop: true } : {}) });
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation(); // inside the folder's row: don't open or close it
          if (feature.done) send({ type: "set_feature_done", id: feature.id, done: false });
          else if (busy > 0) setConfirming(busy);
          else markDone(false);
        }}
        aria-label={`${label}: ${feature.title}`}
        title={label}
        tabIndex={labelled ? undefined : -1} // the row's buttons are out of the Tab order (4b)
        className={cn(
          "flex items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring",
          labelled
            ? "h-8 gap-1.5 bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            : "size-7 text-muted-foreground hover:bg-secondary hover:text-foreground",
          className,
        )}
      >
        <Icon className="size-3.5" />
        {labelled && label}
      </button>
      <StopAndDoneDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        what="feature"
        busy={confirming ?? busy}
        onConfirm={() => markDone(true)}
      />
    </>
  );
}
