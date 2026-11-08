import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { hotkeysCoreFeature, renamingFeature, syncDataLoaderFeature, type ItemInstance } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { Check, ChevronRight, Package, PackageCheck, PackagePlus, PanelLeft, Pencil, Plus, RotateCcw } from "lucide-react";
import type { FeatureSummary } from "@kratos/core";
import { DoneButton } from "@/components/done-button";
import { SessionStatus, StatusDot, sessionTitle, statusLabel } from "@/components/session-status";
import { Hint, Shortcut } from "@/components/shortcut";
import { useKratos } from "@/lib/kratos-store";
import { useSidebarPrefs } from "@/lib/sidebar-prefs";
import { sidebarTree, treeNodes, type SidebarItem, type TreeNode } from "@/lib/sidebar-tree";
import { cn } from "@/lib/utils";

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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section
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
            {naming && <NewFeatureField onClose={() => setNaming(false)} />}
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
function Section({ label, count, always, action, children }: { label: string; count: number; always?: boolean; action?: ReactNode; children: ReactNode }) {
  const collapsed = useSidebarPrefs((s) => s.collapsed[label] ?? false);
  const toggle = useSidebarPrefs((s) => s.toggle);
  if (count === 0 && !always) return null;
  return (
    <section aria-label={label} className="flex flex-col gap-0.5">
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
  node.kind === "feature" ? node.feature.title : node.kind === "session" ? sessionTitle(node.session) : node.kind === "empty" ? node.text : "";

/**
 * A section's rows as an accessible tree (Headless Tree, D74): folders open and close by click or
 * ←/→, ↑/↓ move between rows, Enter opens a session or a folder, F2 or a double-click renames a
 * feature. Which folders are open is ours: remembered in the sidebar prefs, Working's open and
 * Done's closed until you open them.
 */
function SectionTree({ label, items }: { label: string; items: SidebarItem[] }) {
  const send = useKratos((s) => s.send);
  const { nodes, children, closedByDefault } = useMemo(() => treeNodes(items, label === "Done" ? "done" : "working"), [items, label]);
  const collapsed = useSidebarPrefs((s) => s.collapsed);
  const setCollapsed = useSidebarPrefs((s) => s.setCollapsed);
  const navigate = useNavigate();
  const folders = useMemo(() => [...children.keys()].filter((id) => id !== "root"), [children]);
  const isClosed = (id: string) => collapsed[id] ?? closedByDefault.has(id);
  // Same array until a folder opens or closes: Headless Tree compares it by identity, and a new
  // one on every render makes it update its state during render, forever.
  const expandedKey = folders.filter((id) => !isClosed(id)).join("\n");
  const expandedItems = useMemo(() => (expandedKey ? expandedKey.split("\n") : []), [expandedKey]);

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
    features: [syncDataLoaderFeature, hotkeysCoreFeature, renamingFeature],
  });
  // The rows changed (a session moved, a feature was made): Headless Tree re-reads them. Before
  // paint, so a row that left this section never shows its stale fallback ("No sessions yet").
  useLayoutEffect(() => tree.rebuildTree(), [tree, nodes, children]);

  return (
    <div {...tree.getContainerProps(label)} className="flex flex-col outline-none">
      {tree.getItems().map((item) => <Row key={item.getId()} item={item} />)}
    </div>
  );
}

/** Rows inside a folder hang off a guide line. */
const INDENT = ["", "ml-4 border-l border-border pl-1.5"];

function Row({ item }: { item: ItemInstance<TreeNode> }) {
  const node = item.getItemData();
  const level = Math.min(item.getItemMeta().level, INDENT.length - 1);
  // The tree item is the whole row; the look goes on the inner box so the guide line runs on.
  const box = "rounded-lg group-focus-visible/row:outline-2 group-focus-visible/row:-outline-offset-2 group-focus-visible/row:outline-ring";
  return (
    <div {...item.getProps()} className={cn("group/row relative pb-0.5 outline-none", INDENT[level])}>
      {node.kind === "session" && (
        <>
          {/* A real link, so ⌘-click opens a new tab; the tree's own click would navigate too. */}
          <NavLink
            to={`/s/${node.session.id}`}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              item.setFocused();
            }}
            className={({ isActive }) => cn(box, "flex flex-col gap-0.5 py-2 pr-10 pl-2.5 hover:bg-accent", isActive && "bg-secondary")}
          >
            <span className={cn("truncate text-sm", (node.session.done || node.quiet) && "text-muted-foreground")}>{sessionTitle(node.session)}</span>
            {!node.session.done && !(node.quiet && node.session.status === "idle") && (
              <SessionStatus status={node.session.status} queued={node.session.queued} />
            )}
          </NavLink>
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
          count > 0 && <span className="font-mono text-xs text-faint group-hover/row:hidden">{count}</span>
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

/** Mark a feature done, or reopen it (D73): a folder row's hover button, like a session's. */
function FeatureDoneButton({ feature, className }: { feature: FeatureSummary; className?: string }) {
  const send = useKratos((s) => s.send);
  const label = feature.done ? "Reopen feature" : "Mark feature done";
  const Icon = feature.done ? RotateCcw : Check;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // inside the folder's row: don't open or close it
        send({ type: "set_feature_done", id: feature.id, done: !feature.done });
      }}
      aria-label={`${label}: ${feature.title}`}
      title={label}
      tabIndex={-1}
      className={cn(
        "flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

/** Naming a new feature, in place at the top of Working (D73): Enter creates it, Esc or
 * clicking away cancels. */
function NewFeatureField({ onClose }: { onClose: () => void }) {
  const send = useKratos((s) => s.send);
  const [title, setTitle] = useState("");
  return (
    <div className="flex items-center gap-2 rounded-lg bg-secondary py-1 pr-2 pl-2.5">
      <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        autoFocus
        value={title}
        maxLength={80}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault(); // just this field's: not also the session's Esc (stop the agent)
            onClose();
            return;
          }
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (title.trim()) send({ type: "create_feature", title: title.trim() });
          onClose();
        }}
        aria-label="New feature name"
        placeholder="Name the feature"
        className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
      />
    </div>
  );
}
