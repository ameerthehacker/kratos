import type { FeatureSummary, SessionSummary } from "@kratos/core";

/** A row of a sidebar section (D73): a feature's folder holding that section's sessions of it, or
 * a one-off session. A feature with live and done sessions has a folder in each section (owner:
 * Done keeps the shape Working had). `status`: the most urgent of `sessions`, for when the folder
 * is closed; `elsewhere`: how many of its sessions are in the other section. */
export type SidebarItem =
  | { kind: "feature"; feature: FeatureSummary; sessions: SessionSummary[]; status: SessionSummary["status"]; elsewhere: number }
  | { kind: "session"; session: SessionSummary };

/** Most urgent first: a closed folder shows the first of these any of its sessions has. */
const URGENCY: SessionSummary["status"][] = ["needs_approval", "needs_answer", "working", "idle"];

/**
 * The sidebar's two sections from the session and feature lists (both newest first, as the
 * server sends them). Working: every working feature's folder with its live sessions — most
 * recently active first, the empty ones too — then live one-offs. Done: a folder for each done
 * feature (all its sessions) and for each working one with done sessions (those), and done
 * one-offs; newest first. A session whose feature isn't in the list counts as a one-off.
 */
export function sidebarTree(sessions: readonly SessionSummary[], features: readonly FeatureSummary[]): { working: SidebarItem[]; done: SidebarItem[] } {
  const byFeature = new Map(features.map((feature) => [feature.id, [] as SessionSummary[]]));
  const oneOffs: SessionSummary[] = [];
  for (const session of sessions) (byFeature.get(session.featureId ?? "") ?? oneOffs).push(session);

  type Ranked = { item: SidebarItem; active: number };
  const working: Ranked[] = [];
  const done: Ranked[] = [];
  const folder = (feature: FeatureSummary, shown: SessionSummary[], elsewhere: number): SidebarItem => ({
    kind: "feature",
    feature,
    sessions: shown,
    status: URGENCY.find((u) => shown.some((s) => s.status === u)) ?? "idle",
    elsewhere,
  });
  const latest = (list: SessionSummary[]) => Math.max(0, ...list.map((s) => s.updatedAt));
  for (const feature of features) {
    const all = byFeature.get(feature.id)!;
    if (feature.done) {
      done.push({ item: folder(feature, all, 0), active: feature.updatedAt });
      continue;
    }
    const live = all.filter((s) => !s.done);
    const finished = all.filter((s) => s.done);
    working.push({ item: folder(feature, live, finished.length), active: Math.max(feature.updatedAt, latest(all)) });
    if (finished.length > 0) done.push({ item: folder(feature, finished, live.length), active: latest(finished) });
  }
  const newestFirst = (a: Ranked, b: Ranked) => b.active - a.active;
  const session = (s: SessionSummary): Ranked => ({ item: { kind: "session", session: s }, active: s.updatedAt });

  return {
    working: [...working.sort(newestFirst), ...oneOffs.filter((s) => !s.done).map(session)].map((r) => r.item),
    done: [...done, ...oneOffs.filter((s) => s.done).map(session)].sort(newestFirst).map((r) => r.item),
  };
}

/** A node of a sidebar section's tree (Headless Tree, D74): a feature's folder, a session, or the
 * line an empty folder shows. `inDone`: the folder is in the Done section. */
export type TreeNode =
  | { kind: "root" }
  | { kind: "feature"; feature: FeatureSummary; count: number; status: SessionSummary["status"]; inDone: boolean }
  | { kind: "session"; session: SessionSummary; quiet: boolean }
  | { kind: "empty"; text: string };

/**
 * A section's rows as the tree Headless Tree reads: every node by id, and each node's children
 * (root's are the section's rows). A folder's id is also its key in the sidebar prefs (open /
 * closed is remembered by it), so one feature's folders in Working and Done each have their own.
 * `closedByDefault`: Done's folders, so Done reads as a flat list until you open one.
 */
export function treeNodes(
  items: readonly SidebarItem[],
  section: "working" | "done",
): { nodes: Map<string, TreeNode>; children: Map<string, string[]>; closedByDefault: Set<string> } {
  const nodes = new Map<string, TreeNode>([["root", { kind: "root" }]]);
  const children = new Map<string, string[]>([["root", []]]);
  const closedByDefault = new Set<string>();
  const inDone = section === "done";
  const add = (parent: string, id: string, node: TreeNode) => {
    nodes.set(id, node);
    children.get(parent)!.push(id);
  };
  for (const item of items) {
    if (item.kind === "session") {
      add("root", item.session.id, { kind: "session", session: item.session, quiet: false });
      continue;
    }
    const { feature, sessions, status, elsewhere } = item;
    const id = `${inDone ? "done-feature" : "feature"}:${feature.id}`;
    add("root", id, { kind: "feature", feature, count: sessions.length, status, inDone });
    children.set(id, []);
    if (inDone) closedByDefault.add(id);
    for (const s of sessions) add(id, s.id, { kind: "session", session: s, quiet: feature.done });
    if (sessions.length === 0) add(id, `empty:${feature.id}`, { kind: "empty", text: elsewhere > 0 ? "Nothing in progress" : "No sessions yet" });
  }
  return { nodes, children, closedByDefault };
}

/**
 * Where sessions dropped on a section's tree land (4c3): a working feature's id, or null (a
 * one-off) — only for the section's open space or a one-off's row; undefined where nothing may
 * land. `hovered`: the row the drag is over (null: open space). A folder that won't take the drop
 * (done, or where the sessions already are) makes Headless Tree fall back to the section itself;
 * that mustn't turn into "make it a one-off" while you're over a folder's rows.
 */
export function dropFeature(target: TreeNode, hovered: { node: TreeNode; level: number } | null): string | null | undefined {
  if (target.kind === "feature") return target.feature.done ? undefined : target.feature.id;
  if (target.kind !== "root") return undefined;
  return hovered === null || (hovered.level === 0 && hovered.node.kind === "session") ? null : undefined;
}
