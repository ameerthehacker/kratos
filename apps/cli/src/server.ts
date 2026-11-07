import Fastify, { LogController, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket, { type WebSocket } from "@fastify/websocket";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream } from "node:fs";
import { ClientMessage, WS_PATH, type ServerMessage } from "@kratos/core";
import { editorIcon, openIn, publicEditors, type DetectedEditor } from "./editors.js";
import { silentLogger, type Logger } from "./logger.js";
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
  /** Folder with the built UI (default: apps/web/dist). */
  webRoot?: string;
  /** Kratos's logger (D44); Fastify logs through it as component "http". Default: silent. */
  log?: Logger;
  /** Where the project can be opened (3d3); default none. `open` launches one (tests fake it). */
  editors?: DetectedEditor[];
  openEditor?: (editorId: string) => Promise<void>;
  /** Where converted editor icons are cached (default: no icons served). */
  iconCacheDir?: string;
}) {
  const { hub } = options;
  const log = options.log ?? silentLogger;
  const webLog = log.child({ component: "web" });
  const editors = options.editors ?? [];
  const openEditor = options.openEditor ?? ((id: string) => openIn(id, options.cwd, editors));
  const app = Fastify({ loggerInstance: log.child({ component: "http" }), logController: new QuietRequests() });

  await app.register(fastifyStatic, { root: options.webRoot ?? WEB_DIST });
  await app.register(fastifyWebsocket);

  // Editors' own app icons (3d3): only ids from the detected list, converted once and cached.
  app.get<{ Params: { id: string } }>("/editor-icons/:id.png", async (request, reply) => {
    const editor = editors.find((e) => e.id === request.params.id);
    const png = editor && options.iconCacheDir ? await editorIcon(editor, options.iconCacheDir).catch(() => null) : null;
    if (!png) return reply.code(404).send("Not found");
    return reply.type("image/png").header("cache-control", "max-age=86400").send(createReadStream(png));
  });

  // Files sent with prompts (D55), for thumbnails and previews: by id, only this project's (the hub
  // checks). Never run in the page: text always as plain text, no sniffing, no scripts — images
  // are only png/jpeg/gif/webp (no SVG), and PDFs open in the browser's viewer.
  app.get<{ Params: { id: string } }>("/attachments/:id", async (request, reply) => {
    const file = hub.readAttachment(request.params.id);
    if (!file) return reply.code(404).send("Not found");
    return reply
      .type(file.kind === "text" ? "text/plain; charset=utf-8" : file.mediaType)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
      .header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`)
      .header("cache-control", "private, max-age=31536000, immutable") // ids never change content
      .send(Buffer.from(file.data));
  });

  // App routes like /s/<id> (React Router) aren't files: answer them with the app itself, so deep
  // links and refreshes work. Real missing files (with an extension) still 404.
  app.setNotFoundHandler((request, reply) => {
    const path = new URL(request.url, "http://kratos").pathname;
    if (request.method === "GET" && !extname(path)) return reply.sendFile("index.html");
    return reply.code(404).send("Not found");
  });

  app.get(WS_PATH, { websocket: true }, (socket) => {
    const tab = hub.connect((message) => send(socket, message)); // shows the latest session first
    socket.on("close", tab.disconnect);

    socket.on("message", (raw) => {
      const parsed = ClientMessage.safeParse(safeJson(String(raw)));
      if (!parsed.success) {
        send(socket, { type: "error", message: "invalid message" });
      } else if (parsed.data.type === "ping") {
        send(socket, { type: "pong", at: Date.now(), serverVersion: "0.0.0", cwd: options.cwd, agent: options.agent, editors: publicEditors(editors) });
      } else if (parsed.data.type === "open_in") {
        const editor = parsed.data.editor;
        openEditor(editor).then(
          () => log.info({ editor }, "opened the project in an editor"),
          (err: unknown) => {
            log.warn({ editor, err }, "could not open the project");
            send(socket, { type: "error", message: `Could not open the project: ${err instanceof Error ? err.message : String(err)}` });
          },
        );
      } else if (parsed.data.type === "client_log") {
        const { level, message, data } = parsed.data;
        webLog[level]({ data }, message); // the browser's own warnings, kept with ours (D44)
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

/** Every page load fetches a dozen assets: log requests at debug (file only), not info. */
class QuietRequests extends LogController {
  override incomingRequest(): void {}
  override requestCompleted(error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply): void {
    const line = { method: request.method, url: request.url, statusCode: reply.statusCode, ms: Math.round(reply.elapsedTime) };
    if (error) reply.log.error({ ...line, err: error }, "request errored");
    else reply.log.debug(line, "request");
  }
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
