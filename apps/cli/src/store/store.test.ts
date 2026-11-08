import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@kratos/core";
import { SessionStore } from "./store.js";

let dir: string;
let dbPath: string;
const open: SessionStore[] = [];
const openStore = () => {
  const store = SessionStore.open(dbPath);
  open.push(store);
  return store;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kratos-store-"));
  dbPath = join(dir, "nested", "kratos.db"); // folder doesn't exist yet: open() must create it
  vi.useFakeTimers({ toFake: ["Date"] }); // deterministic "latest" ordering
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  for (const store of open.splice(0)) store.close();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});
const later = () => vi.setSystemTime(Date.now() + 1000);

const prompt = (text: string): ServerMessage => ({ type: "user_prompt", text });

describe("SessionStore", () => {
  it("creates the folder and file, and runs the migrations", () => {
    const store = openStore();
    expect(existsSync(dbPath)).toBe(true);
    expect(store.latestOrCreate("/proj", "Claude Code")).toMatchObject({ projectDir: "/proj", agentStartedAt: null });
  });

  it("returns a project's latest active session, creating one only when there is none", () => {
    const store = openStore();
    const first = store.latestOrCreate("/proj/a", "Claude Code");
    expect(store.latestOrCreate("/proj/a", "Claude Code").id).toBe(first.id);
    expect(store.latestOrCreate("/proj/b", "Claude Code").id).not.toBe(first.id);

    later();
    const second = store.create("/proj/a", "Claude Code");
    expect(store.latestOrCreate("/proj/a", "Claude Code").id).toBe(second.id);

    later();
    store.append(first.id, prompt("back to the first one")); // activity makes it latest again
    expect(store.latestOrCreate("/proj/a", "Claude Code").id).toBe(first.id);
  });

  it("appends and loads each session's log in order, kept separate per session", () => {
    const store = openStore();
    const a = store.create("/proj", "Claude Code");
    const b = store.create("/proj", "Claude Code");
    const event: ServerMessage = { type: "agent_event", event: { kind: "text", text: "hi" } };

    store.append(a.id, prompt("one"));
    store.append(b.id, prompt("other session"));
    store.append(a.id, event);
    store.append(a.id, prompt("two"));

    expect(store.load(a.id)).toEqual([prompt("one"), event, prompt("two")]);
    expect(store.load(b.id)).toEqual([prompt("other session")]);
  });

  it("keeps sessions, logs and the agent-started mark across a reopen", () => {
    const store = openStore();
    const session = store.latestOrCreate("/proj", "Claude Code");
    store.append(session.id, prompt("remember me"));
    store.markAgentStarted(session.id);
    const startedAt = store.latestOrCreate("/proj", "Claude Code").agentStartedAt;
    later();
    store.markAgentStarted(session.id); // idempotent: keeps the first start time
    store.close();
    open.length = 0;

    const reopened = openStore(); // migrations run again: must be a no-op
    const again = reopened.latestOrCreate("/proj", "Claude Code");
    expect(again.id).toBe(session.id);
    expect(again.agentStartedAt).toEqual(startedAt);
    expect(startedAt).not.toBeNull();
    expect(reopened.load(session.id)).toEqual([prompt("remember me")]);
  });

  it("lists a project's sessions newest first (ties → later created), with first-prompt titles", () => {
    const store = openStore();
    const a = store.create("/proj", "Claude Code");
    const b = store.create("/proj", "Claude Code"); // same millisecond as `a` (fake clock)
    store.create("/other", "Claude Code");
    expect(store.list("/proj").map((s) => s.id)).toEqual([b.id, a.id]);
    expect(store.latestOrCreate("/proj", "Claude Code").id).toBe(b.id);

    store.setTitle(a.id, "first prompt");
    store.setTitle(a.id, "second prompt"); // only the first one sticks
    expect(store.get(a.id)?.title).toBe("first prompt");
    expect(store.get("missing")).toBeUndefined();

    later();
    store.append(a.id, prompt("activity")); // activity moves it to the top
    expect(store.list("/proj").map((s) => s.id)).toEqual([a.id, b.id]);
  });

  it("keeps a project's features newest first; joining, done and reopen move a feature up (D73)", () => {
    const store = openStore();
    const a = store.createFeature("/proj", "Plans");
    later();
    const b = store.createFeature("/proj", "Worktrees");
    store.createFeature("/other", "Elsewhere");
    expect(store.listFeatures("/proj").map((f) => f.title)).toEqual(["Worktrees", "Plans"]);

    const session = store.create("/proj", "Claude Code");
    later();
    store.setSessionFeature(session.id, a.id); // a session joining moves the feature up…
    expect(store.get(session.id)?.featureId).toBe(a.id);
    expect(store.listFeatures("/proj").map((f) => f.id)).toEqual([a.id, b.id]);
    expect(store.get(session.id)?.updatedAt).toEqual(session.updatedAt); // …not the session

    later();
    store.setFeatureDone(b.id, true);
    expect(store.getFeature(b.id)?.doneAt).not.toBeNull();
    expect(store.listFeatures("/proj")[0]?.id).toBe(b.id); // Done is newest first
    store.setFeatureDone(b.id, false);
    expect(store.getFeature(b.id)?.doneAt).toBeNull();

    store.setSessionFeature(session.id, null); // back to a one-off
    expect(store.get(session.id)?.featureId).toBeNull();
    expect(store.getFeature("missing")).toBeUndefined();
  });

  it("refuses a session in a feature that doesn't exist (foreign key)", () => {
    const store = openStore();
    const session = store.create("/proj", "Claude Code");
    expect(() => store.setSessionFeature(session.id, "missing")).toThrow(/FOREIGN KEY/);
  });
});
