import { useState } from "react";
import { Check, ChevronDown, Package, PackagePlus, MessageSquare } from "lucide-react";
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
import { FeatureNameField } from "@/components/feature-name-field";
import { cn } from "@/lib/utils";

/**
 * The shelf's first pill (D73, board §5): what a session belongs to. `choose` (Home): a one-off —
 * the default — one of the working features, or a new one named right here (`newTitle`: made by
 * the server when the prompt starts the session). `move` (a one-off's session): move it into a
 * feature, or a new one. Without either it just says which feature the session is in (4f makes
 * it open the plan). Its menu opens upward, off the shelf.
 */
export function FeaturePill({ features, value, newTitle, purpose, onChange, onCreate }: {
  features: readonly FeatureSummary[];
  value: string | null;
  newTitle?: string | null;
  purpose?: "choose" | "move";
  onChange?: (featureId: string | null) => void;
  onCreate?: (title: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const current = features.find((f) => f.id === value);
  const title = newTitle ?? current?.title;
  const Icon = newTitle ? PackagePlus : current ? Package : MessageSquare;
  const look = "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs whitespace-nowrap";
  const label = (
    <>
      <Icon className={cn("size-3.5 shrink-0", title ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
      <span className={cn("truncate", title ? "text-foreground" : "text-secondary-foreground")}>{title ?? "One-off"}</span>
      {newTitle && <span className="text-muted-foreground">· new</span>}
    </>
  );
  if (!purpose || !onChange) {
    return (
      <span className={look} aria-label={current ? `Part of the feature ${current.title}` : "A one-off session"}>
        {label}
      </span>
    );
  }
  if (naming && onCreate) {
    return (
      // Clicking away keeps the name only on Home, where nothing is made until you send; here
      // the feature would be made at once, and features can't be deleted yet.
      <FeatureNameField
        icon={PackagePlus}
        placeholder="Name the new feature"
        keepOnBlur={purpose === "choose"}
        onDone={(name) => {
          setNaming(false);
          if (name) onCreate(name);
        }}
        className="inline-flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-background px-2 ring-1 ring-ring"
        iconClassName="size-3.5 text-primary"
        inputClassName="text-xs"
      />
    );
  }

  const working = features.filter((f) => !f.done);
  const pick = (id: string | null) => (id !== value || newTitle) && onChange(id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={title ? `Part of the feature ${title}. Change` : purpose === "move" ? "A one-off. Move to a feature" : "A one-off. Change"}
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
              <Option icon={MessageSquare} title="A one-off" note="Just this. You can move it into a feature later." selected={!title} onPick={() => pick(null)} />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{purpose === "choose" ? "Part of a feature" : "Move to a feature"}</DropdownMenuLabel>
          {newTitle && <Option icon={PackagePlus} title={newTitle} note="New: made when you send" selected onPick={() => {}} />}
          {working.map((feature) => (
            <Option key={feature.id} icon={Package} title={feature.title} selected={!newTitle && feature.id === value} onPick={() => pick(feature.id)} />
          ))}
          {onCreate && <Option icon={PackagePlus} title="New feature…" selected={false} onPick={() => setNaming(true)} />}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Option({ icon: Icon, title, note, selected, onPick }: { icon: typeof Package; title: string; note?: string; selected: boolean; onPick: () => void }) {
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
