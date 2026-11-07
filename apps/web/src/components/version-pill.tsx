import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { UpdateStatus } from "@kratos/core";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { useKratos, type ServerInfo } from "@/lib/kratos-store";
import { cn } from "@/lib/utils";

type Info = Pick<ServerInfo, "serverVersion" | "versionUrl">;

/**
 * Kratos's version, right after the wordmark (3u1, the design's header pill): the bare value — a
 * release ("0.3.1") or the commit it runs from ("ab9151c") — small and muted. When a newer release
 * is out (3u5d) it turns mint with a dot and the new version. Clicking drops the update popover
 * (3u5e): where the update stands, its release notes, and the one thing to do next.
 */
export function VersionPill({ info }: { info: Info }) {
  const update = useKratos((s) => s.update);
  const version = info.serverVersion;
  const newer = update && update.state !== "idle" ? update : undefined;
  const panel = useRef<HTMLDivElement>(null);
  const look = newer ? "bg-primary/15 text-primary hover:bg-primary/25" : "bg-secondary text-muted-foreground hover:bg-accent hover:text-secondary-foreground";
  return (
    <Popover>
      <PopoverTrigger
        aria-label={newer ? `Kratos ${newer.version} is available` : `Kratos version ${version}`}
        title={newer ? `Kratos ${newer.version} is available` : `Kratos version ${version}`}
        className={cn("inline-flex h-5 items-center gap-1.5 rounded-full px-1.75 font-mono text-xs whitespace-nowrap focus-visible:outline-2 focus-visible:outline-ring", look)}
      >
        {newer && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
        {newer ? `${version} → ${newer.version}` : version}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} initialFocus={panel} className="w-80 rounded-2xl bg-card p-4 ring-border shadow-xl">
        {/* Focus lands on the panel, not its first link (which would show highlighted on open). */}
        <div ref={panel} tabIndex={-1} className="flex flex-col gap-3 outline-none">
          {/^\d+\.\d+\.\d+/.test(version) ? <UpdatePanel version={version} info={info} /> : <SourcePanel version={version} info={info} />}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Title + one muted line, the popover's head in every state. */
function Head({ title, line, action }: { title: string; line?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {line && <p className="text-xs text-muted-foreground">{line}</p>}
      </div>
      {action}
    </div>
  );
}

/** A source run never updates itself: say so, and link the commit. */
function SourcePanel({ version, info }: { version: string; info: Info }) {
  return (
    <>
      <Head title="Running from source" line={<>A checkout at <span className="font-mono">{version}</span> — it doesn't update itself.</>} />
      <Footer notes={info.versionUrl && <Notes url={info.versionUrl} label="View commit" />} />
    </>
  );
}

/** Where the update stands (3u5e): title + check again; one state line, a progress bar, or the
 * error; release notes on the left, the one main action on the right. */
function UpdatePanel({ version, info }: { version: string; info: Info }) {
  const update = useKratos((s) => s.update);
  const busy = useKratos((s) => s.sessions.filter((session) => session.status !== "idle").length);
  const send = useKratos((s) => s.send);
  const connected = useKratos((s) => s.connected);
  const [checking, setChecking] = useState(false);
  useEffect(() => setChecking(false), [update]); // the server answers every check with `update`

  const status: UpdateStatus = update ?? { state: "idle" };
  const next = status.version ?? version;
  const title = {
    idle: `Kratos ${version} is up to date`,
    available: `Kratos ${next} is available`,
    downloading: `Kratos ${next} is available`,
    ready: `Kratos ${next} is ready`,
    waiting: `Updating to ${next}`,
    applying: `Updating to ${next}`,
  }[status.state];
  const checked = status.checkedAt ? `checked ${ago(status.checkedAt)}` : "not checked yet";

  return (
    <>
      <Head
        title={title}
        line={status.state === "idle" ? `You're on the latest · ${checked}` : `You're on ${version}`}
        action={
          status.state !== "applying" && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Check for updates"
              title={`Check for updates (${checked})`}
              disabled={checking || !connected}
              className="text-muted-foreground"
              onClick={() => {
                setChecking(true);
                send({ type: "check_update" });
              }}
            >
              <RefreshCw className={cn(checking && "animate-spin")} />
            </Button>
          )
        }
      />
      {status.error ? (
        <p className="text-xs text-destructive">
          {status.state === "ready" ? `Couldn't install: ${status.error}` : `Download failed: ${status.error}. Retrying at the next check.`}
        </p>
      ) : (
        <State status={status} busy={busy} />
      )}
      <Footer
        notes={<Notes url={status.url ?? info.versionUrl} label="Release notes" />}
        action={
          status.state === "ready" ? (
            <Button size="sm" disabled={!connected} onClick={() => send({ type: "apply_update" })}>
              {status.error ? "Try again" : "Update & restart"}
            </Button>
          ) : status.state === "waiting" ? (
            <Button size="sm" variant="secondary" disabled={!connected} onClick={() => send({ type: "cancel_update" })}>
              Cancel
            </Button>
          ) : undefined
        }
      />
    </>
  );
}

/** Release notes on the left, the main action on the right — a row, so nothing stretches. */
function Footer({ notes, action }: { notes?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      {notes || <span />}
      {action}
    </div>
  );
}

/** The middle of the popover: a line, or a bar while bytes are moving. */
function State({ status, busy }: { status: UpdateStatus; busy: number }) {
  const line = (text: string) => <p className="text-xs text-muted-foreground">{text}</p>;
  const { received = 0, total } = status.progress ?? {};
  const percent = total ? Math.min(100, Math.round((received / total) * 100)) : null;
  switch (status.state) {
    case "idle":
      return null;
    case "available":
      return line("Starting the download…");
    case "downloading":
      return (
        <div className="flex flex-col gap-1.5">
          <Progress value={percent} aria-label="Download progress" />
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{total ? `${megabytes(received)} of ${megabytes(total)}` : `${megabytes(received)} so far`}</span>
            {percent !== null && <span>{percent}%</span>}
          </div>
        </div>
      );
    case "ready":
      return line(`Downloaded and verified${total ? ` (${megabytes(total)})` : ""}. Kratos restarts when your agents are idle; sessions carry on.`);
    case "waiting":
      return line(busy > 0 ? `Waiting for ${busy} ${busy === 1 ? "session" : "sessions"} to finish, then Kratos restarts.` : "Restarting in a moment…");
    case "applying":
      return (
        <div className="flex flex-col gap-1.5">
          <div className="h-1 w-full animate-pulse rounded-full bg-primary" />
          {line("Installing and restarting — back in a few seconds.")}
        </div>
      );
  }
}

function Notes({ url, label }: { url?: string; label: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 text-muted-foreground")}>
      {label}
      <ExternalLink />
    </a>
  );
}

const MB = new Intl.NumberFormat(undefined, { style: "unit", unit: "megabyte", maximumFractionDigits: 0 });
const megabytes = (bytes: number) => MB.format(bytes / 1_000_000);

/** "just now", "4 minutes ago", "2 hours ago" — in the browser's language. */
function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return minutes < 60 ? format.format(-minutes, "minute") : format.format(-Math.round(minutes / 60), "hour");
}
