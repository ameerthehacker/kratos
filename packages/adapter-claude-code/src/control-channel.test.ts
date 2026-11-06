import { describe, expect, it } from "vitest";
import { ControlChannel } from "./control-channel.js";

/** Captures what the channel sends; `running: false` simulates a dead CLI. */
function fakeProc(running = true) {
  const sent: Array<{ request_id: string; request: { subtype: string } }> = [];
  return { sent, send: (m: unknown) => (running && sent.push(m as (typeof sent)[number]), running) };
}
const answer = (request_id: string, subtype: string, extra: object = {}) => ({
  type: "control_response" as const,
  response: { request_id, subtype, ...extra },
});

describe("ControlChannel", () => {
  it("sends a numbered request and resolves with the matching answer's payload", async () => {
    const proc = fakeProc();
    const control = new ControlChannel(proc);
    const first = control.request({ subtype: "initialize" });
    const second = control.request({ subtype: "set_model", model: "haiku" });
    const [a, b] = proc.sent;
    expect(a!.request).toEqual({ subtype: "initialize" });
    expect(a!.request_id).not.toBe(b!.request_id);

    expect(control.handle(answer(b!.request_id, "success", { response: { ok: 2 } }))).toBe(true);
    expect(control.handle(answer(a!.request_id, "success", { response: { ok: 1 } }))).toBe(true);
    await expect(first).resolves.toEqual({ ok: 1 }); // answers may arrive in any order
    await expect(second).resolves.toEqual({ ok: 2 });
  });

  it("rejects on an error answer; ignores answers it isn't waiting for and other messages", async () => {
    const proc = fakeProc();
    const control = new ControlChannel(proc);
    const req = control.request({ subtype: "set_model", model: "nope" });
    expect(control.handle(answer("someone-else", "success"))).toBe(true);
    expect(control.handle({ type: "result", subtype: "success" })).toBe(false);
    control.handle(answer(proc.sent[0]!.request_id, "error", { error: "unknown model" }));
    await expect(req).rejects.toThrow("unknown model");
  });

  it("rejects after its timeout, and when the CLI is gone (before or after sending)", async () => {
    const control = new ControlChannel(fakeProc());
    await expect(control.request({ subtype: "initialize" }, { timeoutMs: 20 })).rejects.toThrow("initialize: no answer within 20ms");

    const waiting = control.request({ subtype: "set_model", model: "haiku" });
    control.close("claude exited");
    await expect(waiting).rejects.toThrow("claude exited");

    await expect(new ControlChannel(fakeProc(false)).request({ subtype: "interrupt" })).rejects.toThrow("claude is not running");
  });
});
