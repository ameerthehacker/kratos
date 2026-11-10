import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import {
  dragAndDropFeature,
  hotkeysCoreFeature,
  renamingFeature,
  syncDataLoaderFeature,
  type DragTarget,
  type ItemInstance,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { ChevronRight, ListTodo, Map as MapIcon, Package, PackageCheck, PackagePlus, PanelLeft, Pencil, Plus } from "lucide-react";
import type { FeatureSummary, SessionSummary } from "@kratos/core";
import { DoneButton } from "@/components/done-button";
import { FeatureDoneButton } from "@/components/feature-done-button";
import { NameField } from "@/components/name-field";
import { SessionTitle } from "@/components/session-title";
import { SessionStatus, StatusDot, sessionTitle, statusLabel } from "@/components/session-status";
import { Hint, Shortcut } from "@/components/shortcut";
import { useKratos } from "@/lib/kratos-store";
import { useSidebarPrefs } from "@/lib/sidebar-prefs";
import { dropFeature, sidebarTree, treeNodes, type SidebarItem, type TreeNode } from "@/lib/sidebar-tree";
import { cn } from "@/lib/utils";
import type { PlanFrom } from "@/pages/plan";

/** Shows or hides the sidebar: in its own header when open, in the main header when closed (3d4). */
export function SidebarToggle({ className }: { className?: string }) {
  const open = useSidebarPrefs((s) => s.open);
  const setOpen = useSidebarPrefs((s) => s.setOpen);
  const label = open ? "Hide sessions" : "Show sessions";
  return (
    <Hint label={label} id="sidebar.toggle">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={label}
        aria-expanded={open}
        className={cn("flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground", className)}
      >
        <PanelLeft className="size-4.5" />
      </button>
    </Hint>
  );
}

/** The owner's collapsible sessions sidebar (D41), an island on the canvas: every session with
 * its live status, one-offs as rows and features as folders of them (D73). Closed, it's gone
 * entirely, like the design (3d4). */
export function SessionsSidebar() {
  const open = useSidebarPrefs((s) => s.open);
  const sessions = useKratos((s) => s.sessions);
  const features = useKratos((s) => s.features);
  const tree = useMemo(() => sidebarTree(sessions, features), [sessions, features]);
  const [naming, setNaming] = useState(false);
  const send = useKratos((s) => s.send);
  const setCollapsed = useSidebarPrefs((s) => s.setCollapsed);
  if (!open) return null;

  return (
    <aside aria-label="Sessions" className="flex w-68 flex-none flex-col gap-1 rounded-3xl bg-background p-2.5">
      <div className="flex h-11 items-center gap-2 pl-2.5">
        <span className="flex-1 text-sm font-medium">Sessions</span>
        <SidebarToggle />
      </div>
      <Link to="/" className="group mt-1 mb-4 flex h-10 items-center gap-2.5 rounded-lg bg-secondary pr-2 pl-2.5 text-sm hover:bg-accent">
        <Plus className="size-4.5" />
        <span className="flex-1">New session</span>
        {/* Its keys on hover only (the design): the everyday look stays plain. */}
        <Shortcut id="session.new" variant="secondary" className="invisible group-hover:visible group-focus-visible:visible" />
      </Link>
      {/* Two sections (owner, 3d2): what's being worked on, and what's done. Done is pinned to
          the bottom — it needs the least attention (owner, 3d8); each scrolls on its own, Done
          taking at most half the height. Working always shows: it holds the New feature button.
          Working counts live sessions, folders' too (how much is in flight); Done counts rows. */}
      <nav className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Section
            grow
            label="Working"
            count={tree.working.reduce((n, item) => n + (item.kind === "session" ? 1 : item.sessions.length), 0)}
            always
            action={
              <button
                type="button"
                onClick={() => {
                  setCollapsed("Working", false); // the name field lives inside the section
                  setNaming(true);
                }}
                aria-label="New feature"
                title="New feature"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <PackagePlus className="size-3.5" />
              </button>
            }
          >
            {naming && (
              <NameField
                icon={Package}
                placeholder="Name the feature"
                onDone={(title) => {
                  setNaming(false);
                  if (title) send({ type: "create_feature", title });
                }}
                className="flex items-center gap-2 rounded-lg bg-secondary py-1 pr-2 pl-2.5"
                iconClassName="size-4 text-muted-foreground"
                inputClassName="h-7 text-sm"
              />
            )}
            <SectionTree label="Working" items={tree.working} />
          </Section>
        </div>
        <div className="max-h-1/2 shrink-0 overflow-y-auto">
          <Section label="Done" count={tree.done.length}>
            <SectionTree label="Done" items={tree.done} />
          </Section>
        </div>
      </nav>
    </aside>
  );
}

/** A titled, collapsible section (3d2). Hidden while empty, unless `always`. */
/** `grow`: fill the space below its rows (Working: room to drop a session out of a feature, 4c3). */
function Section(props: { label: string; count: number; always?: boolean; grow?: boolean; action?: ReactNode; children: ReactNode }) {
  const { label, count, always, action, children } = props;
  const collapsed = useSidebarPrefs((s) => s.collapsed[label] ?? false);
  const toggle = useSidebarPrefs((s) => s.toggle);
  if (count === 0 && !always) return null;
  return (
    <section aria-label={label} className={cn("flex flex-col gap-0.5", props.grow && "flex-1")}>
      <h2 className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => toggle(label)}
          aria-expanded={!collapsed}
          className="flex flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")} aria-hidden="true" />
          {label}
          <span className="font-mono text-faint">{count}</span>
        </button>
        {action}
      </h2>
      {!collapsed && children}
    </section>
  );
}

