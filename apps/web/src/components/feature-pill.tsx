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
import { NameField } from "@/components/name-field";
import { cn } from "@/lib/utils";

/**
 * Home's shelf pill (D73, board §5): what the session you're starting belongs to — a one-off (the
 * default), one of the working features, or a new one named right here (`newTitle`: made by the
 * server when the prompt starts the session). Only on Home (owner, 4m3 round): in a session, the
 * sidebar shows its feature, and dragging or the agent's tools move it. Its menu opens upward.
 */
export function FeaturePill({ features, value, newTitle, onChange, onCreate }: {
  features: readonly FeatureSummary[];
  value: string | null;
  newTitle?: string | null;
  onChange: (featureId: string | null) => void;
  onCreate: (title: string) => void;
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
  if (naming) {
    return (
      // Clicking away keeps the name: nothing is made until you send (you'll often click into the
      // prompt next).
      <NameField
        icon={PackagePlus}
        placeholder="Name the new feature"
        keepOnBlur
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
        aria-label={title ? `Part of the feature ${title}. Change` : "A one-off. Change"}
        className={cn(look, "text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring")}
      >
        {label}
        <ChevronDown className="size-3 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>This session is</DropdownMenuLabel>
          <Option icon={MessageSquare} title="A one-off" note="Just this. You can move it into a feature later." selected={!title} onPick={() => pick(null)} />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Part of a feature</DropdownMenuLabel>
          {newTitle && <Option icon={PackagePlus} title={newTitle} note="New: made when you send" selected onPick={() => {}} />}
          {working.map((feature) => (
            <Option key={feature.id} icon={Package} title={feature.title} selected={!newTitle && feature.id === value} onPick={() => pick(feature.id)} />
          ))}
          <Option icon={PackagePlus} title="New feature…" selected={false} onPick={() => setNaming(true)} />
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
