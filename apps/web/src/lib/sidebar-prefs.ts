import { create } from "zustand";
import { persist } from "zustand/middleware";

/** The sidebar, remembered per browser: whether it's open (3d4, closed by default) and which
 * sections are collapsed (3d2, Done starts collapsed). */
export const useSidebarPrefs = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
  collapsed: Record<string, boolean>;
  toggle: (section: string) => void;
}>()(
  persist(
    (set) => ({
      open: false,
      setOpen: (open) => set({ open }),
      collapsed: { Done: true },
      toggle: (section) => set((s) => ({ collapsed: { ...s.collapsed, [section]: !s.collapsed[section] } })),
    }),
    { name: "kratos.sidebar" },
  ),
);
