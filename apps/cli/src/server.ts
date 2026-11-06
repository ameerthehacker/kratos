import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket, { type WebSocket } from "@fastify/websocket";
import { fileURLToPath } from "node:url";
import { ClientMessage, WS_PATH, type ServerMessage } from "@kratos/core";
import type { SessionHub } from "./session-hub.js";

export const DEFAULT_HOST = "127.0.0.1";

/** Built UI lives in apps/web/dist; this file runs from apps/cli/dist. */
const WEB_DIST = fileURLToPath(new URL("../../web/dist/", import.meta.url));

/** Serves the UI and connects every browser tab (one WebSocket each) to the session hub. */
export async function startServer(options: {
  port: number;
  /** Interface to listen on (D33). Default loopback: anyone who can connect can drive the agent. */
  host?: string;
  hub: SessionHub;
  cwd: string;
  agent: string;
}) {
  const { hub } = options;
  const app = Fastify({ logger: { level: "warn" } });

  await app.register(fastifyStatic, { root: WEB_DIST });
  await app.register(fastifyWebsocket);

  app.get(WS_PATH, { websocket: true }, (socket) => {
    const tab = hub.connect((message) => send(socket, message)); // shows the latest session first
    socket.on("close", tab.disconnect);

    socket.on("message", (raw) => {
      const parsed = ClientMessage.safeParse(safeJson(String(raw)));
      if (!parsed.success) {
        send(socket, { type: "error", message: "invalid message" });
      } else if (parsed.data.type === "ping") {
        send(socket, { type: "pong", at: Date.now(), serverVersion: "0.0.0", cwd: options.cwd, agent: options.agent });
      } else {
        tab.receive(parsed.data);
      }
    });
  });

  await app.listen({ port: options.port, host: options.host ?? DEFAULT_HOST });
  const address = app.server.address();
  return {
    port: typeof address === "object" && address ? address.port : options.port, // real port if 0 was asked
    /** Stop the agent (withdrawing open asks), then the HTTP/WebSocket server. */
    close: async () => {
      await hub.close();
      await app.close();
    },
  };
}

function send(socket: WebSocket, msg: ServerMessage) {
  socket.send(JSON.stringify(msg));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
