import { create } from "zustand";
import { persist } from "zustand/middleware";

/** The plans island (4p5a), remembered per browser like the sidebar (3d4): shown or hidden. Shown
 * by default, so a session's plans are where you'll see them; hide it and it stays hidden. */
export const usePlansPrefs = create<{ open: boolean; setOpen: (open: boolean) => void }>()(
  persist((set) => ({ open: true, setOpen: (open) => set({ open }) }), { name: "kratos.plans" }),
);
