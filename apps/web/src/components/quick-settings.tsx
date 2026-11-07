import { useState, type ReactNode } from "react";
import { Keyboard, SlidersHorizontal } from "lucide-react";
import { useAppHotkeys, useHotkey } from "@tanstack/react-hotkeys";
import type { NotificationSettings, ThemeId } from "@kratos/core";
import { Hint, Shortcut } from "@/components/shortcut";
import { useShortcutsSheet } from "@/components/shortcuts-sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useKratos } from "@/lib/kratos-store";
import { THEME_LIST, applyTheme } from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * The header's quick settings (3w, the design's Home/Session boards): a sliders button that opens
 * the theme picker (3w1) and the notification switches (3w3). Settings are Kratos's (D63): a
 * change goes to the server, which tells every tab. Opens from its shortcut too (3k1), and its
 * last row opens the shortcuts sheet (3k2).
 */
export function QuickSettings() {
  const settings = useKratos((s) => s.settings);
  const send = useKratos((s) => s.send);
  const connected = useKratos((s) => s.connected);
  const current = THEME_LIST.find((t) => t.id === settings?.theme) ?? THEME_LIST[0]!;
  const [open, setOpen] = useState(false);
  const appHotkeys = useAppHotkeys();
  useHotkey(appHotkeys["settings.open"], () => setOpen((was) => !was));

  const pick = (theme: ThemeId) => {
    applyTheme(theme); // at once here; the server's `settings` confirms it, and moves other tabs
    useKratos.setState((s) => (s.settings ? { settings: { ...s.settings, theme } } : {}));
    send({ type: "set_settings", settings: { theme } });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label="Quick settings" id="settings.open">
        <PopoverTrigger
          aria-label="Quick settings"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-accent data-popup-open:text-foreground"
        >
          <SlidersHorizontal className="size-4.5" />
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="end" sideOffset={8} className="w-75 gap-0 rounded-2xl bg-card p-1 ring-border shadow-xl">
        <div className="flex items-baseline gap-2 px-2 pt-2 pb-1.5 text-xs font-medium text-muted-foreground">
          <span className="flex-1">Theme</span>
          <span className="font-normal text-secondary-foreground">{current.label}</span>
        </div>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-4 gap-1.5 px-1.5 pt-0.5 pb-1.5">
          {THEME_LIST.map((theme) => {
            const on = theme.id === current.id;
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={theme.label}
                title={theme.label}
                disabled={!connected}
                onClick={() => pick(theme.id)}
                className={cn(
                  "flex min-w-0 flex-col gap-1 rounded-lg p-0.75 text-center text-xs hover:bg-accent hover:text-secondary-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  on ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {/* The ring is this page's theme; inside, the swatch is drawn by its own theme's tokens. */}
                <span className={cn("block overflow-hidden rounded-lg", on ? "ring-2 ring-primary" : "ring-1 ring-border")}>
                  <span data-theme={theme.id} className="block h-10 bg-canvas p-1.25">
                    <span className="flex h-full items-center gap-1 rounded-md bg-background px-1.5 ring-1 ring-muted-foreground/30 ring-inset">
                      <span className="size-2 shrink-0 rounded-full bg-primary" />
                      <span className="h-0.75 flex-1 rounded-sm bg-foreground opacity-55" />
                    </span>
                  </span>
                </span>
                <span className="truncate">{theme.short}</span>
              </button>
            );
          })}
        </div>
        {settings && <Notifications prefs={settings.notifications} />}
        <div className="-mx-1 my-1 h-px bg-border" />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            useShortcutsSheet.getState().setOpen(true);
          }}
          className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Keyboard className="size-4 text-muted-foreground" />
          <span className="flex-1">Keyboard shortcuts</span>
          <Shortcut id="shortcuts.open" />
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** "Notify me" and what about (3w3). Notify me shows on only once the browser allows notifications:
 * turning it on asks (the click browsers require); a block is explained, not hidden. */
function Notifications({ prefs }: { prefs: NotificationSettings }) {
  const send = useKratos((s) => s.send);
  const supported = "Notification" in window; // needs localhost or https (not a LAN address over http)
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");
  const on = prefs.on && permission === "granted";

  const save = (change: Partial<NotificationSettings>) => {
    const notifications = { ...prefs, ...change };
    useKratos.setState((s) => (s.settings ? { settings: { ...s.settings, notifications } } : {}));
    send({ type: "set_settings", settings: { notifications } });
  };
  const toggleOn = async (want: boolean) => {
    if (!want) return save({ on: false });
    const answer = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    setPermission(answer);
    if (answer === "granted") save({ on: true });
  };

  return (
    <>
      <div className="-mx-1 my-1 h-px bg-border" />
      <div className="px-2 pt-2 pb-1.5 text-xs font-medium text-muted-foreground">Notifications</div>
      <SwitchRow label="Notify me" hint="When a session needs you or finishes" checked={on} disabled={!supported} onChange={toggleOn} />
      {!supported ? (
        <p className="px-2 pb-2 text-xs text-muted-foreground">This browser can't show notifications here.</p>
      ) : permission === "denied" ? (
        <p className="px-2 pb-2 text-xs text-muted-foreground">Blocked for this site. Allow notifications in your browser's site settings, then turn this on.</p>
      ) : null}
      <div className={cn(!on && "opacity-50")}>
        <SwitchRow label="Needs your OK" hint="Approvals and questions" checked={prefs.needsYou} disabled={!on} onChange={(v) => save({ needsYou: v })} />
        <SwitchRow label="Finished" hint="A session is done and idle" checked={prefs.finished} disabled={!on} onChange={(v) => save({ finished: v })} />
        <SwitchRow label="Play a sound" checked={prefs.sound} disabled={!on} onChange={(v) => save({ sound: v })} />
      </div>
    </>
  );
}

/** One row: the words on the left, the switch on the right; the whole row toggles it. */
function SwitchRow(props: { label: string; hint?: ReactNode; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={cn("flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5", !props.disabled && "cursor-pointer hover:bg-accent")}>
      <span className="flex min-w-0 flex-1 flex-col text-sm">
        {props.label}
        {props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}
      </span>
      <Switch checked={props.checked} disabled={props.disabled} onCheckedChange={(checked) => props.onChange(checked)} />
    </label>
  );
}
