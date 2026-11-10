import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import type { AppHotkeyId } from "@tanstack/react-hotkeys";
import { Shortcut } from "@/components/shortcut";
import { cn } from "@/lib/utils";

/** A page's way back (review, plan): it hugs its text (owner: a full-width bar on hover looked
 * heavy), with its key on hover (the design). */
export function BackLink({ to, label, shortcut, className }: { to: string; label: string; shortcut: AppHotkeyId; className?: string }) {
  return (
    <Link to={to} className={cn("group flex h-9 flex-none items-center gap-2 self-start rounded-lg pr-1.5 pl-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground", className)}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
      <Shortcut id={shortcut} variant="secondary" className="invisible group-hover:visible group-focus-visible:visible" />
    </Link>
  );
}
