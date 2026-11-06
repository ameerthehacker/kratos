import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Which sidebar sections are collapsed, remembered per browser (3d2). Done starts collapsed. */
export const useSidebarPrefs = create<{ collapsed: Record<string, boolean>; toggle: (section: string) => void }>()(
  persist(
    (set) => ({
      collapsed: { Done: true },
      toggle: (section) => set((s) => ({ collapsed: { ...s.collapsed, [section]: !s.collapsed[section] } })),
    }),
    { name: "kratos.sidebar" },
  ),
);
