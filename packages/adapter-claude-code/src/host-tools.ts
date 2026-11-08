import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { HostTool } from "@kratos/core";

/**
 * Kratos's own tools, served to Claude Code as an in-process ("sdk") MCP server over the control
 * protocol (D77, verified on the real CLI 2.1.308): declared with `--mcp-config` and the
 * `initialize` request; the CLI then sends `mcp_message` control requests carrying JSON-RPC, each
 * answered with `{mcp_response}`. The agent sees each tool as `mcp__kratos__<name>`. The MCP
 * protocol itself (versions, listing, checking input, errors, cancelling) is the official MCP
 * SDK's `McpServer`, as in the Agent SDK; this file only bridges it to the control protocol.
 */
export const HOST_SERVER = "kratos";
export const hostToolName = (name: string) => `mcp__${HOST_SERVER}__${name}`;
export const hostServerConfig = () => JSON.stringify({ mcpServers: { [HOST_SERVER]: { type: "sdk", name: HOST_SERVER } } });

type Id = string | number;

/** The MCP server for one session's tools, answering the CLI's `mcp_message`s. */
export class HostToolServer {
  private readonly waiting = new Map<Id, (reply: JSONRPCMessage) => void>();
  private readonly transport: Transport = {
    start: async () => {},
    close: async () => {},
    // The server's answer to a request: hand it to whoever is waiting for that id.
    // A request of the server's own (it has a `method`) isn't an answer, whatever its id.
    send: async (message) => {
      const id = "id" in message && !("method" in message) ? message.id : undefined;
      if (id !== undefined && id !== null) this.waiting.get(id)?.(message);
    },
  };

  constructor(tools: readonly HostTool[]) {
    const server = new McpServer({ name: HOST_SERVER, version: "1" });
    for (const tool of tools) {
      server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input }, async (input, extra) => {
        const toolUseId = extra._meta?.["claudecode/toolUseId"];
        const toolCallId = typeof toolUseId === "string" ? toolUseId : undefined;
        const out = await tool.call(input as never, { toolCallId, toolName: hostToolName(tool.name), signal: extra.signal });
        return { content: [{ type: "text", text: out.text }], ...(out.isError ? { isError: true } : {}) };
      });
    }
    void server.connect(this.transport);
  }

  /** The answer to one JSON-RPC message. A notification wants none; the control protocol still
   * does, so it gets the SDK's stock one. */
  answer(message: JSONRPCMessage): Promise<JSONRPCMessage> {
    const id = "id" in message ? message.id : undefined;
    if (id === undefined || id === null || !("method" in message)) {
      this.transport.onmessage?.(message);
      return Promise.resolve({ jsonrpc: "2.0", result: {}, id: 0 });
    }
    // Answers are matched by id: a second request with the id of one still running (e.g. a client
    // that reconnected and counts from the start again) would take its answer.
    if (this.waiting.has(id)) {
      return Promise.resolve({ jsonrpc: "2.0", id, error: { code: -32600, message: `Request id ${id} is still in use` } });
    }
    const reply = new Promise<JSONRPCMessage>((resolve) => this.waiting.set(id, resolve));
    this.transport.onmessage?.(message);
    return reply.finally(() => this.waiting.delete(id));
  }

  /** The CLI withdrew a call: MCP's own cancel, so the tool's `signal` aborts. MCP sends no
   * answer to a cancelled request, so its waiting `answer` is settled here (nobody sends it on). */
  cancel(id: Id): void {
    this.transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "withdrawn by the agent" } });
    this.waiting.get(id)?.({ jsonrpc: "2.0", id, error: { code: -32800, message: "Request cancelled" } });
  }
}