const nodeName = (node: TreeNode) =>
  node.kind === "feature" ? node.feature.title : node.kind === "session" ? sessionTitle(node.session) : node.kind === "empty" ? node.text : node.kind === "plan" ? "Plan" : "";

/** Where a plan link is opened from, by name, so the plan page's way back says it (4p1c, board §8:
 * "← Filters in the export"). */
function usePlanFrom(): PlanFrom {
  const { pathname, search, state } = useLocation();
  const sessionId = /^\/s\/([^/]+)$/.exec(pathname)?.[1];
  const session = useKratos((s) => (sessionId ? s.sessions.find((x) => x.id === sessionId) : undefined));
  // From one plan to another: keep the first one's way back, not a loop between plans.
  if (pathname.endsWith("/plan")) return (state ?? {}) as PlanFrom;
  const label = pathname === "/" ? "Home" : session ? sessionTitle(session) : pathname.endsWith("/review") ? "Review changes" : "Back";
  return { from: pathname + search, label };
}

/**
 * A section's rows as an accessible tree (Headless Tree, D74): folders open and close by click or
 * ←/→, ↑/↓ move between rows, Enter opens a session or a folder, F2 or a double-click renames a
 * feature, and a session dragged onto a feature moves there (4c3; onto open space: a one-off).
 * Which folders are open is ours: remembered in the sidebar prefs, Working's open and Done's
 * closed until you open them.
 */
