import { defineAppHotkeys, type Hotkey } from "@tanstack/react-hotkeys";

/**
 * Every keyboard shortcut in Kratos (3k, D66, the design's "Proposal · keyboard shortcuts"):
 * the keys and every hint shown for them come from here, never from a string in a component.
 * Each component registers the action for an id with `useHotkey(useAppHotkeys()[id], …)`.
 * Hardcoded for now; the user's own bindings will go to `HotkeysProvider`'s `customHotkeys`.
 *
 * A `scope` keeps a shortcut to its page: it fires only while that page's `HotkeysProvider scope`
 * is mounted (`SCOPES`), so Esc can mean "stop" in a session and "back" when reviewing.
 */
export const appHotkeys = defineAppHotkeys({
  "sidebar.toggle": { hotkey: "Mod+B", meta: { name: "Show / hide sessions", group: "General" } },
  "session.new": { hotkey: "Mod+Shift+O", meta: { name: "New session", group: "General" } },
  "settings.open": { hotkey: "Mod+,", meta: { name: "Quick settings", group: "General" } },
  "shortcuts.open": { hotkey: "Mod+/", meta: { name: "Keyboard shortcuts", group: "General" } },

  "prompt.focus": { hotkey: "/", meta: { name: "Type in the prompt", group: "Session" } },
  "agent.stop": { hotkey: "Escape", scope: "session", meta: { name: "Stop the agent", description: "while working", group: "Session" } },
  "ask.allow": { hotkey: "Mod+Enter", scope: "session", meta: { name: "Allow", description: "when asked", group: "Session" } },
  "ask.deny": { hotkey: "Mod+Backspace", scope: "session", meta: { name: "Deny", description: "when asked", group: "Session" } },

  "review.next": { hotkey: "N", scope: "review", meta: { name: "Next file", group: "Reviewing changes" } },
  "review.previous": { hotkey: "P", scope: "review", meta: { name: "Previous file", group: "Reviewing changes" } },
  "review.viewed": { hotkey: "V", scope: "review", meta: { name: "Viewed", description: "on and off", group: "Reviewing changes" } },
  "review.layout": { hotkey: "S", scope: "review", meta: { name: "Split / unified", group: "Reviewing changes" } },
  "review.back": { hotkey: "Escape", scope: "review", meta: { name: "Back to the session", group: "Reviewing changes" } },

  "plan.back": { hotkey: "Escape", scope: "plan", meta: { name: "Back from a plan", group: "Plans" } },
});

declare module "@tanstack/react-hotkeys" {
  interface Register {
    appHotkeys: typeof appHotkeys;
  }
}

export const SCOPES = { session: "session", review: "review", plan: "plan", sheet: "shortcuts-sheet" } as const;

/** Keys a focused widget handles itself (the prompt box, a question card): not app shortcuts, but
 * the hints and the shortcuts sheet show them from here too. */
export const PROMPT_KEYS = { send: "Enter", newLine: "Shift+Enter", sendNow: "Mod+Enter", startAndStay: "Mod+Enter" } as const satisfies Record<string, Hotkey>;

/** A plan's editor's own keys (4p4b). */
export const PLAN_EDIT_KEYS = { save: "Mod+S", cancel: "Escape" } as const satisfies Record<string, Hotkey>;

/** What the sheet lists besides the app shortcuts: a hotkey, or literal caps for a range. */
export type SheetRow = { name: string; when?: string; hotkey?: Hotkey; keys?: string[] };

export const LOCAL_ROWS: Array<SheetRow & { group: string }> = [
  { group: "In the prompt", name: "Send", hotkey: PROMPT_KEYS.send },
  { group: "In the prompt", name: "New line", hotkey: PROMPT_KEYS.newLine },
  { group: "In the prompt", name: "Send now", when: "while working", hotkey: PROMPT_KEYS.sendNow },
  { group: "In the prompt", name: "Start, stay on Home", when: "on Home", hotkey: PROMPT_KEYS.startAndStay },
  { group: "Questions", name: "Pick an option", keys: ["1–9"] },
  { group: "Questions", name: "Next / send", hotkey: "Enter" },
  { group: "Questions", name: "Skip", hotkey: "Escape" },
  { group: "Plans", name: "Save your edit", when: "editing a plan", hotkey: PLAN_EDIT_KEYS.save },
  { group: "Plans", name: "Cancel your edit", when: "editing a plan", hotkey: PLAN_EDIT_KEYS.cancel },
];

/** The sheet's order (the design): two columns, filled left to right. */
export const SHEET_GROUPS = ["General", "Session", "In the prompt", "Reviewing changes", "Questions", "Plans"];
