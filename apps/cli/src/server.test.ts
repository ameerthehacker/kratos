import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createClaudeCodeAdapter } from "@kratos/adapter-claude-code";
import { WS_PATH, type ClientMessage, type ServerMessage } from "@kratos/core";
import { memoryLogger } from "./logger.js";
import { SessionHub } from "./session-hub.js";
import { startServer } from "./server.js";
import { SessionStore } from "./store/store.js";
import { Updater } from "./updater/updater.js";

/** The fake `claude` from the adapter's tests: speaks the real control protocol (D30). */
const FAKE_CLAUDE = fileURLToPath(new URL("../../../packages/adapter-claude-code/test/fake-claude.mjs", import.meta.url));

/** A browser tab, played by Node's built-in WebSocket client. */
async function openTab(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
  const messages: ServerMessage[] = [];
  ws.addEventListener("message", (e) => messages.push(JSON.parse(String(e.data))));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  const waitFor = async <T extends ServerMessage>(match: (m: ServerMessage) => m is T): Promise<T> => {
    for (let i = 0; i < 300; i++) {
      const found = messages.find(match);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out; tab got ${JSON.stringify(messages)}`);
  };
  return {
    messages,
    waitFor,
    send: (message: ClientMessage | { type: string }) => ws.send(JSON.stringify(message)),
    close: () => ws.close(),
  };
}

const is = <K extends ServerMessage["type"]>(type: K) => (m: ServerMessage): m is Extract<ServerMessage, { type: K }> =>
  m.type === type;
const turnEnd = (m: ServerMessage): m is Extract<ServerMessage, { type: "agent_event" }> =>
  m.type === "agent_event" && m.event.kind === "turn_end";
/** Message types in order; list updates (sessions: on any status change; harnesses: whenever the
 * agent's models are known) are left out — their timing isn't part of the conversation. */
const summary = (messages: ServerMessage[]) =>
  messages
    .filter((m) => m.type !== "sessions" && m.type !== "harnesses")
    .map((m) => (m.type === "agent_event" ? `agent_event:${m.event.kind}` : m.type));

describe("kratos server", () => {
  it("runs a prompt with a permission round trip over WebSocket, and replays it to a late tab", async () => {
    const cwd = process.cwd();
    const { log, lines, raw } = memoryLogger();
    const hub = new SessionHub(createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }), cwd, SessionStore.open(":memory:"), log);
    // Watch the cleanup paths: closed tabs must leave the hub, server shutdown must stop the agent.
    let disconnects = 0;
    const connect = hub.connect.bind(hub);
    vi.spyOn(hub, "connect").mockImplementation((send) => {
      const tab = connect(send);
      return { ...tab, disconnect: () => (disconnects++, tab.disconnect()) };
    });
    const hubClose = vi.spyOn(hub, "close");
    const server = await startServer({ port: 0, hub, cwd, agent: "Claude Code", log });
    const tab = await openTab(server.port);
    try {
      tab.send({ type: "ping" });
      expect(await tab.waitFor(is("pong"))).toMatchObject({ cwd, agent: "Claude Code", serverVersion: "dev" }); // no version passed: "dev" (3u1)
      const harnesses = await tab.waitFor(is("harnesses")); // the fake CLI's models, via initialize
      expect(harnesses.list[0]).toMatchObject({ id: "claude-code", name: "Claude Code" });
      expect(harnesses.list[0]!.models.map((m) => m.id)).toEqual(["default", "haiku", "claude-opus-4-6", "claude-haiku-4-5"]);

      tab.send({ type: "prompt", text: "ask" }); // the fake asks to Write, then reports our answer
      const ask = await tab.waitFor(is("permission_request"));
      expect(ask.request).toMatchObject({ tool: "Write" });
      tab.send({ type: "permission_decision", id: ask.id, decision: { decision: "allow" } });
      await tab.waitFor(turnEnd);

      const conversation = [
        "user_prompt",
        "agent_event:tool_call",
        "permission_request",
        "permission_resolved",
        "agent_event:tool_result",
        "agent_event:turn_end",
      ];
      // A new session's (empty) replay is complete at once; later messages are new (3d9).
      expect(summary(tab.messages)).toEqual(["session", "session_ready", "pong", ...conversation]);
      expect(tab.messages.find(is("permission_resolved"))).toMatchObject({ id: ask.id, outcome: "allowed" });
      // The server's log tells the same story (D44).
      const logged = (msg: string) => lines.find((l) => l.msg === msg);
      expect(logged("agent started")).toMatchObject({ component: "session", model: "(agent default)", resume: false });
      expect(raw.filter((l) => l.includes('"agent started"'))[0]!.match(/"component"/g)).toHaveLength(1); // no hub+session
      expect(logged("permission asked")).toMatchObject({ ask: ask.id, tool: "Write" });
      expect(logged("permission settled")).toMatchObject({ ask: ask.id, outcome: "allowed" });

      // Browser warnings land in the same log, as component "web".
      tab.send({ type: "client_log", level: "warn", message: "unknown message from server", data: "{oops" });
      await vi.waitFor(() =>
        expect(logged("unknown message from server")).toMatchObject({ level: 40, component: "web", data: "{oops" }),
      );

      const late = await openTab(server.port); // no ping: the replay arrives on connect by itself
      await late.waitFor(turnEnd);
      await late.waitFor(is("session_ready"));
      expect(summary(late.messages)).toEqual(["session", ...conversation, "session_ready"]); // the replay, then "complete"
      late.close();
      await vi.waitFor(() => expect(disconnects).toBe(1));

      tab.send({ type: "no-such-message" });
      expect(await tab.waitFor(is("error"))).toMatchObject({ message: "invalid message" });
    } finally {
      tab.close();
      await server.close();
    }
    expect(hubClose).toHaveBeenCalledOnce();
  });

  it("lists the editors in pong and opens the project in one, reporting failures to the tab (3d3)", async () => {
    const cwd = process.cwd();
    const hub = new SessionHub(createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }), cwd, SessionStore.open(":memory:"));
    const opened: string[] = [];
    const editors = [{ id: "vscode", label: "VS Code" }];
    const openEditor = async (id: string) => {
      if (id !== "vscode") throw new Error(`Unknown editor "${id}"`);
      opened.push(id);
    };
    const server = await startServer({ port: 0, hub, cwd, agent: "Claude Code", editors, openEditor });
    const tab = await openTab(server.port);
    try {
      tab.send({ type: "ping" });
      expect(await tab.waitFor(is("pong"))).toMatchObject({ editors });
      tab.send({ type: "open_in", editor: "vscode" });
      await vi.waitFor(() => expect(opened).toEqual(["vscode"]));
      tab.send({ type: "open_in", editor: "nope" });
      expect(await tab.waitFor(is("error"))).toMatchObject({ message: 'Could not open the project: Unknown editor "nope"' });
      // Icons are served only for detected editors with an app (none here): no other ids, no paths.
      for (const id of ["nope", "vscode", "..%2F..%2Fetc%2Fpasswd"]) {
        expect((await fetch(`http://127.0.0.1:${server.port}/editor-icons/${id}.png`)).status).toBe(404);
      }
    } finally {
      tab.close();
      await server.close();
    }
  });

  it("sends every tab the update status on connect, and again when it changes (3u5)", async () => {
    const cwd = process.cwd();
    const hub = new SessionHub(createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }), cwd, SessionStore.open(":memory:"));
    const release = { tag_name: "v0.2.0", html_url: "https://github.com/ameerthehacker/kratos/releases/tag/v0.2.0", prerelease: false };
    const updater = new Updater("0.1.0", { fetch: (async () => Response.json(release)) as unknown as typeof fetch });
    const server = await startServer({ port: 0, hub, cwd, agent: "Claude Code", updater });
    const tab = await openTab(server.port);
    try {
      expect(await tab.waitFor(is("update"))).toEqual({ type: "update", status: { state: "idle" } });
      await updater.check();
      await vi.waitFor(() =>
        expect(tab.messages.filter(is("update")).at(-1)).toEqual({
          type: "update",
          status: { state: "available", version: "0.2.0", url: release.html_url },
        }),
      );
    } finally {
      tab.close();
      await server.close();
    }
  });

  it("answers app routes (deep links) with the UI, but 404s real missing files", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "kratos-web-"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><div id=root></div>");
    const hub = new SessionHub(createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }), process.cwd(), SessionStore.open(":memory:"));
    const server = await startServer({ port: 0, hub, cwd: process.cwd(), agent: "Claude Code", webRoot });
    const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`);
    try {
      for (const path of ["/", "/s/6f1c2b9e-0d4a-4c1e-9a77-3b1f1f2a9c10", "/anything/else"]) {
        const res = await get(path);
        expect([path, res.status, res.headers.get("content-type")]).toEqual([path, 200, expect.stringContaining("text/html")]);
        expect(await res.text()).toContain('id=root');
      }
      expect((await get("/assets/missing.js")).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("serves a prompt's attachments by id, safely, and only known ids (D55)", async () => {
    const cwd = process.cwd();
    const hub = new SessionHub(createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }), cwd, SessionStore.open(":memory:"));
    const server = await startServer({ port: 0, hub, cwd, agent: "Claude Code" });
    const tab = await openTab(server.port);
    try {
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      tab.send({
        type: "prompt",
        text: "blocks",
        attachments: [
          { name: "red.png", mediaType: "image/png", data: Buffer.from(png).toString("base64") },
          { name: "<b>x</b>.html", mediaType: "text/html", data: Buffer.from("<script>alert(1)</script>").toString("base64") },
        ],
      });
      const prompt = await tab.waitFor(is("user_prompt"));
      await tab.waitFor(turnEnd);
      const [image, page] = prompt.attachments!;
      const url = (id: string) => `http://127.0.0.1:${server.port}/attachments/${id}`;

      const got = await fetch(url(image!.id));
      expect(got.status).toBe(200);
      expect(got.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(png);

      // An HTML file is just text to Kratos: served as plain text, never run as a page.
      const html = await fetch(url(page!.id));
      expect(html.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(html.headers.get("x-content-type-options")).toBe("nosniff");
      expect(html.headers.get("content-security-policy")).toContain("default-src 'none'");

      expect((await fetch(url("6f1c2b9e-0d4a-4c1e-9a77-3b1f1f2a9c10"))).status).toBe(404);
      expect((await fetch(url("..%2F..%2Fkratos.db"))).status).toBe(404);
    } finally {
      tab.close();
      await server.close();
    }
  });
});
