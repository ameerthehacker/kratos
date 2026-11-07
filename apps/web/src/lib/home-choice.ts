import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentChoice } from "@/components/agent-picker";

/** The harness + model picked on Home, remembered per browser (localStorage) for the next new session (D43).
 * `rememberMode`: the permission mode last picked anywhere — Home or a session — carries to the
 * next new session (owner, 3q2) — a dangerous one (Bypass) only after its consent dialog (D53). */
export const useHomeChoice = create<{
  choice?: AgentChoice;
  setChoice: (choice: AgentChoice) => void;
  rememberMode: (harness: string, permissionMode: string | null) => void;
}>()(
  persist(
    (set) => ({
      setChoice: (choice) => set({ choice }),
      rememberMode: (harness, permissionMode) =>
        set(({ choice }) => ({
          choice: choice?.harness === harness ? { ...choice, permissionMode } : { harness, model: null, permissionMode },
        })),
    }),
    { name: "kratos.home-choice" },
  ),
);
