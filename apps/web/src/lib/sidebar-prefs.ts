import { create } from "zustand";
import { persist } from "zustand/middleware";

/** The sidebar, remembered per browser: whether it's open (3d4, closed by default) and which
 * sections and folders are collapsed (3d2, Done starts collapsed; D73, a folder's "N done" too).
 * `setCollapsed`: one section, or several at once. */
export const useSidebarPrefs = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
  collapsed: Record<string, boolean>;
  toggle: (section: string) => void;
  setCollapsed: (section: string | Record<string, boolean>, collapsed?: boolean) => void;
}>()(
  persist(
    (set) => ({
      open: false,
      setOpen: (open) => set({ open }),
      collapsed: { Done: true },
      toggle: (section) => set((s) => ({ collapsed: { ...s.collapsed, [section]: !s.collapsed[section] } })),
      setCollapsed: (section, collapsed = false) =>
        set((s) => ({ collapsed: { ...s.collapsed, ...(typeof section === "string" ? { [section]: collapsed } : section) } })),
    }),
    { name: "kratos.sidebar" },
  ),
);
