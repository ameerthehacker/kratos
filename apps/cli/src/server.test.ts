import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createClaudeCodeAdapter } from "@kratos/adapter-claude-code";
import { WS_PATH, type ClientMessage, type ServerMessage } from "@kratos/core";
import { SessionHub } from "./session-hub.js";
import { startServer } from "./server.js";
import { SessionStore } from "./store/store.js";

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
/** Message types in order; session-list updates (sent whenever a status changes) left out. */
const summary = (messages: ServerMessage[]) =>
  messages.filter((m) => m.type !== "sessions").map((m) => (m.type === "agent_event" ? `agent_event:${m.event.kind}` : m.type));

describe("kratos server", () => {
  it("runs a prompt with a permission round trip over WebSocket, and replays it to a late tab", async () => {
    const cwd = process.cwd();
    const hub = new SessionHub(createClaudeCodeAdapter({ claudePath: FAKE_CLAUDE }), cwd, SessionStore.open(":memory:"));
    // Watch the cleanup paths: closed tabs must leave the hub, server shutdown must stop the agent.
    let disconnects = 0;
    const connect = hub.connect.bind(hub);
    vi.spyOn(hub, "connect").mockImplementation((send) => {
      const tab = connect(send);
      return { ...tab, disconnect: () => (disconnects++, tab.disconnect()) };
    });
    const hubClose = vi.spyOn(hub, "close");
    const server = await startServer({ port: 0, hub, cwd, agent: "Claude Code" });
    const tab = await openTab(server.port);
    try {
      tab.send({ type: "ping" });
      expect(await tab.waitFor(is("pong"))).toMatchObject({ cwd, agent: "Claude Code", serverVersion: "0.0.0" });

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
      expect(summary(tab.messages)).toEqual(["session", "pong", ...conversation]);
      expect(tab.messages.find(is("permission_resolved"))).toMatchObject({ id: ask.id, outcome: "allowed" });

      const late = await openTab(server.port); // no ping: the replay arrives on connect by itself
      await late.waitFor(turnEnd);
      expect(summary(late.messages)).toEqual(["session", ...conversation]);
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
});
