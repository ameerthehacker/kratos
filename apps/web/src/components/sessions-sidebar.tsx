import { useState } from "react";
import { Link, NavLink } from "react-router";
import { PanelLeft, Plus } from "lucide-react";
import { SessionStatus, sessionTitle } from "@/components/session-status";
import { useKratos } from "@/lib/kratos-store";
import { cn } from "@/lib/utils";

const iconButton = "flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent";

/** The owner's collapsible sessions sidebar (D41), an island on the canvas: every session with
 * its live status. */
export function SessionsSidebar() {
  const [open, setOpen] = useState(false);
  const sessions = useKratos((s) => s.sessions);
  const toggle = (
    <button type="button" onClick={() => setOpen(!open)} aria-label={open ? "Hide sessions" : "Show sessions"} aria-expanded={open} className={iconButton}>
      <PanelLeft className="size-4.5" />
    </button>
  );

  if (!open) {
    return (
      <aside aria-label="Sessions" className="flex w-16 flex-none flex-col items-center gap-1.5 rounded-3xl bg-background p-2.5">
        {toggle}
        <Link to="/" aria-label="New session" className={iconButton}>
          <Plus className="size-4.5" />
        </Link>
      </aside>
    );
  }

  return (
    <aside aria-label="Sessions" className="flex w-68 flex-none flex-col gap-1 rounded-3xl bg-background p-2.5">
      <div className="flex h-11 items-center gap-2 pl-2.5">
        <span className="flex-1 text-sm font-medium">Sessions</span>
        {toggle}
      </div>
      <Link to="/" className="mt-1 mb-4 flex h-10 items-center gap-2.5 rounded-lg bg-secondary px-2.5 text-sm hover:bg-accent">
        <Plus className="size-4.5" />
        New session
      </Link>
      <nav className="flex flex-col gap-0.5 overflow-y-auto">
        {sessions.map((session) => (
          <NavLink
            key={session.id}
            to={`/s/${session.id}`}
            className={({ isActive }) => cn("flex flex-col gap-0.5 rounded-lg px-2.5 py-2 hover:bg-accent", isActive && "bg-secondary")}
          >
            <span className="truncate text-sm">{sessionTitle(session)}</span>
            <SessionStatus status={session.status} />
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
