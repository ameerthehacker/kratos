import { Check, ChevronDown, Folder, MessageSquare } from "lucide-react";
import type { FeatureSummary } from "@kratos/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The shelf's first pill (D73, board §5): what a session belongs to. `choose` (Home): a one-off —
 * the default — or one of the working features, for the session you're starting. `move` (a
 * one-off's session): move it into a feature. Without either it just says which feature the
 * session is in (4f makes it open the plan). Its menu opens upward, off the shelf.
 */
export function FeaturePill({ features, value, purpose, onChange }: {
  features: readonly FeatureSummary[];
  value: string | null;
  purpose?: "choose" | "move";
  onChange?: (featureId: string | null) => void;
}) {
  const current = features.find((f) => f.id === value);
  const Icon = current ? Folder : MessageSquare;
  const look = "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs whitespace-nowrap";
  const label = (
    <>
      <Icon className={cn("size-3.5 shrink-0", current ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
      <span className={cn("truncate", current ? "text-foreground" : "text-secondary-foreground")}>{current?.title ?? "One-off"}</span>
    </>
  );
  if (!purpose || !onChange) {
    return (
      <span className={look} aria-label={current ? `Part of the feature ${current.title}` : "A one-off session"}>
        {label}
      </span>
    );
  }

  const working = features.filter((f) => !f.done);
  const pick = (id: string | null) => id !== value && onChange(id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={current ? `Part of the feature ${current.title}. Change` : purpose === "move" ? "A one-off. Move to a feature" : "A one-off. Change"}
        className={cn(look, "text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring")}
      >
        {label}
        <ChevronDown className="size-3 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-80">
        {purpose === "choose" && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>This session is</DropdownMenuLabel>
              <Option icon={MessageSquare} title="A one-off" note="Just this. You can move it into a feature later." selected={!current} onPick={() => pick(null)} />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{purpose === "choose" ? "Part of a feature" : "Move to a feature"}</DropdownMenuLabel>
          {working.length === 0 && <p className="px-1.5 py-1 text-xs text-muted-foreground">No features yet: make one with the folder button in the sidebar.</p>}
          {working.map((feature) => (
            <Option key={feature.id} icon={Folder} title={feature.title} selected={feature.id === value} onPick={() => pick(feature.id)} />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Option({ icon: Icon, title, note, selected, onPick }: { icon: typeof Folder; title: string; note?: string; selected: boolean; onPick: () => void }) {
  return (
    <DropdownMenuItem onClick={onPick} className="relative items-start pr-8">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{title}</span>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
      {selected && <Check className="absolute top-2 right-2 size-4" aria-label="Selected" />}
    </DropdownMenuItem>
  );
}