function SectionTree({ label, items }: { label: string; items: SidebarItem[] }) {
  const send = useKratos((s) => s.send);
  const { nodes, children, closedByDefault } = useMemo(() => treeNodes(items, label === "Done" ? "done" : "working"), [items, label]);
  const collapsed = useSidebarPrefs((s) => s.collapsed);
  const setCollapsed = useSidebarPrefs((s) => s.setCollapsed);
  const navigate = useNavigate();
  const from = usePlanFrom();
  const folders = useMemo(() => [...children.keys()].filter((id) => id !== "root"), [children]);
  const isClosed = (id: string) => collapsed[id] ?? closedByDefault.has(id);
  // Same array until a folder opens or closes: Headless Tree compares it by identity, and a new
  // one on every render makes it update its state during render, forever.
  const expandedKey = folders.filter((id) => !isClosed(id)).join("\n");
  const expandedItems = useMemo(() => (expandedKey ? expandedKey.split("\n") : []), [expandedKey]);

  // Dragging sessions (4c3). `hovered`: the row the drag is over, null over open space — where a
  // drop may land depends on it (`dropFeature`). Working and Done are separate trees: a drag from
  // the other one arrives as a "foreign" drag carrying the session ids.
  const hovered = useRef<{ node: TreeNode; level: number } | null>(null);
  const land = (target: DragTarget<TreeNode>) => dropFeature(target.item.getItemData(), hovered.current, label === "Done" ? "done" : "working");
  const dragged = (items: ItemInstance<TreeNode>[]) => items.flatMap((i) => (i.getItemData().kind === "session" ? [(i.getItemData() as { session: SessionSummary }).session] : []));
  const move = (sessions: SessionSummary[], featureId: string | null) => {
    for (const s of sessions) if (s.featureId !== featureId) send({ type: "set_session_feature", sessionId: s.id, featureId });
  };

  const tree = useTree<TreeNode>({
    rootItemId: "root",
    getItemName: (item) => nodeName(item.getItemData()),
    isItemFolder: (item) => children.has(item.getId()),
    dataLoader: { getItem: (id) => nodes.get(id) ?? { kind: "empty", text: "" }, getChildren: (id) => children.get(id) ?? [] },
    state: { expandedItems },
    setExpandedItems: (update) => {
      const next = typeof update === "function" ? update(expandedItems) : update;
      const open = new Set(next);
      const changed = folders.filter((id) => open.has(id) === isClosed(id));
      if (changed.length > 0) setCollapsed(Object.fromEntries(changed.map((id) => [id, !open.has(id)])));
    },
    onPrimaryAction: (item) => {
      const node = item.getItemData();
      if (node.kind === "session") navigate(`/s/${node.session.id}`);
      if (node.kind === "plan") navigate(`/f/${node.feature.id}/plan`, { state: from });
    },
    canRename: (item) => item.getItemData().kind === "feature",
    onRename: (item, value) => {
      const node = item.getItemData();
      const title = value.trim();
      if (node.kind === "feature" && title && title !== node.feature.title) send({ type: "rename_feature", id: node.feature.id, title });
    },
    hotkeys: {
      customEnter: {
        hotkey: "Enter",
        isEnabled: (tree) => !tree.isRenamingItem(), // then Enter finishes the rename
        handler: (e, tree) => {
          // Enter on a row's own button (done / reopen) is that button's.
          if ((e.target as HTMLElement).getAttribute("role") !== "treeitem") return;
          const item = tree.getFocusedItem();
          if (!item.isFolder()) item.primaryAction();
          else if (item.isExpanded()) item.collapse();
          else item.expand();
        },
      },
    },
    canReorder: false, // a session's place is by activity: a drop only says which feature
    canDrag: (items) => items.every((i) => i.getItemData().kind === "session"),
    canDrop: (items, target) => {
      const featureId = land(target);
      return featureId !== undefined && dragged(items).some((s) => s.featureId !== featureId);
    },
    onDrop: (items, target) => {
      const featureId = land(target);
      if (featureId !== undefined) move(dragged(items), featureId);
    },
    createForeignDragObject: (items) => {
      dragging = dragged(items); // called as the drag starts, whichever section it lands in
      return { format: SESSIONS_DRAG, data: JSON.stringify(dragging.map((s) => s.id)), effectAllowed: "move" };
    },
    // While a foreign drag is over a row, the library asks about the row itself (it can't read
    // the drag's data yet), not the folder the drop would fall back to: ask about that instead.
    canDragForeignDragObjectOver: (data, target) => {
      const row = target.item.getItemData().kind;
      const landing = (row === "session" || row === "empty" || row === "plan") && target.item.getParent() ? { item: target.item.getParent()! } : target;
      const featureId = land(landing);
      return data.types.includes(SESSIONS_DRAG) && featureId !== undefined && dragging.some((s) => s.featureId !== featureId);
    },
    canDropForeignDragObject: (data, target) => data.types.includes(SESSIONS_DRAG) && land(target) !== undefined,
    onDropForeignDragObject: (data, target) => {
      const featureId = land(target);
      const ids = new Set<string>(JSON.parse(data.getData(SESSIONS_DRAG)));
      if (featureId !== undefined) move(useKratos.getState().sessions.filter((s) => ids.has(s.id)), featureId);
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature, renamingFeature, dragAndDropFeature],
  });
  // The rows changed (a session moved, a feature was made): Headless Tree re-reads them. Before
  // paint, so a row that left this section never shows its stale fallback ("No sessions yet").
  useLayoutEffect(() => tree.rebuildTree(), [tree, nodes, children]);

  // Over the section's open space the library tracks no target (only rows do), so we do: it
  // lights up like a folder, a drop there making the session a one-off.
  const [overSpace, setOverSpace] = useState(false);
  useEffect(() => {
    const off = () => {
      setOverSpace(false);
      dragging = [];
    };
    window.addEventListener("dragend", off);
    window.addEventListener("drop", off);
    return () => {
      window.removeEventListener("dragend", off);
      window.removeEventListener("drop", off);
    };
  }, []);
  const container = tree.getContainerProps(label);
  const overSection = overSpace || tree.getDragTarget()?.item.getId() === "root"; // a drop here: a one-off
  return (
    <div
      {...container}
      onDragOver={(e) => {
        hovered.current = null; // open space (rows stop their own dragover from reaching here)
        // Lit only if a drop here would change something (Done's open space never does).
        setOverSpace(land({ item: tree.getRootItem() }) === null && dragging.some((s) => s.featureId !== null));
        container.onDragOver(e);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverSpace(false);
      }}
      className={cn("flex min-h-8 flex-1 flex-col rounded-xl pb-4 outline-none", overSection && "bg-primary/5 ring-1 ring-primary/30")}
    >
      {tree.getItems().map((item) => (
        <Row
          key={item.getId()}
          item={item}
          from={from}
          onDragOver={() => {
            hovered.current = { node: item.getItemData(), level: item.getItemMeta().level };
            setOverSpace(false);
          }}
        />
      ))}
    </div>
  );
}

