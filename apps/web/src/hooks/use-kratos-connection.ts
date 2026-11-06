import { useEffect } from "react";
import { ReadyState } from "react-use-websocket";
// CJS-only package: import the named hook from its module file (D11).
import { useWebSocket } from "react-use-websocket/dist/lib/use-websocket";
import { ServerMessage, WS_PATH, type ClientMessage } from "@kratos/core";
import { useKratos } from "@/lib/kratos-store";
import { clientLog } from "@/lib/log";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}`;

/** Owns the WebSocket to kratos and feeds the store. Mount once (in the layout). */
export function useKratosConnection() {
  const { sendJsonMessage, readyState } = useWebSocket(WS_URL, {
    shouldReconnect: () => true,
    reconnectInterval: 1000, // default 5s feels broken after a server restart
    reconnectAttempts: Infinity,
    onOpen: () => sendJsonMessage({ type: "ping" } satisfies ClientMessage),
    // onMessage, not lastJsonMessage: replays arrive in bursts and every message counts.
    onMessage: (event) => {
      const raw = String(event.data);
      const parsed = ServerMessage.safeParse(JSON.parse(raw));
      if (parsed.success) useKratos.getState().receive(parsed.data);
      else clientLog("warn", "unknown message from server", raw.slice(0, 500));
    },
  });

  useEffect(() => {
    useKratos.setState({ connected: readyState === ReadyState.OPEN, send: (m) => sendJsonMessage(m) });
  }, [readyState, sendJsonMessage]);
}
