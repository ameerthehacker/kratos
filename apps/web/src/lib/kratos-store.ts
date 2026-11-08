import { create } from "zustand";
import type { ClientMessage, Harness, ServerMessage, SessionSummary, Settings, UpdateStatus } from "@kratos/core";
import { clientLog } from "@/lib/log";

export type ServerInfo = Extract<ServerMessage, { type: "pong" }>;
/** What a session changed, as the server last said (3v1). */
export type Changes = Extract<ServerMessage, { type: "changes" }>;
/** Messages that belong to a session's log (everything the server replays). */
export type LogMessage = Exclude<ServerMessage, { type: "pong" | "error" | "session" | "session_ready" | "sessions" | "harnesses" | "prompts_returned" | "update" | "settings" | "changes" | "viewed" }>;

type KratosState = {
  connected: boolean;
  info?: ServerInfo;
  /** All of this project's sessions, newest first, with live status (D41). */
  sessions: SessionSummary[];
  /** Harnesses the server can run and their models (D43); empty until the server knows them. */
  harnesses: Harness[];
  /** The session this tab views, as confirmed by the server, and its log. */
  viewing?: string;
  /** The server has announced (with `session`) which session it shows this connection. Until it
   * has, the tab can't tell whether it shows the wrong one, so it doesn't ask for its own: that
   * asked twice on every connect (3y6b). */
  sessionAnnounced: boolean;
  /** Its replay is complete (the server said `session_ready`): the log holds its whole history. */
  ready: boolean;
  /** Text of queued prompts that Stop dropped, for this tab's composer (D56); the composer takes it. */
  returned?: string;
  /** Kratos's own update status (3u5); shown by the UI in 3u5d. */
  update?: UpdateStatus;
  /** The owner's settings (3w), as Kratos keeps them; until the server says, none. */
  settings?: Settings;
  log: LogMessage[];
  /** Each session's changes, by id, as last asked for with `get_changes` (3v2). */
  changes: Record<string, Changes>;
  /** Each session's files marked viewed in review: path → the version viewed (3v3). */
  viewed: Record<string, Record<string, string>>;
  /** Mark a file viewed or not: shown at once, then saved by Kratos, which tells every tab. */
  setViewed: (sessionId: string, path: string, version: string, viewed: boolean) => void;
  send: (message: ClientMessage) => void;
  /** Apply one message from the server (called by the connection). */
  receive: (message: ServerMessage) => void;
};

/** A session's replay as it arrives (D69): held here until `session_ready`, then put in the store in
 * one update. One update per message rebuilt the whole chat once per message: 1.3 s of blank
 * screen for a 957-message session (3y6a). */
let replay: LogMessage[] = [];

/** Kratos UI state (D39): written by useKratosConnection, read by any component. */
export const useKratos = create<KratosState>((set, get) => ({
  connected: false,
  sessions: [],
  harnesses: [],
  log: [],
  changes: {},
  viewed: {},
  ready: false,
  sessionAnnounced: false,
  send: () => {},
  setViewed: (sessionId, path, version, viewed) => {
    set((state) => {
      const { [path]: _, ...others } = state.viewed[sessionId] ?? {};
      return { viewed: { ...state.viewed, [sessionId]: viewed ? { ...others, [path]: version } : others } };
    });
    get().send({ type: "set_viewed", sessionId, path, version, viewed });
  },
  receive: (message) => {
    switch (message.type) {
      case "pong": {
        // Reconnected to another Kratos version (an update, a brew upgrade): this page is that
        // old version's code and can't read the new messages, so load the new one (3u8).
        // Releases only: a source run's version is its commit, and reloading on every commit would
        // lose drafts in tabs Vite keeps current anyway.
        const shown = useKratos.getState().info?.serverVersion;
        const release = (v?: string) => !!v && /^\d+\.\d+\.\d+/.test(v);
        if (release(shown) && release(message.serverVersion) && shown !== message.serverVersion) return location.reload();
        return set({ info: message });
      }
      case "session": // a session's replay follows from scratch
        replay = [];
        performance.clearMarks("kratos:open");
        performance.clearMeasures("kratos:replay");
        performance.clearMeasures("kratos:drawn");
        performance.mark("kratos:open"); // `session drawn` in pages/session.tsx measures from here
        return set({ viewing: message.id, sessionAnnounced: true, log: [], ready: false });
      case "session_ready": {
        if (get().viewing !== message.id) return;
        const { duration } = performance.measure("kratos:replay", "kratos:open");
        clientLog("debug", "session replayed", { messages: replay.length, ms: Math.round(duration) });
        set({ log: replay, ready: true });
        replay = [];
        return;
      }
      case "sessions":
        return set({ sessions: message.list });
      case "harnesses":
        return set({ harnesses: message.list });
      case "prompts_returned": // not part of the log: this tab's own, for its composer
        return set({ returned: message.text });
      case "update":
        return set({ update: message.status });
      case "settings":
        return set({ settings: message.settings });
      case "changes": // a reply to this tab's get_changes, not part of the log
        return set((state) => ({ changes: { ...state.changes, [message.sessionId]: message } }));
      case "viewed": // after `changes`, and whenever any tab marks a file (3v3)
        return set((state) => ({ viewed: { ...state.viewed, [message.sessionId]: message.files } }));
      case "error":
        return clientLog("warn", `server error: ${message.message}`);
      default:
        if (!get().ready) return void replay.push(message); // part of a replay: in at `session_ready`
        return set((state) => ({ log: [...state.log, message] }));
    }
  },
}));
