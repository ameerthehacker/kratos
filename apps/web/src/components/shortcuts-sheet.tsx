import { create } from "zustand";
import { HotkeysProvider, useAppHotkeyList, useAppHotkeys, useHotkey } from "@tanstack/react-hotkeys";
import { Shortcut } from "@/components/shortcut";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LOCAL_ROWS, SCOPES, SHEET_GROUPS, type SheetRow } from "@/lib/shortcuts";

/** Open from ⌘/ anywhere, or quick settings' last row. */
export const useShortcutsSheet = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/**
 * Every shortcut in one place (3k2, the design's sheet): the app shortcuts from the list, with the
 * prompt's and questions' own keys, by group in two columns. Where rebinding will live later.
 */
export function ShortcutsSheet() {
  const { open, setOpen } = useShortcutsSheet();
  const appHotkeys = useAppHotkeys();
  useHotkey(appHotkeys["shortcuts.open"], () => setOpen(!useShortcutsSheet.getState().open));
  const list = useAppHotkeyList();
  const rows: Array<SheetRow & { group: string }> = [
    ...list.map(({ appHotkey }) => ({
      group: appHotkey.meta?.group ?? "General",
      name: appHotkey.meta?.name ?? appHotkey.id,
      when: appHotkey.meta?.description,
      hotkey: appHotkey.hotkey ?? undefined,
    })),
    ...LOCAL_ROWS,
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-1 rounded-3xl bg-card p-2 sm:max-w-2xl">
        {/* While open, page keys (Esc = stop, N = next file…) rest; ⌘/ and the rest of General work. */}
        <HotkeysProvider scope={SCOPES.sheet} exclusive={{ allow: ["global"] }}>
          <DialogTitle className="px-2.5 pt-1.5 pb-1 text-base font-medium">Keyboard shortcuts</DialogTitle>
          {/* Two columns that stack on their own (3x1): as a grid, a short group left a hole beside
              a long one. Groups alternate between them, filled left to right (the design). */}
          <div className="grid grid-cols-2 gap-x-4">
            {[0, 1].map((column) => (
              <div key={column} className="flex flex-col gap-2">
                {SHEET_GROUPS.filter((_, i) => i % 2 === column).map((group) => (
                  <section key={group} aria-label={group} className="flex flex-col">
                    <h3 className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">{group}</h3>
                    {rows
                      .filter((row) => row.group === group)
                      .map((row) => (
                        <div key={row.name} className="flex min-h-9 items-center gap-3 rounded-lg px-2.5 text-sm text-secondary-foreground">
                          <span className="min-w-0 flex-1">
                            {row.name}
                            {row.when && <span className="text-muted-foreground"> · {row.when}</span>}
                          </span>
                          <Shortcut hotkey={row.hotkey} keys={row.keys} />
                        </div>
                      ))}
                  </section>
                ))}
              </div>
            ))}
          </div>
        </HotkeysProvider>
      </DialogContent>
    </Dialog>
  );
}
