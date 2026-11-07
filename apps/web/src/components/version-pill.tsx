import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useKratos, type ServerInfo } from "@/lib/kratos-store";

/**
 * Kratos's version, right after the wordmark (3u1, the design's header pill): the bare value — a
 * release ("0.3.1") or the commit it runs from ("ab9151c") — small and muted. When a newer release
 * is out (3u5d) it turns mint with a dot and the new version. Clicking opens the update dialog,
 * which also links to the release notes (or the commit).
 */
export function VersionPill({ info }: { info: Pick<ServerInfo, "serverVersion" | "versionUrl"> }) {
  const update = useKratos((s) => s.update);
  const version = info.serverVersion;
  const available = update && update.state !== "idle" ? update : undefined; // newer: available, downloading or ready
  const look = available ? "bg-primary/15 text-primary hover:bg-primary/25" : "bg-secondary text-muted-foreground hover:bg-accent hover:text-secondary-foreground";
  return (
    <Dialog>
      <DialogTrigger
        aria-label={available ? `Kratos ${available.version} is available` : `Kratos version ${version}`}
        title={available ? `Kratos ${available.version} is available` : `Kratos version ${version}`}
        className={`inline-flex h-5 items-center gap-1.5 rounded-full px-1.75 font-mono text-xs whitespace-nowrap focus-visible:outline-2 focus-visible:outline-ring ${look}`}
      >
        {available && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
        {available ? `${version} → ${available.version}` : version}
      </DialogTrigger>
      <UpdateDialog info={info} />
    </Dialog>
  );
}

function UpdateDialog({ info }: { info: Pick<ServerInfo, "serverVersion" | "versionUrl"> }) {
  const update = useKratos((s) => s.update);
  const sessions = useKratos((s) => s.sessions);
  const send = useKratos((s) => s.send);
  const connected = useKratos((s) => s.connected);
  const [checking, setChecking] = useState(false);
  useEffect(() => setChecking(false), [update]); // the server answers every check with `update`
  const version = info.serverVersion;
  const release = /^\d+\.\d+\.\d+/.test(version);
  const available = update && update.state !== "idle" ? update : undefined; // newer: available, downloading or ready
  const working = sessions.filter((s) => s.status !== "idle").length;

  const notes = (url: string | undefined, label: string) =>
    url && (
      <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost" })}>
        {label}
        <ExternalLink />
      </a>
    );

  if (!release) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Running from source</DialogTitle>
          <DialogDescription>
            This Kratos runs from a checkout (<span className="font-mono">{version}</span>), so it doesn't update itself.
            Updates come with releases.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>{notes(info.versionUrl, "View commit")}</DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{available ? `Kratos ${available.version} is available` : `Kratos ${version} is up to date`}</DialogTitle>
        <DialogDescription>
          {available && <>You're on {version} · </>}
          {update?.checkedAt ? `checked ${ago(update.checkedAt)}` : "not checked yet"}
          {available?.state === "downloading" && <> · downloading…</>}
          {available?.state === "ready" && <> · downloaded and verified</>}
        </DialogDescription>
        {available?.error && (
          <p className="text-sm text-destructive">Download failed: {available.error}. Kratos tries again at the next check.</p>
        )}
      </DialogHeader>
      {available && (
        // Applying lands with 3u5c; until then the button explains what it will do.
        <p className="text-sm text-muted-foreground">
          Kratos restarts by itself once every agent is done
          {working > 0 ? ` (${working} ${working === 1 ? "session" : "sessions"} working now)` : ""}. Your sessions are
          kept and carry on after the restart.
        </p>
      )}
      <DialogFooter>
        {notes(available?.url ?? info.versionUrl, available ? "Release notes" : "View release")}
        <Button
          variant={available ? "ghost" : "secondary"}
          disabled={checking || !connected}
          onClick={() => {
            setChecking(true);
            send({ type: "check_update" });
          }}
        >
          <RefreshCw className={checking ? "animate-spin" : ""} />
          {checking ? "Checking…" : "Check again"}
        </Button>
        {available && (
          <Button disabled title="Arrives with the next step (3u5c)">
            Update & restart
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

/** "just now", "4 minutes ago", "2 hours ago" — in the browser's language. */
function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return minutes < 60 ? format.format(-minutes, "minute") : format.format(-Math.round(minutes / 60), "hour");
}
