import { Link, NavLink } from "react-router";
import { ChevronRight, PanelLeft, Plus } from "lucide-react";
import type { SessionSummary } from "@kratos/core";
import { DoneButton } from "@/components/done-button";
import { SessionStatus, sessionTitle } from "@/components/session-status";
import { useKratos } from "@/lib/kratos-store";
import { useSidebarPrefs } from "@/lib/sidebar-prefs";
import { cn } from "@/lib/utils";

/** Shows or hides the sidebar: in its own header when open, in the main header when closed (3d4). */
export function SidebarToggle({ className }: { className?: string }) {
  const open = useSidebarPrefs((s) => s.open);
  const setOpen = useSidebarPrefs((s) => s.setOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label={open ? "Hide sessions" : "Show sessions"}
      aria-expanded={open}
      className={cn("flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground", className)}
    >
      <PanelLeft className="size-4.5" />
    </button>
  );
}

/** The owner's collapsible sessions sidebar (D41), an island on the canvas: every session with
 * its live status. Closed, it's gone entirely, like the design (3d4). */
export function SessionsSidebar() {
  const open = useSidebarPrefs((s) => s.open);
  const sessions = useKratos((s) => s.sessions);
  if (!open) return null;

  return (
    <aside aria-label="Sessions" className="flex w-68 flex-none flex-col gap-1 rounded-3xl bg-background p-2.5">
      <div className="flex h-11 items-center gap-2 pl-2.5">
        <span className="flex-1 text-sm font-medium">Sessions</span>
        <SidebarToggle />
      </div>
      <Link to="/" className="mt-1 mb-4 flex h-10 items-center gap-2.5 rounded-lg bg-secondary px-2.5 text-sm hover:bg-accent">
        <Plus className="size-4.5" />
        New session
      </Link>
      {/* Two sections (owner, 3d2): what's being worked on, and what's done. Done is pinned to
          the bottom — it needs the least attention (owner, 3d8); each scrolls on its own, Done
          taking at most half the height. */}
      <nav className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SessionSection label="Working" sessions={sessions.filter((s) => !s.done)} />
        </div>
        <div className="max-h-1/2 shrink-0 overflow-y-auto">
          <SessionSection label="Done" sessions={sessions.filter((s) => s.done)} />
        </div>
      </nav>
    </aside>
  );
}

function SessionSection({ label, sessions }: { label: string; sessions: SessionSummary[] }) {
  const collapsed = useSidebarPrefs((s) => s.collapsed[label] ?? false);
  const toggle = useSidebarPrefs((s) => s.toggle);
  if (sessions.length === 0) return null;
  return (
    <section aria-label={label} className="flex flex-col gap-0.5">
      <h2>
        <button
          type="button"
          onClick={() => toggle(label)}
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")} aria-hidden="true" />
          {label}
          <span className="font-mono text-faint">{sessions.length}</span>
        </button>
      </h2>
      {!collapsed && sessions.map((session) => (
        // The done button sits beside the link, not inside it (a button can't live in a link).
        <div key={session.id} className="group relative">
          <NavLink
            to={`/s/${session.id}`}
            className={({ isActive }) => cn("flex flex-col gap-0.5 rounded-lg py-2 pr-10 pl-2.5 hover:bg-accent", isActive && "bg-secondary")}
          >
            <span className={cn("truncate text-sm", session.done && "text-muted-foreground")}>{sessionTitle(session)}</span>
            {!session.done && <SessionStatus status={session.status} queued={session.queued} />}
          </NavLink>
          <DoneButton
            session={session}
            variant="icon"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          />
        </div>
      ))}
    </section>
  );
}
