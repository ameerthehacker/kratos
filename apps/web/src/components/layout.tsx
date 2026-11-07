import { Link, Outlet } from "react-router";
import { KratosLogo } from "@/components/kratos-logo";
import { ConnectionDot, ProjectMenu } from "@/components/project-menu";
import { QuickSettings } from "@/components/quick-settings";
import { SessionsSidebar, SidebarToggle } from "@/components/sessions-sidebar";
import { VersionPill } from "@/components/version-pill";
import { useAttention } from "@/hooks/use-attention";
import { useKratosConnection } from "@/hooks/use-kratos-connection";
import { useKratos } from "@/lib/kratos-store";
import { useSidebarPrefs } from "@/lib/sidebar-prefs";
import { useTheme } from "@/lib/themes";

/** Under every route: owns the connection to kratos, and what follows it on any page. */
export function Shell() {
  useKratosConnection();
  useAttention(); // tab title, favicon dot and notifications when an agent waits on you (3r3)
  useTheme(); // the theme Kratos has saved (3w1)
  return <Outlet />;
}

/** Home and sessions, in the owner's island layout: sidebar and main area float as rounded
 * islands on the canvas. (Reviewing changes has its own islands, 3v2.) */
export function Layout() {
  const connected = useKratos((s) => s.connected);
  const info = useKratos((s) => s.info);
  const sidebarOpen = useSidebarPrefs((s) => s.open);

  return (
    // Viewport-high: each page scrolls its own content (the conversation pins to the bottom).
    <div className="flex h-screen gap-2.5 bg-canvas p-2.5 text-body antialiased">
      <SessionsSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-background">
        <header className="flex min-h-16 items-center gap-4 px-6 py-3">
          {/* The sidebar is gone when closed; this brings it back (3d4). */}
          {!sidebarOpen && <SidebarToggle className="-ml-3 size-9" />}
          <Link
            to="/"
            aria-label="Kratos home"
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <KratosLogo />
          </Link>
          {/* Close to the wordmark (the design: −8px), before the spacer. */}
          {info && <span className="-ml-2"><VersionPill info={info} /></span>}
          <span className="flex-1" />
          <QuickSettings />
          {/* The connection dot lives in the project chip (3d3), with a tooltip. */}
          {/* Before the first answer from the server there's no project yet: just the dot. */}
          {info ? <ProjectMenu cwd={info.cwd} editors={info.editors} connected={connected} /> : <ConnectionDot connected={connected} />}
        </header>
        <Outlet />
      </div>
    </div>
  );
}
