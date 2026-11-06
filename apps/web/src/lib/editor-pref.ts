import { create } from "zustand";
import { persist } from "zustand/middleware";

/** The editor you opened the project in last, remembered per browser: its logo leads the chip (3d3). */
export const useEditorPref = create<{ last?: string; setLast: (id: string) => void }>()(
  persist((set) => ({ setLast: (last) => set({ last }) }), { name: "kratos.editor" }),
);