/** The drag's data type between the Working and Done trees: the dragged sessions' ids. */
const SESSIONS_DRAG = "application/x-kratos-sessions";
/** The sessions being dragged right now, from either section. The other section can't read a
 * drag's data before the drop, but whether a drop would change anything decides its highlight. */
let dragging: SessionSummary[] = [];

/** Rows inside a folder hang off a guide line. */
const INDENT = ["", "ml-4 border-l border-border pl-1.5"];

function Row({ item, from, onDragOver }: { item: ItemInstance<TreeNode>; from: PlanFrom; onDragOver: () => void }) {
  const node = item.getItemData();
  const level = Math.min(item.getItemMeta().level, INDENT.length - 1);
  const props = item.getProps();
  const beingDragged = item.getTree().getState().dnd?.draggedItems?.some((d) => d.getId() === item.getId()) ?? false;
  // The tree item is the whole row; the look goes on the inner box so the guide line runs on. A
  // folder a drag would land in lights up.
  const box = cn(
    "rounded-lg group-focus-visible/row:outline-2 group-focus-visible/row:-outline-offset-2 group-focus-visible/row:outline-ring",
    node.kind === "feature" && item.isDragTarget() && "bg-primary/10 ring-1 ring-primary/50",
  );
  return (
    <div
      {...props}
      onDragOver={(e) => {
        onDragOver(); // first: where the drop lands depends on the row it's over
        props.onDragOver(e);
      }}
      className={cn("group/row relative pb-0.5 outline-none", INDENT[level], beingDragged && "opacity-50")}
    >
      {node.kind === "session" && (
        <>
          {/* A real link, so ⌘-click opens a new tab; the tree's own click would navigate too. */}
          <NavLink
            to={`/s/${node.session.id}`}
            tabIndex={-1}
            draggable={false} // the row drags (to a feature), not the link
            onClick={(e) => {
              e.stopPropagation();
              item.setFocused();
            }}
            className={({ isActive }) =>
              cn(box, "flex flex-col gap-0.5 py-2 pr-10 pl-2.5 hover:bg-accent", node.session.hasPlan && "group-hover/row:pr-16", isActive && "bg-secondary")
            }
          >
            <SessionTitle session={node.session} className={cn("truncate text-sm", (node.session.done || node.quiet) && "text-muted-foreground")} />
            {!node.session.done && !(node.quiet && node.session.status === "idle") && (
              <SessionStatus status={node.session.status} queued={node.session.queued} />
            )}
          </NavLink>
          {/* Its plan (4p1c): at the row's end, moving aside for the Done check on hover. */}
          {node.session.hasPlan && (
            <Link
              to={`/s/${node.session.id}/plan`}
              state={from}
              tabIndex={-1}
              draggable={false}
              onClick={(e) => e.stopPropagation()}
              aria-label={`${sessionTitle(node.session)}: its plan`}
              title="Its plan"
              className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-run hover:bg-secondary group-hover/row:right-9"
            >
              <ListTodo className="size-3.5" aria-hidden="true" />
            </Link>
          )}
          <DoneButton
            tabIndex={-1}
            session={node.session}
            variant="icon"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          />
        </>
      )}
      {node.kind === "feature" && <FeatureRow node={node} item={item} box={box} />}
      {node.kind === "empty" && <p className={cn(box, "px-2.5 py-1.5 text-xs text-muted-foreground")}>{node.text}</p>}
      {node.kind === "plan" && (
        // The feature's plan (4p1c): a row like a session's, muted until there's a plan.
        <NavLink
          to={`/f/${node.feature.id}/plan`}
          state={from}
          tabIndex={-1}
          draggable={false}
          onClick={(e) => {
            e.stopPropagation();
            item.setFocused();
          }}
          className={({ isActive }) =>
            cn(box, "flex items-center gap-2 py-1.5 pl-2.5 text-sm hover:bg-accent", !node.feature.hasPlan && "text-muted-foreground", isActive && "bg-secondary")
          }
        >
          <MapIcon className={cn("size-3.5 shrink-0", node.feature.hasPlan ? "text-primary" : "text-faint")} aria-hidden="true" />
          Plan
        </NavLink>
      )}
    </div>
  );
}

