import { CircleStop } from "lucide-react";
import type { SessionSummary } from "@kratos/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Its agent is mid-turn, waiting on you, or has prompts queued: marking it done stops it (4c5). */
export const isBusy = (session: SessionSummary) => session.status !== "idle" || session.queued > 0;

/**
 * Asked before marking a session or a feature done while an agent in it is still busy (4c5):
 * Kratos stops the agent — its turn, any question it asked, its queue — then marks it done.
 * `busy`: how many sessions that stops (a feature can have several). Confirming sends `stop: true`,
 * the consent the server requires.
 */
export function StopAndDoneDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; what: "session" | "feature"; busy: number; onConfirm: () => void }) {
  const { what, busy } = props;
  const sessions = busy === 1 ? "1 of its sessions is" : `${busy} of its sessions are`;
  return (
    // Its buttons sit in rows that open a session or a folder on click: React passes a click in
    // the dialog up to them (portals bubble by component, not by page), so it ends here.
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-wait/15 text-wait">
              <CircleStop />
            </AlertDialogMedia>
            <AlertDialogTitle>Stop and mark done?</AlertDialogTitle>
            <AlertDialogDescription>
              {what === "session"
                ? "The agent is still working on this session. Kratos will stop it, dropping anything queued, then mark the session done."
                : `${sessions} still working. Kratos will stop ${busy === 1 ? "it" : "them"}, dropping anything queued, then mark the feature and its sessions done.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                props.onConfirm();
                props.onOpenChange(false);
              }}
            >
              Stop and mark done
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
