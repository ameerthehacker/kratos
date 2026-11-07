import copyToClipboard from "copy-to-clipboard";
import { ChevronDown, Code, Copy, FolderOpen } from "lucide-react";
import type { Editor } from "@kratos/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditorPref } from "@/lib/editor-pref";
import { useKratos } from "@/lib/kratos-store";
import { clientLog } from "@/lib/log";
import { cn } from "@/lib/utils";

/**
 * The header's project chip (3d3): the logo of what you opened it with last — an editor or
 * Finder (else the first editor found, else a folder), the project name, and the connection dot (with a tooltip saying what it means).
 * Clicking the logo and name opens the project in that editor (3d5); the chevron's menu shows the
 * full path and opens it in another editor the server found on this machine (with that app's
 * real icon), reveals it in the file manager, or copies the path.
 */
export function ProjectMenu({ cwd, editors, connected }: { cwd: string; editors: Editor[]; connected: boolean }) {
  const send = useKratos((s) => s.send);
  const { last, setLast } = useEditorPref();
  const name = cwd.split("/").filter(Boolean).pop() ?? cwd;
  const files = editors.find((e) => e.id === "files");
  const apps = editors.filter((e) => e.id !== "files");
  // The pill's default: whatever you picked last from the list, Finder included (owner); else
  // the first editor found, else Finder. One click opens it (3d5); the chevron offers the others.
  const primary = editors.find((e) => e.id === last) ?? apps[0] ?? files;
  const openIn = (editor: Editor) => {
    setLast(editor.id);
    send({ type: "open_in", editor: editor.id });
  };
  const defaultMark = (editor: Editor) =>
    editor.id === primary?.id && <span className="ml-auto text-xs text-muted-foreground">Default</span>;
  const segment = "inline-flex h-full items-center outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <DropdownMenu>
      {/* A split pill: open | dot | menu. The dot sits outside both buttons so tooltips don't nest. */}
      <div className="inline-flex h-8 max-w-64 min-w-0 items-center gap-1.5 rounded-full bg-secondary text-xs whitespace-nowrap text-secondary-foreground">
        {primary ? (
          <Tooltip>
            <TooltipTrigger
              onClick={() => openIn(primary)}
              aria-label={`Open ${name} in ${primary.id === "files" ? primary.label.replace(/^Reveal in /, "") : primary.label}`}
              className={cn(segment, "min-w-0 gap-2 rounded-l-full pr-1.5 pl-2")}
            >
              <EditorIcon editor={primary} />
              <span className="truncate font-medium">{name}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{primary.id === "files" ? primary.label : `Open in ${primary.label}`}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="flex min-w-0 items-center gap-2 pl-2">
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate font-medium">{name}</span>
          </span>
        )}
        <ConnectionDot connected={connected} />
        <DropdownMenuTrigger aria-label={`More ways to open ${name}`} className={cn(segment, "rounded-r-full pr-2.5 pl-1.5")}>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" strokeWidth={2.2} aria-hidden="true" />
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate font-mono font-normal" title={cwd}>
            {cwd}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {apps.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Open in</DropdownMenuLabel>
            {apps.map((editor) => (
              <DropdownMenuItem key={editor.id} onClick={() => openIn(editor)}>
                <EditorIcon editor={editor} />
                {editor.label}
                {defaultMark(editor)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {apps.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuGroup>
          {files && (
            <DropdownMenuItem onClick={() => openIn(files)}>
              <EditorIcon editor={files} />
              {files.label}
              {defaultMark(files)}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={async () => {
              if (!(await copyToClipboard(cwd))) clientLog("warn", "could not copy the project path");
            }}
          >
            <Copy />
            Copy path
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The app's own icon from the server when there is one; else a generic code / folder icon. */
function EditorIcon({ editor }: { editor: Editor }) {
  if (editor.icon) return <img src={editor.icon} alt="" className="size-4 shrink-0 rounded-sm" draggable={false} />;
  const Fallback = editor.id === "files" ? FolderOpen : Code;
  return <Fallback className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** Is this tab connected to the Kratos server? A span, not a button: it only explains itself. */
export function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        aria-label={connected ? "Connected to Kratos" : "Reconnecting to Kratos"}
        className={cn("size-2 shrink-0 rounded-full", connected ? "bg-primary" : "animate-pulse bg-wait")}
      />
      <TooltipContent side="bottom">
        {connected ? "Connected to Kratos — live updates are on" : "Reconnecting to Kratos… changes will show once it's back"}
      </TooltipContent>
    </Tooltip>
  );
}
