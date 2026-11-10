import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { ArrowDown } from "lucide-react";
import { Virtuoso, type Components, type ItemContent } from "react-virtuoso";
import { useStickToBottom } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { PromptBubble } from "@/components/conversation/prompt-bubble";
import { PlanSwitch } from "@/components/conversation/plan-switch";
import { ScopeDrift } from "@/components/conversation/scope-drift";
import { StepGroup } from "@/components/conversation/step-group";
import { WorkingIndicator } from "@/components/conversation/working-indicator";
import { codePlugin } from "@/lib/appearance";
import type { SessionSummary } from "@kratos/core";
import { currentActivity, type TimelineItem } from "@/lib/timeline";

type Props = {
  items: TimelineItem[];
  agent: string;
  status?: SessionSummary["status"];
  queued?: number;
  /** Skip planning (4p6c), while the session is still planning from the agent's own switch: with
   * the mode it had before. */
  onSkipPlanning?: (before: string | null) => void;
  /** Where Show diff goes (4p7a): this session's review. */
  reviewHref?: string;
  /** The agent's planning mode by its own name ("Plan first"), for the switch line. */
  planModeLabel?: string;
};
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
  const { items, agent, status, queued, onSkipPlanning, reviewHref, planModeLabel } = props;
  // A new object only when something drawn changes: Virtuoso redraws every item on screen when
  // its context changes, and the page re-renders for other reasons (the composer, the queue…).
  const context = useMemo<Context>(
    () => ({ items, agent, status, queued, onSkipPlanning, reviewHref, planModeLabel, raw, onToggleRaw: () => setRaw((r) => !r) }),
    [items, agent, status, queued, onSkipPlanning, reviewHref, planModeLabel, raw],
  );
  // Pinned to the newest message until you scroll up, and again once you're back at the bottom
  // (use-stick-to-bottom, D76): it watches the content's size, so a new message, a growing step or
  // a reply measured late all keep it pinned. Virtuoso still draws only what's on screen, inside
  // the library's scroll container (`customScrollParent`).
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({ initial: "instant", resize: "instant" });
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const scrollerRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef(el);
      setScroller(el);
    },
    [scrollRef],
  );
  // Sending a prompt means you want to see where it goes: back to the bottom, wherever you were (D75).
  const seen = useRef(items.length);
  useEffect(() => {
    if (items.length > seen.current && items.at(-1)?.type === "prompt") void scrollToBottom("instant");
    seen.current = items.length;
  }, [items, scrollToBottom]);

  return (
    // The fade on top (3x1): what scrolls under the title goes soft instead of being cut off.
    <div className="relative min-h-0 flex-1 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-6 before:bg-linear-to-b before:from-background before:to-transparent">
      <div
        ref={scrollerRef}
        className="h-full overflow-y-auto"
        style={{ scrollbarGutter: "stable both-edges" }} // centred with or without a scrollbar
      >
        <div ref={contentRef}>
          {scroller && (
            <Virtuoso
              customScrollParent={scroller}
              data={items}
              context={context}
              computeItemKey={(index) => index} // items change at the end (grow, or the last one replaced)
              initialTopMostItemIndex={{ index: "LAST", align: "end" }}
              increaseViewportBy={{ top: 1000, bottom: 400 }} // drawn a little early: less blank while scrolling
              itemContent={itemContent}
              components={COMPONENTS}
            />
          )}
        </div>
      </div>
      {!isAtBottom && (
        // Faded in late, so a quick look up doesn't flash it (3y6e).
        <Button
          variant="secondary"
          size="icon"
          aria-label="Scroll to the newest message"
          onClick={() => void scrollToBottom()}
          className="absolute bottom-3 left-1/2 size-9 -translate-x-1/2 rounded-full bg-card shadow-md ring-1 ring-border animate-in fade-in fill-mode-both delay-500"
        >
          <ArrowDown className="size-4.5" strokeWidth={2.4} />
        </Button>
      )}
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
      // Kratos's own steps (a plan it held to who-writes-what, 4p3b) are headed as its, not the agent's.
      return <StepGroup agent={item.by === "kratos" ? "Kratos" : context.agent} steps={item.steps} raw={context.raw} onToggleRaw={context.onToggleRaw} />;
    case "plan_switch": {
      // Only the latest switch, while its plan mode lasts and the session still plans: an earlier
      // one is over, and plan mode you picked yourself later isn't the agent's to skip.
      const skip = item.open && context.onSkipPlanning;
      return <PlanSwitch item={item} agent={context.agent} mode={context.planModeLabel} onSkip={skip ? () => skip(item.before) : undefined} />;
    }
    case "scope_drift":
      return <ScopeDrift item={item} reviewHref={context.reviewHref} />;
    case "event":
      return (
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <span className="size-1.5 rounded-full bg-faint" aria-hidden="true" />
          {item.text}
        </div>
      );
  }
}
