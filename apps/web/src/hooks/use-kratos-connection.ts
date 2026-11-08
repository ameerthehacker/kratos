import { useEffect } from "react";
import { matchPath } from "react-router";
import { ReadyState } from "react-use-websocket";
// CJS-only package: import the named hook from its module file (D11).
import { useWebSocket } from "react-use-websocket/dist/lib/use-websocket";
import { ServerMessage, WS_PATH, type ClientMessage, type ConnectQuery } from "@kratos/core";
import { useKratos } from "@/lib/kratos-store";
import { clientLog } from "@/lib/log";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}`;

/** Read at each (re)connect: on a session's pages, that session (3y6b), so the server shows it
 * straight away instead of the latest one first. Not a value: a new URL would reconnect. */
const wsUrl = () => {
  const session = matchPath("/s/:sessionId/*", location.pathname)?.params.sessionId;
  return session ? `${WS_URL}?${new URLSearchParams({ session } satisfies ConnectQuery)}` : WS_URL;
};

/** Owns the WebSocket to kratos and feeds the store. Mount once (in the layout). */
export function useKratosConnection() {
  const { sendJsonMessage, readyState } = useWebSocket(wsUrl, {
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
    const connected = readyState === ReadyState.OPEN;
    // A new connection announces its session again; the last one's log stays on screen meanwhile.
    useKratos.setState({ connected, send: (m) => sendJsonMessage(m), ...(connected ? {} : { sessionAnnounced: false }) });
  }, [readyState, sendJsonMessage]);
}
