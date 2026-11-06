import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket, { type WebSocket } from "@fastify/websocket";
import { fileURLToPath } from "node:url";
import { ClientMessage, WS_PATH, type ServerMessage } from "@kratos/core";

/** Built UI lives in apps/web/dist; this file runs from apps/cli/dist. */
const WEB_DIST = fileURLToPath(new URL("../../web/dist/", import.meta.url));

export async function startServer({ port }: { port: number }) {
  const app = Fastify({ logger: { level: "warn" } });

  await app.register(fastifyStatic, { root: WEB_DIST });
  await app.register(fastifyWebsocket);

  app.get(WS_PATH, { websocket: true }, (socket) => {
    send(socket, { type: "hello", serverVersion: "0.0.0" });

    socket.on("message", (raw) => {
      const parsed = ClientMessage.safeParse(safeJson(String(raw)));
      if (!parsed.success) {
        send(socket, { type: "error", message: "invalid message" });
        return;
      }
      switch (parsed.data.type) {
        case "ping":
          send(socket, { type: "pong", at: Date.now() });
          break;
      }
    });
  });

  await app.listen({ port, host: "127.0.0.1" });
  return { port, close: () => app.close() };
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
