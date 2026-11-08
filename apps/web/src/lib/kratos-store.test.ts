import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKratos, type LogMessage } from "./kratos-store";

const prompt = (text: string): LogMessage => ({ type: "user_prompt", text });
const receive = (...messages: Parameters<ReturnType<typeof useKratos.getState>["receive"]>[0][]) => {
  for (const message of messages) useKratos.getState().receive(message);
};

describe("a session's replay (3y6a)", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  it("reaches the log in one update, at session_ready", () => {
    const logs: LogMessage[][] = [];
    const stop = useKratos.subscribe((state, before) => state.log !== before.log && logs.push(state.log));
    receive({ type: "session", id: "a" }, prompt("one"), prompt("two"), prompt("three"));
    expect(useKratos.getState().ready).toBe(false);
    expect(useKratos.getState().log).toEqual([]);

    receive({ type: "session_ready", id: "a" });
    stop();
    expect(useKratos.getState().ready).toBe(true);
    expect(logs.slice(1)).toEqual([[prompt("one"), prompt("two"), prompt("three")]]); // [0]: cleared by `session`
  });

  it("appends live messages one at a time after it", () => {
    receive({ type: "session", id: "a" }, prompt("old"), { type: "session_ready", id: "a" }, prompt("new"));
    expect(useKratos.getState().log).toEqual([prompt("old"), prompt("new")]);
  });

  it("drops a replay cut off by opening another session", () => {
    receive({ type: "session", id: "a" }, prompt("from a"), { type: "session", id: "b" }, prompt("from b"));
    receive({ type: "session_ready", id: "a" }); // late, for the session no longer viewed
    expect(useKratos.getState().ready).toBe(false);
    receive({ type: "session_ready", id: "b" });
    expect(useKratos.getState().log).toEqual([prompt("from b")]);
  });
});
