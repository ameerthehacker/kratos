import { describe, expect, it } from "vitest";
import type { FeatureSummary, SessionSummary } from "@kratos/core";
import { dropFeature, sidebarTree, treeNodes, type SidebarItem, type TreeNode } from "./sidebar-tree";

const session = (id: string, updatedAt: number, more: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  title: id,
  status: "idle",
  updatedAt,
  harness: "fake",
  model: null,
  effort: null,
  permissionMode: null,
  queued: 0,
  done: false,
  featureId: null,
  stepId: null,
  titling: false,
  hasPlan: false,
  ...more,
});
const feature = (id: string, updatedAt: number, done = false, hasPlan = false): FeatureSummary => ({ id, title: id, done, updatedAt, hasPlan });
/** Each row as its id; a folder as `id[its sessions]`. */
const names = (items: SidebarItem[]) => items.map((i) => (i.kind === "session" ? i.session.id : `${i.feature.id}[${i.sessions.map((s) => s.id).join(",")}]`));

describe("sidebarTree (D73)", () => {
  it("puts working folders first, most recently active first, then one-offs in server order", () => {
    const tree = sidebarTree(
      [session("s-new", 50), session("p1", 40, { featureId: "plans" }), session("old", 10), session("w1", 5, { featureId: "worktrees" })],
      [feature("worktrees", 30), feature("plans", 20), feature("empty", 1)],
    );
    // plans' session (40) is newer than worktrees itself (30): activity inside counts
    expect(names(tree.working)).toEqual(["plans[p1]", "worktrees[w1]", "empty[]", "s-new", "old"]);
    expect(tree.done).toEqual([]);
  });

  it("keeps the tree's shape in Done: a feature's done sessions sit in its folder there", () => {
    const tree = sidebarTree(
      [
        session("p-live", 9, { featureId: "plans" }),
        session("p-old", 8, { featureId: "plans", done: true }),
        session("polish-a", 7, { featureId: "polish", done: true }),
        session("polish-b", 6, { featureId: "polish", done: true }),
        session("node", 3, { done: true }),
        session("all-done", 2, { featureId: "quiet", done: true }),
      ],
      [feature("plans", 1), feature("polish", 5, true), feature("quiet", 0)],
    );
    // plans is in both sections; quiet (nothing live) stays in Working, empty there
    expect(names(tree.working)).toEqual(["plans[p-live]", "quiet[]"]);
    // Done, newest first: plans by its done session (8), polish by when it was done (5), …
    expect(names(tree.done)).toEqual(["plans[p-old]", "polish[polish-a,polish-b]", "node", "quiet[all-done]"]);
    const elsewhere = tree.working.map((i) => (i.kind === "feature" ? i.elsewhere : null));
    expect(elsewhere).toEqual([1, 1]);
  });

  it("shows a folder's most urgent status: an ask beats working beats idle; done sessions don't count", () => {
    const status = (sessions: SessionSummary[]) => {
      const folder = sidebarTree(sessions, [feature("f", 0)]).working[0]!;
      return folder.kind === "feature" ? folder.status : undefined;
    };
    const s = (status: SessionSummary["status"], done = false) => session(status, 0, { featureId: "f", status, done });
    expect(status([s("idle"), s("working"), s("needs_answer")])).toBe("needs_answer");
    expect(status([s("working"), s("needs_approval"), s("needs_answer")])).toBe("needs_approval");
    expect(status([s("idle"), s("working", true)])).toBe("idle");
    expect(status([])).toBe("idle");
  });

  it("treats a session whose feature isn't listed as a one-off", () => {
    const tree = sidebarTree([session("lost", 1, { featureId: "gone" })], []);
    expect(names(tree.working)).toEqual(["lost"]);
  });

  it("turns a section into the tree Headless Tree reads, each section's folders with their own ids (D74)", () => {
    const { working, done } = sidebarTree(
      [session("p-live", 9, { featureId: "plans" }), session("p-old", 8, { featureId: "plans", done: true }), session("one-off", 7)],
      [feature("plans", 1), feature("empty", 0)],
    );
    const w = treeNodes(working, "working");
    expect(w.children.get("root")).toEqual(["feature:plans", "feature:empty", "one-off"]);
    expect(w.children.get("feature:plans")).toEqual(["plan:plans", "p-live"]);
    expect(w.nodes.get("empty:empty")).toEqual({ kind: "empty", text: "No sessions yet" });
    expect(w.closedByDefault.size).toBe(0);

    const d = treeNodes(done, "done");
    expect(d.children.get("root")).toEqual(["done-feature:plans"]);
    expect(d.children.get("done-feature:plans")).toEqual(["p-old"]);
    expect(d.nodes.get("done-feature:plans")).toMatchObject({ kind: "feature", inDone: true, count: 1 });
    expect([...d.closedByDefault]).toEqual(["done-feature:plans"]); // Done reads as a flat list

    const allDone = sidebarTree([session("x", 1, { featureId: "plans", done: true })], [feature("plans", 1)]);
    expect(treeNodes(allDone.working, "working").nodes.get("empty:plans")).toEqual({ kind: "empty", text: "Nothing in progress" });
  });

  it("puts a feature's Plan row first, in one place: Working always, a done feature's only with a plan (4p1c)", () => {
    const sessions = [session("live", 3, { featureId: "a" }), session("old", 2, { featureId: "a", done: true }), session("x", 1, { featureId: "c" })];
    const { working, done } = sidebarTree(sessions, [feature("a", 5), feature("b", 4), feature("c", 3, true, true), feature("d", 2, true)]);
    const w = treeNodes(working, "working");
    expect(w.children.get("feature:a")).toEqual(["plan:a", "live"]);
    expect(w.children.get("feature:b")).toEqual(["plan:b", "empty:b"]); // no plan yet: it opens to "Start a plan"
    expect(w.nodes.get("plan:a")).toMatchObject({ kind: "plan", feature: { id: "a" } });
    const d = treeNodes(done, "done");
    expect(d.children.get("done-feature:a")).toEqual(["old"]); // the working feature's plan is in Working
    expect(d.children.get("done-feature:c")).toEqual(["plan:c", "x"]);
    expect(d.children.get("done-feature:d")).toEqual(["empty:d"]); // done, never planned
  });

  it("lands a drop in a working feature, or a one-off only over Working's open space or a one-off's row (4c3)", () => {
    const working: TreeNode = { kind: "feature", feature: feature("plans", 0), count: 1, status: "idle", inDone: false };
    const finished: TreeNode = { kind: "feature", feature: feature("polish", 0, true), count: 1, status: "idle", inDone: true };
    const oneOff: TreeNode = { kind: "session", session: session("x", 0), quiet: false };
    const inFolder: TreeNode = { kind: "session", session: session("p", 0, { featureId: "plans" }), quiet: false };
    const root: TreeNode = { kind: "root" };

    expect(dropFeature(working, { node: working, level: 0 }, "working")).toBe("plans");
    expect(dropFeature(finished, { node: finished, level: 0 }, "done")).toBeUndefined(); // reopen it first
    expect(dropFeature(root, null, "working")).toBeNull(); // open space: a one-off
    expect(dropFeature(root, null, "done")).toBeUndefined(); // not in Done: it would only drop the feature
    expect(dropFeature(root, { node: oneOff, level: 0 }, "working")).toBeNull(); // among the one-offs
    // the folder refused (e.g. its own sessions): Headless Tree falls back to root — not a one-off
    expect(dropFeature(root, { node: inFolder, level: 1 }, "working")).toBeUndefined();
    expect(dropFeature(root, { node: working, level: 0 }, "working")).toBeUndefined();
    expect(dropFeature(oneOff, { node: oneOff, level: 0 }, "working")).toBeUndefined();
  });
});
