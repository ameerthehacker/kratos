import { Link, Outlet } from "react-router";
import { KratosLogo } from "@/components/kratos-logo";
import { SessionsSidebar } from "@/components/sessions-sidebar";
import { useKratosConnection } from "@/hooks/use-kratos-connection";
import { useKratos } from "@/lib/kratos-store";
import { cn } from "@/lib/utils";

/** Every page, in the owner's island layout: sidebar and main area float as rounded islands on
 * the canvas. Also owns the connection to kratos. */
export function Layout() {
  useKratosConnection();
  const connected = useKratos((s) => s.connected);
  const cwd = useKratos((s) => s.info?.cwd);

  return (
    // Viewport-high: each page scrolls its own content (the conversation pins to the bottom).
    <div className="flex h-screen gap-2.5 bg-canvas p-2.5 text-body antialiased">
      <SessionsSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-background">
        <header className="flex min-h-16 items-center gap-4 px-6 py-3">
          <Link
            to="/"
            aria-label="Kratos home"
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <KratosLogo />
          </Link>
          <span className="flex-1" />
          {cwd && (
            <span className="truncate font-mono text-xs text-muted-foreground" title={cwd}>
              {cwd}
            </span>
          )}
          <span
            className={cn("size-2 shrink-0 rounded-full", connected ? "bg-primary" : "animate-pulse bg-wait")}
            title={connected ? "Connected" : "Connecting…"}
            aria-label={connected ? "Connected" : "Connecting"}
          />
        </header>
        <Outlet />
      </div>
    </div>
  );
}