/** A feature's folder row (D73). Closed, it shows the most urgent status inside, so an ask can't
 * hide in it; open, how many sessions it holds here. In Done it's muted: the finished part. On
 * hover, its buttons take the count's place: a new session in it (Working only), rename (also
 * F2 / double-click), done / reopen. */
function FeatureRow({ node, item, box }: { node: Extract<TreeNode, { kind: "feature" }>; item: ItemInstance<TreeNode>; box: string }) {
  const { feature, count, status, inDone } = node;
  const navigate = useNavigate();
  const open = item.isExpanded();
  const canStart = !inDone && !feature.done; // a new session in it: Working's folders only
  const Icon = feature.done ? PackageCheck : Package;
  if (item.isRenaming()) {
    return (
      <div className={cn(box, "flex items-center gap-2 bg-secondary py-1 pr-2 pl-8")}>
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          {...item.getRenameInputProps()}
          maxLength={80}
          aria-label={`Rename ${feature.title}`}
          // Capture: before the tree hears the key. Enter that confirms an IME character isn't
          // "done renaming"; Esc is the rename's, not also the session's (stop the agent).
          onKeyDownCapture={(e) => {
            if (e.key === "Enter" && e.nativeEvent.isComposing) e.stopPropagation();
            if (e.key === "Escape") e.preventDefault();
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
    );
  }
  return (
    <>
      {/* The hover buttons need room only on hover: then the title makes way for them. */}
      <div
        onDoubleClick={() => item.startRenaming()}
        className={cn(box, "flex cursor-pointer items-center gap-2 py-2 pr-3 pl-2.5 text-sm hover:bg-accent", canStart ? "group-hover/row:pr-24" : "group-hover/row:pr-16")}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")} aria-hidden="true" />
        <Icon className={cn("size-4 shrink-0", feature.done ? "text-add" : "text-muted-foreground")} aria-hidden="true" />
        <span className={cn("flex-1 truncate", (feature.done || inDone) && "text-muted-foreground")}>{feature.title}</span>
        {!open && status !== "idle" ? (
          <span title={statusLabel(status)} className="flex size-4 items-center justify-center group-hover/row:hidden">
            <StatusDot status={status} />
            <span className="sr-only">{statusLabel(status)}</span>
          </span>
        ) : (
          // Its plan's ticked steps (4p5c, board §3), else how many sessions it holds here.
          (feature.progress?.total ? (
            <span className="font-mono text-xs text-faint group-hover/row:hidden" title={`${feature.progress.ticked} of ${feature.progress.total} steps ticked`}>
              {feature.progress.ticked}/{feature.progress.total}
            </span>
          ) : (
            count > 0 && <span className="font-mono text-xs text-faint group-hover/row:hidden">{count}</span>
          ))
        )}
      </div>
      <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 opacity-0 group-hover/row:opacity-100">
        {canStart && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // inside the folder's row: don't open or close it
              navigate(`/?feature=${feature.id}`); // Home, with this feature picked on the shelf
            }}
            aria-label={`New session in ${feature.title}`}
            title="New session in this feature"
            tabIndex={-1}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation(); // inside the folder's row: don't open or close it
            item.startRenaming();
          }}
          aria-label={`Rename ${feature.title}`}
          title="Rename (F2)"
          tabIndex={-1}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
        <FeatureDoneButton feature={feature} />
      </div>
    </>
  );
}

