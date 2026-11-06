import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentChoice } from "@/components/agent-picker";

/** The harness + model picked on Home, remembered per browser (localStorage) for the next new session (D43). */
export const useHomeChoice = create<{ choice?: AgentChoice; setChoice: (choice: AgentChoice) => void }>()(
  persist((set) => ({ setChoice: (choice) => set({ choice }) }), { name: "kratos.home-choice" }),
);
