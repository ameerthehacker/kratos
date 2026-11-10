import { useState, type ReactNode } from "react";
import { Check, CircleAlert, FileCode } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { HotkeysProvider, useAppHotkeys, useHotkey, type AppHotkeyId } from "@tanstack/react-hotkeys";
import { useMediaQuery } from "usehooks-ts";
import type { ChangedFile } from "@kratos/core";
import { BackLink } from "@/components/back-link";
import { sessionTitle } from "@/components/session-status";
import { Hint, Shortcut } from "@/components/shortcut";
import { ChangeBlocks, Counts, SKIPPED } from "@/components/review/counts";
import { DiffView } from "@/components/review/diff-view";
import { useChanges } from "@/hooks/use-changes";
import { useKratos } from "@/lib/kratos-store";
import { useReviewPrefs } from "@/lib/review-prefs";
import { SCOPES } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/**
 * `/s/:sessionId/review` — what a session changed, one file at a time (3v2, the design's Diff
 * board). Its own page on the canvas: the file list island and the diff island, no app header.
 * Keys (3k): N / P next and previous file, V viewed, S split or unified, Esc back.
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
  // Viewed = marked at this very version; a file the agent changed since is unviewed (3v3).
  const viewedVersions = useKratos((s) => (sessionId ? s.viewed[sessionId] : undefined));
  const isViewed = (file: ChangedFile) => viewedVersions?.[file.path] === file.version;
  const setViewed = useKratos((s) => s.setViewed);
  // Split needs the width (the design's narrow board): below lg, always unified.
  const { layout: preferred, setLayout } = useReviewPrefs();
  const wide = useMediaQuery("(min-width: 1024px)");
  const layout = wide ? preferred : "unified";

  const navigate = useNavigate();
  const appHotkeys = useAppHotkeys();
  const at = current ? files.indexOf(current) : -1;
  const previous = files[at - 1];
  const next = files[at + 1];
  const toggleViewed = () => sessionId && current && setViewed(sessionId, current.path, current.version, !isViewed(current));
  useHotkey(appHotkeys["review.next"], () => next && setPicked(next.path), { enabled: !!next });
  useHotkey(appHotkeys["review.previous"], () => previous && setPicked(previous.path), { enabled: !!previous });
  useHotkey(appHotkeys["review.viewed"], toggleViewed, { enabled: !!current });
  useHotkey(appHotkeys["review.layout"], () => setLayout(preferred === "split" ? "unified" : "split"), { enabled: wide });
  // On the window, like the session's Esc: an Esc that closed a popup isn't "back".
  useHotkey(appHotkeys["review.back"], () => navigate(back), { target: window, ignoreDefaultPrevented: true });

  return (
    // The review's own keys fire only on this page.
    <HotkeysProvider scope={SCOPES.review}>
      <div className="flex h-screen gap-2.5 bg-canvas p-2.5 text-body antialiased">
        {/* Only the file list scrolls (owner): the way back, the title and the progress stay put. */}
        <aside aria-label="Changed files" className="hidden w-80 flex-none flex-col gap-1.5 overflow-hidden rounded-3xl bg-background py-3.5 md:flex">
          <BackLink to={back} label="Back to the session" shortcut="review.back" className="ml-2.5" />
          <div className="flex flex-none flex-col gap-2.5 px-5 pt-3.5 pb-4.5">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Review changes</h1>
            {files.length > 0 && (
              <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                {files.length} {files.length === 1 ? "file" : "files"}
                <Counts additions={sum(files, "additions")} deletions={sum(files, "deletions")} />
              </span>
            )}
            {files.length > 0 && <Progress viewed={files.map(isViewed)} />}
          </div>
          <nav aria-label="Files" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5">
            {files.map((file, i) => (
              <FileRow
                key={file.path}
                file={file}
                n={i + 1}
                current={file === current}
                viewed={isViewed(file)}
                onPick={() => setPicked(file.path)}
                // A faint P / N on the files either side of this one: where the keys go (the design).
                hint={file === previous ? "review.previous" : file === next ? "review.next" : undefined}
              />
            ))}
          </nav>
        </aside>

        <main aria-label="Diff" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-background">
          <header className="flex min-h-16 items-center gap-3 px-6 py-3">
            {/* Without the file list (narrow), the way back is here. Picking files there: 3v3. */}
            <BackLink to={back} label="Back to the session" shortcut="review.back" className="-ml-3 md:hidden" />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{session && sessionTitle(session)}</span>
            {wide && (
              <Hint label="Split or unified" id="review.layout">
                <LayoutSwitch value={preferred} onChange={setLayout} />
              </Hint>
            )}
          </header>
          {/* Nothing here scrolls but the diff itself (owner): the file's title stays, and the diff
              box fills the rest of the island with its own scroll bars. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-6 px-4 pt-5 pb-6 md:px-10">
              {!changes ? (
                <Notice>Reading the changes…</Notice>
              ) : changes.unavailable ? (
                <Notice icon={<CircleAlert className="size-5" />}>{changes.unavailable}.</Notice>
              ) : !current ? (
                <Notice icon={<FileCode className="size-5" />}>No changes yet. Files {agent} changes in this session show here.</Notice>
              ) : (
                <>
                  {changes.note && <p className="flex-none rounded-2xl bg-secondary px-5 py-3 text-sm text-secondary-foreground">{changes.note}.</p>}
                  <FileHeader file={current} viewed={isViewed(current)} onViewed={toggleViewed} />
                  <DiffView key={current.path} file={current} layout={layout} />
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </HotkeysProvider>
  );
}

/** Where the diff would be, when there's none to show (3x1): centred in the island, not a stray line. */
function Notice({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-center text-sm text-muted-foreground">
      {icon && (
        <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-secondary text-faint">
          {icon}
        </span>
      )}
      <p className="max-w-md text-balance">{children}</p>
    </div>
  );
}

/** One bar per file, filled as you mark them viewed, and "2 of 4 viewed". */
function Progress({ viewed }: { viewed: boolean[] }) {
  const count = viewed.filter(Boolean).length;
  return (
    <>
      <div role="meter" aria-label="Files viewed" aria-valuemin={0} aria-valuemax={viewed.length} aria-valuenow={count} className="mt-1 flex gap-1">
        {viewed.map((done, i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full", done ? "bg-primary" : "bg-input")} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{count === viewed.length ? `All ${count} viewed` : `${count} of ${viewed.length} viewed`}</span>
    </>
  );
}

/** Split | Unified (3v3), as a radio group like the design's segmented control. */
function LayoutSwitch({ value, onChange, ...rest }: { value: "split" | "unified"; onChange: (layout: "split" | "unified") => void } & Omit<React.ComponentProps<"div">, "onChange">) {
  return (
    // `rest`: the tooltip's trigger props (Hint renders this as its trigger).
    <div {...rest} role="radiogroup" aria-label="Diff layout" className="flex gap-0.5 rounded-full bg-secondary p-0.75">
      {(["split", "unified"] as const).map((layout) => (
        <button
          key={layout}
          type="button"
          role="radio"
          aria-checked={value === layout}
          onClick={() => onChange(layout)}
          className={cn(
            "h-8 rounded-full px-3.5 text-sm capitalize",
            value === layout ? "bg-card text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-secondary-foreground",
          )}
        >
          {layout}
        </button>
      ))}
    </div>
  );
}

/** A file in the list: its number (a tick once viewed), name and folder, +/− and the five blocks. */
function FileRow({ file, n, current, viewed, onPick, hint }: { file: ChangedFile; n: number; current: boolean; viewed: boolean; onPick: () => void; hint?: AppHotkeyId }) {
  const { name, dir } = splitPath(file.path);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={current ? "page" : undefined}
      className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-accent", current && "bg-secondary hover:bg-secondary")}
    >
      {viewed ? (
        <span className="flex size-5.5 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" strokeWidth={3} aria-label="Viewed" />
        </span>
      ) : (
        <span className="flex size-5.5 flex-none items-center justify-center rounded-full font-mono text-xs text-muted-foreground ring-1 ring-input ring-inset">{n}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate text-sm", current && "font-medium", viewed && !current && "text-muted-foreground")}>{name}</span>
        <span className="truncate font-mono text-xs text-faint">{dir}</span>
      </span>
      {hint && <Shortcut id={hint} variant="faint" />}
      <span className="flex flex-col items-end gap-1.25">
        {file.skipped ? <span className="text-xs text-muted-foreground">{file.skipped === "binary" ? "binary" : "not shown"}</span> : <Counts additions={file.additions} deletions={file.deletions} className="text-xs" />}
        <ChangeBlocks file={file} />
      </span>
    </button>
  );
}

/** Above the diff: folder, name (big), what kind of change, +/−, and the Viewed checkbox. */
function FileHeader({ file, viewed, onViewed }: { file: ChangedFile; viewed: boolean; onViewed: () => void }) {
  const { name, dir } = splitPath(file.path);
  return (
    <div className="flex flex-none items-end gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Kept for a file at the root too, so the name doesn't jump between files. */}
        <span className="min-h-5 font-mono text-sm text-muted-foreground">{dir}</span>
        <span className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-heading text-4xl font-semibold tracking-tight break-all">{name}</h2>
          {file.status === "added" && <Chip className="bg-add/15 text-add">New file</Chip>}
          {file.status === "deleted" && <Chip className="bg-destructive/15 text-destructive">Deleted</Chip>}
          {file.status === "renamed" && <Chip className="bg-secondary text-secondary-foreground">Renamed from {file.oldPath}</Chip>}
          {file.skipped ? <span className="text-sm text-muted-foreground">{SKIPPED[file.skipped]}</span> : <Counts additions={file.additions} deletions={file.deletions} className="text-sm" />}
        </span>
      </div>
      <button
        type="button"
        role="checkbox"
        aria-checked={viewed}
        onClick={onViewed}
        className={cn(
          "inline-flex h-9 flex-none items-center gap-2 rounded-full pr-1.5 pl-2.5 text-sm",
          viewed ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground hover:text-foreground",
        )}
      >
        <span className={cn("flex size-4 items-center justify-center rounded-sm", viewed ? "bg-primary text-primary-foreground" : "ring-1 ring-input ring-inset")}>
          {viewed && <Check className="size-2.5" strokeWidth={4} aria-hidden="true" />}
        </span>
        Viewed
        {/* The key you press most while reviewing, inside the pill (the design). */}
        <Shortcut id="review.viewed" variant={viewed ? "faint" : "secondary"} />
      </button>
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
