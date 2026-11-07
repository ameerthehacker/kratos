import { create } from "zustand";
import { persist } from "zustand/middleware";

/** How the review page lays out a diff, remembered per browser (3v3; owner: split by default). */
export const useReviewPrefs = create<{ layout: "split" | "unified"; setLayout: (layout: "split" | "unified") => void }>()(
  persist((set) => ({ layout: "split", setLayout: (layout) => set({ layout }) }), { name: "kratos.review" }),
);
