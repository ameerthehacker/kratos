import { useState } from "react";
import { Link } from "react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { ChevronRight, Hand, MessageSquare } from "lucide-react";
import type { Harness, SessionSummary } from "@kratos/core";
import { modelLabel } from "@/components/agent-picker";
import { sessionTitle } from "@/components/session-status";
import { cn } from "@/lib/utils";

const FIRST = 8;

/**
 * Home's Recent list (3d1): each session as a row — a status tile, its title, and a quiet line
 * with the model and when it was last active. The 8 newest, then "Show all".
 */
export function RecentList({ sessions, harnesses }: { sessions: SessionSummary[]; harnesses: Harness[] }) {
  const [all, setAll] = useState(false);
  if (sessions.length === 0) return null;
  const shown = all ? sessions : sessions.slice(0, FIRST);

  return (
    <section aria-labelledby="recent" className="flex flex-col gap-2">
      <h2 id="recent" className="flex items-baseline gap-2 px-3 text-sm font-medium text-muted-foreground">
        Recent <span className="font-mono text-xs text-faint">{sessions.length}</span>
      </h2>
      <ul className="flex flex-col gap-0.5">
        {shown.map((session) => (
          <li key={session.id}>
            <RecentRow session={session} harnesses={harnesses} />
          </li>
        ))}
      </ul>
      {sessions.length > FIRST && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="self-start rounded-full px-3 py-1 text-sm text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {all ? "Show fewer" : `Show all ${sessions.length}`}
        </button>
      )}
    </section>
  );
}

function RecentRow({ session, harnesses }: { session: SessionSummary; harnesses: Harness[] }) {
  const models = harnesses.find((h) => h.id === session.harness)?.models ?? [];
  const when = formatDistanceToNowStrict(session.updatedAt, { addSuffix: true });
  return (
    <Link
      to={`/s/${session.id}`}
      className="group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-ring"
    >
      <StatusTile status={session.status} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{sessionTitle(session)}</span>
        <span className="truncate text-xs text-muted-foreground">
          {session.status === "needs_approval" && <span className="text-wait">Needs your OK · </span>}
          {session.status === "working" && <span className="text-run">Working · </span>}
          {modelLabel(models, session.model)} · {when}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
    </Link>
  );
}

/** The row's leading tile: what the session is doing right now. */
function StatusTile({ status }: { status: SessionSummary["status"] }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-xl",
        status === "needs_approval" ? "bg-wait/10 text-wait" : "bg-secondary text-muted-foreground",
      )}
    >
      {status === "needs_approval" && <Hand className="size-3.5" />}
      {status === "working" && <span className="size-2 animate-pulse rounded-full bg-run" />}
      {status === "idle" && <MessageSquare className="size-3.5" />}
    </span>
  );
}
