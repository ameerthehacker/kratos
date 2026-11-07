import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import type { ChangedFile } from "@kratos/core";
import { sessionTitle } from "@/components/session-status";
import { ChangeBlocks, Counts, SKIPPED } from "@/components/review/counts";
import { DiffView } from "@/components/review/diff-view";
import { useChanges } from "@/hooks/use-changes";
import { useKratos } from "@/lib/kratos-store";
import { cn } from "@/lib/utils";

/**
 * `/s/:sessionId/review` — what a session changed, one file at a time (3v2, the design's Diff
 * board). Its own page on the canvas: the file list island and the diff island, no app header.
 */
export function ReviewPage() {
  const { sessionId } = useParams();
  const session = useKratos((s) => s.sessions.find((x) => x.id === sessionId));
  const agent = useKratos((s) => s.harnesses.find((h) => h.id === session?.harness)?.name ?? "The agent");
  const changes = useChanges(sessionId);
  const files = changes?.files ?? [];
  const [picked, setPicked] = useState<string>();
  const current = files.find((f) => f.path === picked) ?? files[0];
  const back = `/s/${sessionId}`;

  return (
    <div className="flex h-screen gap-2.5 bg-canvas p-2.5 text-body antialiased">
      <aside aria-label="Changed files" className="hidden w-80 flex-none flex-col gap-1.5 overflow-y-auto rounded-3xl bg-background px-2.5 py-3.5 md:flex">
        <BackLink to={back} />
        <div className="flex flex-col gap-2.5 px-2.5 pt-3.5 pb-4.5">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Review changes</h1>
          {files.length > 0 && (
            <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
              {files.length} {files.length === 1 ? "file" : "files"}
              <Counts additions={sum(files, "additions")} deletions={sum(files, "deletions")} />
            </span>
          )}
        </div>
        <nav aria-label="Files" className="flex flex-col gap-0.5">
          {files.map((file, i) => (
            <FileRow key={file.path} file={file} n={i + 1} current={file === current} onPick={() => setPicked(file.path)} />
          ))}
        </nav>
      </aside>

      <main aria-label="Diff" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-background">
        <header className="flex min-h-16 items-center gap-3 px-6 py-3">
          {/* Without the file list (narrow), the way back is here. Picking files there: 3v3. */}
          <BackLink to={back} className="-ml-3 md:hidden" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{session && sessionTitle(session)}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 pt-5 pb-14 md:px-10">
            {!changes ? (
              <p className="text-muted-foreground">Reading the changes…</p>
            ) : changes.unavailable ? (
              <p className="text-muted-foreground">{changes.unavailable}.</p>
            ) : !current ? (
              <p className="text-muted-foreground">No changes yet. Files {agent} changes in this session show here.</p>
            ) : (
              <>
                {changes.note && <p className="rounded-2xl bg-secondary px-5 py-3 text-sm text-secondary-foreground">{changes.note}.</p>}
                <FileHeader file={current} />
                <DiffView key={current.path} file={current} />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function BackLink({ to, className }: { to: string; className?: string }) {
  return (
    <Link to={to} className={cn("flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground", className)}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to the session
    </Link>
  );
}

/** A file in the list: its number, name and folder, +/− and the five blocks. */
function FileRow({ file, n, current, onPick }: { file: ChangedFile; n: number; current: boolean; onPick: () => void }) {
  const { name, dir } = splitPath(file.path);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={current ? "page" : undefined}
      className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-accent", current && "bg-secondary hover:bg-secondary")}
    >
      <span className="flex size-5.5 flex-none items-center justify-center rounded-full font-mono text-xs text-muted-foreground ring-1 ring-input ring-inset">{n}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate text-sm", current && "font-medium")}>{name}</span>
        <span className="truncate font-mono text-xs text-faint">{dir}</span>
      </span>
      <span className="flex flex-col items-end gap-1.25">
        {file.skipped ? <span className="text-xs text-faint">{file.skipped === "binary" ? "binary" : "not shown"}</span> : <Counts additions={file.additions} deletions={file.deletions} className="text-xs" />}
        <ChangeBlocks file={file} />
      </span>
    </button>
  );
}

/** Above the diff: folder, name (big), what kind of change, +/−. */
function FileHeader({ file }: { file: ChangedFile }) {
  const { name, dir } = splitPath(file.path);
  return (
    <div className="flex flex-col gap-1">
      {/* Kept for a file at the root too, so the name doesn't jump between files. */}
      <span className="min-h-5 font-mono text-sm text-muted-foreground">{dir}</span>
      <span className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-heading text-4xl font-semibold tracking-tight break-all">{name}</h2>
        {file.status === "added" && <Chip className="bg-add/15 text-add">New file</Chip>}
        {file.status === "deleted" && <Chip className="bg-destructive/15 text-destructive">Deleted</Chip>}
        {file.status === "renamed" && <Chip className="bg-secondary text-secondary-foreground">Renamed from {file.oldPath}</Chip>}
        {file.skipped ? <span className="text-sm text-faint">{SKIPPED[file.skipped]}</span> : <Counts additions={file.additions} deletions={file.deletions} className="text-sm" />}
      </span>
    </div>
  );
}

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-5.5 items-center rounded-full px-2.25 text-xs font-medium", className)}>{children}</span>;
}

const splitPath = (path: string) => {
  const slash = path.lastIndexOf("/");
  return { name: path.slice(slash + 1), dir: path.slice(0, slash + 1) };
};

const sum = (files: readonly ChangedFile[], key: "additions" | "deletions") => files.reduce((total, file) => total + file[key], 0);
