import { useEffect, useState } from "react";
import { ReadyState } from "react-use-websocket";
// The package is CJS-only and exposes the hook as `default`, which Vite 8 (Node-style interop)
// hands us as the whole module object. Its named export from the module file works everywhere.
import { useWebSocket } from "react-use-websocket/dist/lib/use-websocket";
import { ServerMessage, WS_PATH, type ClientMessage } from "@kratos/core";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}`;

const STATUS: Record<ReadyState, string> = {
  [ReadyState.CONNECTING]: "connecting",
  [ReadyState.OPEN]: "open",
  [ReadyState.CLOSING]: "closing",
  [ReadyState.CLOSED]: "closed",
  [ReadyState.UNINSTANTIATED]: "idle",
};

export function App() {
  const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket(WS_URL, {
    shouldReconnect: () => true,
  });
  const [log, setLog] = useState<ServerMessage[]>([]);

  useEffect(() => {
    if (lastJsonMessage === null) return;
    const parsed = ServerMessage.safeParse(lastJsonMessage);
    if (parsed.success) setLog((prev) => [...prev, parsed.data]);
    else console.warn("ignoring unknown server message", lastJsonMessage);
  }, [lastJsonMessage]);

  const ping = () => sendJsonMessage({ type: "ping" } satisfies ClientMessage);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 720 }}>
      <h1>Kratos</h1>
      <p>
        Server: <strong>{STATUS[readyState]}</strong>{" "}
        <button onClick={ping} disabled={readyState !== ReadyState.OPEN}>
          Ping
        </button>
      </p>
      <pre style={{ background: "#f4f4f4", padding: 12 }}>
        {log.map((m) => JSON.stringify(m)).join("\n")}
      </pre>
    </main>
  );
}
