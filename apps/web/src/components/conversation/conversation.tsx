import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { Virtuoso, type Components, type ItemContent, type VirtuosoHandle } from "react-virtuoso";
import { PromptBubble } from "@/components/conversation/prompt-bubble";
import { StepGroup } from "@/components/conversation/step-group";
import { WorkingIndicator } from "@/components/conversation/working-indicator";
import { codePlugin } from "@/lib/appearance";
import type { SessionSummary } from "@kratos/core";
import { currentActivity, type TimelineItem } from "@/lib/timeline";

type Props = { items: TimelineItem[]; agent: string; status?: SessionSummary["status"]; queued?: number };
/** What the list's items, header and footer draw with, besides the item itself. */
type Context = Props & { raw: boolean; onToggleRaw: () => void };

/**
 * A session's conversation, drawn like the owner's chat design (D45): your prompts as bubbles,
 * the agent's replies as markdown, its tool calls as plain-words steps. Scrolls itself and stays
 * pinned to the newest message unless you scroll up. Virtualized (react-virtuoso, D71): only the
 * items on screen and a little around them are drawn, so a long session opens as fast as a short
 * one. Mount it once a session's history has fully arrived (`session_ready`), keyed by session:
 * it then opens at its last item and only later messages glide in — no scroll through the
 * replay (owner, 3d9).
 */
export function Conversation(props: Props) {
  const [raw, setRaw] = useState(false); // one toggle for the whole view, as in the design
  const { items, agent, status, queued } = props;
  // A new object only when something drawn changes: Virtuoso redraws every item on screen when
  // its context changes, and the page re-renders for other reasons (the composer, the queue…).
  const context = useMemo<Context>(
    () => ({ items, agent, status, queued, raw, onToggleRaw: () => setRaw((r) => !r) }),
    [items, agent, status, queued, raw],
  );
  // `followOutput` follows *new* items; growth without one (the working indicator appearing in
  // the footer, a step added to the last group) is left to Virtuoso, which lagged up to half a
  // second when a turn started. This follows it at once, and only when the view was at the
  // bottom (measured, D71). Layout effect: before the ResizeObserver sees the growth.
  const list = useRef<VirtuosoHandle>(null);
  useLayoutEffect(() => list.current?.autoscrollToBottom(), [items, status, queued]);

  return (
    // The fade on top (3x1): what scrolls under the title goes soft instead of being cut off.
    <div className="relative min-h-0 flex-1 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-6 before:bg-linear-to-b before:from-background before:to-transparent">
      <Virtuoso
        className="h-full"
        style={{ scrollbarGutter: "stable both-edges" }} // centred with or without a scrollbar
        ref={list}
        data={items}
        context={context}
        computeItemKey={(index) => index} // items change at the end (grow, or the last one replaced)
        initialTopMostItemIndex={{ index: "LAST", align: "end" }}
        followOutput={(atBottom) => (atBottom ? "smooth" : false)}
        increaseViewportBy={{ top: 1000, bottom: 400 }} // drawn a little early: less blank while scrolling
        itemContent={itemContent}
        components={COMPONENTS}
      />
    </div>
  );
}

/** Outside the component, so its identity is stable (a new one redraws every item on screen). */
const itemContent: ItemContent<TimelineItem, Context> = (_, item, context) => (
  <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pb-7">
    <Item item={item} context={context} />
  </div>
);

/** Outside the component: Virtuoso remounts header and footer when these change identity. */
const COMPONENTS: Components<TimelineItem, Context> = {
  Header: () => <div className="h-1" />,
  // Last in the scroll, so it follows the newest message (3d6). Mounted for the whole turn (its
  // timer counts from the start); hidden while an ask waits for you.
  Footer: ({ context }) => (
    <div className="mx-auto w-full max-w-3xl px-6 pb-1">
      {context.status && context.status !== "idle" && (
        <div className="pb-7">
          <WorkingIndicator
            activity={currentActivity(context.items)}
            paused={context.status === "needs_approval" || context.status === "needs_answer"}
            queued={context.queued}
          />
        </div>
      )}
    </div>
  ),
};

function Item({ item, context }: { item: TimelineItem; context: Context }) {
  switch (item.type) {
    case "prompt":
      return <PromptBubble text={item.text} attachments={item.attachments} read={item.read} />;
    case "reply":
      return (
        <Streamdown mode="static" plugins={{ code: codePlugin }} className="min-w-0">
          {item.text}
        </Streamdown>
      );
    case "steps":
      return <StepGroup agent={context.agent} steps={item.steps} raw={context.raw} onToggleRaw={context.onToggleRaw} />;
    case "event":
      return (
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <span className="size-1.5 rounded-full bg-faint" aria-hidden="true" />
          {item.text}
        </div>
      );
  }
}
