import { useState } from "react";
import { ReadyState } from "react-use-websocket";
// CJS-only package: import the named hook from its module file (D11).
import { useWebSocket } from "react-use-websocket/dist/lib/use-websocket";
import { ServerMessage, WS_PATH, type ClientMessage } from "@kratos/core";

export type ServerInfo = Extract<ServerMessage, { type: "pong" }>;

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}`;

/**
 * The browser's view of kratos: connection state, server info (from pong), and the session log.
 * The server replays the whole log on every (re)connect, so the log restarts empty on open.
 */
export function useKratos() {
  const [log, setLog] = useState<ServerMessage[]>([]);
  const [info, setInfo] = useState<ServerInfo>();

  const { sendJsonMessage, readyState } = useWebSocket(WS_URL, {
    shouldReconnect: () => true,
    reconnectInterval: 1000, // default 5s feels broken after a server restart
    reconnectAttempts: Infinity,
    onOpen: () => {
      setLog([]);
      sendJsonMessage({ type: "ping" } satisfies ClientMessage);
    },
    // onMessage, not lastJsonMessage: the replay arrives in bursts and every message counts.
    onMessage: (event) => {
      const parsed = ServerMessage.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success) return console.warn("kratos: unknown message", event.data);
      const message = parsed.data;
      if (message.type === "pong") setInfo(message);
      else if (message.type === "error") console.warn("kratos:", message.message);
      else setLog((prev) => [...prev, message]);
    },
  });

  return {
    connected: readyState === ReadyState.OPEN,
    info,
    log,
    send: (message: ClientMessage) => sendJsonMessage(message),
  };
}
