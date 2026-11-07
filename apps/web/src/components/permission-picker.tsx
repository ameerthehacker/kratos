import { useState } from "react";
import { Ban, ChevronDown, FilePen, Hand, ListChecks, Shield, ShieldCheck, ShieldOff, TriangleAlert, type LucideIcon } from "lucide-react";
import type { AgentPermissionMode } from "@kratos/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** One icon per agent-neutral kind (D53): the UI never needs the agent's own mode ids. */
const ICONS: Record<AgentPermissionMode["kind"], LucideIcon> = {
  ask: Hand,
  edits: FilePen,
  plan: ListChecks,
  auto: ShieldCheck,
  never_ask: Ban,
  bypass: ShieldOff,
  other: Shield,
};

/**
 * The composer's permission-mode chip (3q2, owner picked design option A): "✋ Ask ▾" next to the
 * agent chip. Its menu lists the harness's modes with what each means; a dangerous one (Bypass)
 * sits apart, in red, and opens a consent dialog first — only that dialog sends
 * `confirmDangerous`, which the server requires (D53). `value` null = the agent's default mode.
 */
export function PermissionPicker(props: {
  agentName: string;
  modes: readonly AgentPermissionMode[];
  value: string | null;
  onChange: (mode: string, confirmDangerous: boolean) => void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<AgentPermissionMode | null>(null); // awaiting consent
  const current = props.modes.find((m) => m.id === props.value) ?? props.modes.find((m) => m.isDefault) ?? props.modes[0];
  if (!current) return null; // this harness has no modes
  const safe = props.modes.filter((m) => !m.dangerous);
  const dangerous = props.modes.filter((m) => m.dangerous);
  const Icon = ICONS[current.kind];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={props.disabled}
          aria-label={`Permission mode: ${current.label}`}
          className={cn(
            "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-full px-3 text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
            current.dangerous
              ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
              : "bg-secondary text-secondary-foreground hover:bg-accent",
          )}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{current.shortLabel}</span>
          <ChevronDown className={cn("size-3 shrink-0", !current.dangerous && "text-muted-foreground")} strokeWidth={2.2} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Permissions</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={current.id} onValueChange={(id: string) => props.onChange(id, false)}>
              {safe.map((mode) => (
                // closeOnClick: Base UI keeps a menu open after a radio pick by default.
                <DropdownMenuRadioItem key={mode.id} value={mode.id} closeOnClick className="items-start">
                  <ModeText mode={mode} />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {dangerous.length > 0 && <DropdownMenuSeparator />}
          {dangerous.map((mode) => (
            // Not a radio item: picking it asks first, it doesn't switch.
            <DropdownMenuItem
              key={mode.id}
              onClick={() => mode.id !== current.id && setPending(mode)}
              className="items-start text-destructive focus:bg-destructive/15 focus:text-destructive"
            >
              <ModeText mode={mode} note="Asks you to confirm first." />
              {mode.id === current.id && <span className="ml-auto text-xs">On</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/15 text-destructive">
              <TriangleAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>Turn off all permission checks?</AlertDialogTitle>
            <AlertDialogDescription>
              {props.agentName} will edit files and run every command without asking you — including ones that
              delete or overwrite things. New sessions will start this way too, until you pick another mode.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pending) props.onChange(pending.id, true);
                setPending(null);
              }}
            >
              Turn off checks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A mode in the menu: its icon, name and what it means. */
function ModeText({ mode, note }: { mode: AgentPermissionMode; note?: string }) {
  const Icon = mode.dangerous ? TriangleAlert : ICONS[mode.kind];
  return (
    <span className="flex gap-2">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="flex flex-col">
        {mode.label}
        <span className={cn("text-xs", mode.dangerous ? "text-destructive/80" : "text-muted-foreground")}>
          {mode.description}
          {note && ` ${note}`}
        </span>
      </span>
    </span>
  );
}
