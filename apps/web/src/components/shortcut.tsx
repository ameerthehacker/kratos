import { useState, type ReactElement, type ReactNode } from "react";
import { useAppHotkeys, useFormatForDisplay, type AppHotkeyId, type Hotkey } from "@tanstack/react-hotkeys";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Where the caps sit (the design's keycap): on the page (ringed), in a tooltip (the tooltip
 * restyles them itself), inside a foreground-filled button, on a secondary fill, or faint. */
const VARIANTS = {
  plain: "ring-1 ring-border",
  tooltip: "",
  inverse: "bg-background/15 text-background/75",
  secondary: "bg-background",
  faint: "bg-transparent text-faint",
};

/**
 * A shortcut as keycaps: ⇧⌘O on a Mac, Ctrl Shift O elsewhere (the library formats it). Give
 * an app shortcut's `id` — its effective binding, so a rebinding later shows everywhere — or a
 * widget's own `hotkey` (`PROMPT_KEYS`), or literal `keys` for a range like 1–9.
 */
export function Shortcut(props: { id?: AppHotkeyId; hotkey?: Hotkey; keys?: string[]; variant?: keyof typeof VARIANTS; className?: string }) {
  const appHotkeys = useAppHotkeys();
  const format = useFormatForDisplay();
  const hotkey = props.id ? appHotkeys[props.id].hotkey : props.hotkey;
  const caps = props.keys ?? (hotkey ? toCaps(format(hotkey, { parts: true })) : []);
  if (caps.length === 0) return null;
  return (
    <KbdGroup className={cn("gap-0.75", props.className)}>
      {caps.map((cap, i) => (
        <Kbd key={i} className={VARIANTS[props.variant ?? "plain"]}>
          {cap}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

// A chord gives its caps, a sequence one list per step (none of ours yet): one row of caps either way.
const toCaps = (parts: string | string[] | string[][]) => (typeof parts === "string" ? [parts] : (parts as Array<string | string[]>).flat());

/** A tooltip for an icon button (replaces `title`): its label, then its shortcut if it has one.
 * The child is the button itself (base-ui `render`), so it can be a PopoverTrigger too. */
export function Hint(props: { label: ReactNode; id?: AppHotkeyId; side?: "top" | "bottom"; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next, details) => {
        // A hint mustn't take the key: base-ui's own Esc close would mark it handled and stop it,
        // so Esc on a hovered Stop wouldn't stop. Refuse that close, let the key travel on (to the
        // window, where page shortcuts hear Esc), and close it ourselves.
        if (!next && details.reason === "escape-key") {
          details.cancel();
          details.allowPropagation();
        }
        setOpen(next);
      }}
    >
      <TooltipTrigger render={props.children} />
      <TooltipContent side={props.side ?? "bottom"}>
        {props.label}
        {props.id && <Shortcut id={props.id} variant="tooltip" />}
      </TooltipContent>
    </Tooltip>
  );
}
