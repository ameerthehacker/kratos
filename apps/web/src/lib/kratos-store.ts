import { create } from "zustand";
import type { ClientMessage, ServerMessage, SessionSummary } from "@kratos/core";

export type ServerInfo = Extract<ServerMessage, { type: "pong" }>;
/** Messages that belong to a session's log (everything the server replays). */
export type LogMessage = Exclude<ServerMessage, { type: "pong" | "error" | "session" | "sessions" }>;

type KratosState = {
  connected: boolean;
  info?: ServerInfo;
  /** All of this project's sessions, newest first, with live status (D41). */
  sessions: SessionSummary[];
  /** The session this tab views, as confirmed by the server, and its log. */
  viewing?: string;
  log: LogMessage[];
  send: (message: ClientMessage) => void;
  /** Apply one message from the server (called by the connection). */
  receive: (message: ServerMessage) => void;
};

/** Kratos UI state (D39): written by useKratosConnection, read by any component. */
export const useKratos = create<KratosState>((set) => ({
  connected: false,
  sessions: [],
  log: [],
  send: () => {},
  receive: (message) => {
    switch (message.type) {
      case "pong":
        return set({ info: message });
      case "session": // a session's replay follows from scratch
        return set({ viewing: message.id, log: [] });
      case "sessions":
        return set({ sessions: message.list });
      case "error":
        return console.warn("kratos:", message.message);
      default:
        return set((state) => ({ log: [...state.log, message] }));
    }
  },
}));
