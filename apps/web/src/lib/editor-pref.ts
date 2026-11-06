import { create } from "zustand";
import { persist } from "zustand/middleware";

/** What you opened the project with last (an editor id, or "files" for Finder), remembered per
 * browser: it is the chip's default (3d3, 3d5). */
export const useEditorPref = create<{ last?: string; setLast: (id: string) => void }>()(
  persist((set) => ({ setLast: (last) => set({ last }) }), { name: "kratos.editor" }),
);
