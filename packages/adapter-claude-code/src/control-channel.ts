import { randomUUID } from "node:crypto";
import type { CliMessage } from "./protocol.js";

type Waiting = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout };

/**
 * Kratos's side of the CLI control protocol for requests *we* send (initialize, set_model,
 * interrupt, …; D23, D43): gives each a unique id, matches the CLI's `control_response`, and
 * settles every caller exactly once — on the answer, an error answer, a timeout, or the CLI
 * exiting. (Requests the CLI sends *us*, like can_use_tool, are the adapter's permission gate.)
 */
export class ControlChannel {
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly proc: { send(message: unknown): boolean }) {}

  /** Send a control request; resolves with the CLI's `response` payload. */
  request(body: { subtype: string } & Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<unknown> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = options.timeoutMs
        ? setTimeout(() => this.settle(requestId, new Error(`${body.subtype}: no answer within ${options.timeoutMs}ms`)), options.timeoutMs)
        : undefined;
      this.waiting.set(requestId, { resolve, reject, timer });
      if (!this.proc.send({ type: "control_request", request_id: requestId, request: body })) {
        this.settle(requestId, new Error("claude is not running"));
      }
    });
  }

  /** Pass every CLI message through here; returns true if it was an answer to one of our requests. */
  handle(message: CliMessage): boolean {
    if (message.type !== "control_response") return false;
    const { request_id, subtype, error, response } = message.response;
    this.settle(request_id, subtype === "success" ? undefined : new Error(error ?? "control request failed"), response);
    return true;
  }

  /** The CLI is gone: fail every request still waiting for an answer. */
  close(reason: string): void {
    for (const requestId of [...this.waiting.keys()]) this.settle(requestId, new Error(reason));
  }

  private settle(requestId: string, error?: Error, value?: unknown): void {
    const waiting = this.waiting.get(requestId);
    if (!waiting) return; // unknown, or already settled
    this.waiting.delete(requestId);
    clearTimeout(waiting.timer);
    if (error) waiting.reject(error);
    else waiting.resolve(value);
  }
}
