import { SlidersHorizontal } from "lucide-react";
import type { ThemeId } from "@kratos/core";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useKratos } from "@/lib/kratos-store";
import { THEME_LIST, applyTheme } from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * The header's quick settings (3w, the design's Home/Session boards): a sliders button that opens
 * the theme picker (3w1); notifications join it in 3w3. Settings are Kratos's (D63): a pick goes
 * to the server, which tells every tab.
 */
export function QuickSettings() {
  const settings = useKratos((s) => s.settings);
  const send = useKratos((s) => s.send);
  const connected = useKratos((s) => s.connected);
  const current = THEME_LIST.find((t) => t.id === settings?.theme) ?? THEME_LIST[0]!;

  const pick = (theme: ThemeId) => {
    applyTheme(theme); // at once here; the server's `settings` confirms it, and moves other tabs
    useKratos.setState((s) => (s.settings ? { settings: { ...s.settings, theme } } : {}));
    send({ type: "set_settings", settings: { theme } });
  };

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Quick settings"
        title="Theme and notifications"
        className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <SlidersHorizontal className="size-4.5" />
      </PopoverTrigger>
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
      </PopoverContent>
    </Popover>
  );
}
