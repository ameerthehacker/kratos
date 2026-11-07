import { create } from "zustand";
import type { ClientMessage, Harness, ServerMessage, SessionSummary, UpdateStatus } from "@kratos/core";
import { clientLog } from "@/lib/log";

export type ServerInfo = Extract<ServerMessage, { type: "pong" }>;
/** Messages that belong to a session's log (everything the server replays). */
export type LogMessage = Exclude<ServerMessage, { type: "pong" | "error" | "session" | "session_ready" | "sessions" | "harnesses" | "prompts_returned" | "update" }>;

type KratosState = {
  connected: boolean;
  info?: ServerInfo;
  /** All of this project's sessions, newest first, with live status (D41). */
  sessions: SessionSummary[];
  /** Harnesses the server can run and their models (D43); empty until the server knows them. */
  harnesses: Harness[];
  /** The session this tab views, as confirmed by the server, and its log. */
  viewing?: string;
  /** Its replay is complete (the server said `session_ready`): the log holds its whole history. */
  ready: boolean;
  /** Text of queued prompts that Stop dropped, for this tab's composer (D56); the composer takes it. */
  returned?: string;
  /** Kratos's own update status (3u5); shown by the UI in 3u5d. */
  update?: UpdateStatus;
  log: LogMessage[];
  send: (message: ClientMessage) => void;
  /** Apply one message from the server (called by the connection). */
  receive: (message: ServerMessage) => void;
};

/** Kratos UI state (D39): written by useKratosConnection, read by any component. */
export const useKratos = create<KratosState>((set) => ({
  connected: false,
  sessions: [],
  harnesses: [],
  log: [],
  ready: false,
  send: () => {},
  receive: (message) => {
    switch (message.type) {
      case "pong":
        return set({ info: message });
      case "session": // a session's replay follows from scratch
        return set({ viewing: message.id, log: [], ready: false });
      case "session_ready":
        return set((state) => (state.viewing === message.id ? { ready: true } : {}));
      case "sessions":
        return set({ sessions: message.list });
      case "harnesses":
        return set({ harnesses: message.list });
      case "prompts_returned": // not part of the log: this tab's own, for its composer
        return set({ returned: message.text });
      case "update":
        return set({ update: message.status });
      case "error":
        return clientLog("warn", `server error: ${message.message}`);
      default:
        return set((state) => ({ log: [...state.log, message] }));
    }
  },
}));
