import { create } from "zustand";
import type { ClientMessage, Harness, ServerMessage, SessionSummary } from "@kratos/core";
import { clientLog } from "@/lib/log";

export type ServerInfo = Extract<ServerMessage, { type: "pong" }>;
/** Messages that belong to a session's log (everything the server replays). */
export type LogMessage = Exclude<ServerMessage, { type: "pong" | "error" | "session" | "sessions" | "harnesses" }>;

type KratosState = {
  connected: boolean;
  info?: ServerInfo;
  /** All of this project's sessions, newest first, with live status (D41). */
  sessions: SessionSummary[];
  /** Harnesses the server can run and their models (D43); empty until the server knows them. */
  harnesses: Harness[];
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
  harnesses: [],
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
      case "harnesses":
        return set({ harnesses: message.list });
      case "error":
        return clientLog("warn", `server error: ${message.message}`);
      default:
        return set((state) => ({ log: [...state.log, message] }));
    }
  },
}));
