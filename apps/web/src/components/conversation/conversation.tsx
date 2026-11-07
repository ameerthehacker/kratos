import { useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { StickToBottom } from "use-stick-to-bottom";
import { PromptBubble } from "@/components/conversation/prompt-bubble";
import { StepGroup } from "@/components/conversation/step-group";
import { WorkingIndicator } from "@/components/conversation/working-indicator";
import { codePlugin } from "@/lib/appearance";
import type { SessionSummary } from "@kratos/core";
import { currentActivity, type TimelineItem } from "@/lib/timeline";

/**
 * A session's conversation, drawn like the owner's chat design (D45): your prompts as bubbles,
 * the agent's replies as markdown, its tool calls as plain-words steps. Scrolls itself and stays
 * pinned to the newest message unless you scroll up. Mount it once a session's history has
 * fully arrived (`session_ready`), keyed by session: its first size is then the whole chat, so it
 * opens at the bottom (`initial`, instant) and only later messages glide in (`resize`, smooth) —
 * no scroll through the replay (owner, 3d9).
 */
export function Conversation(props: { items: TimelineItem[]; agent: string; status?: SessionSummary["status"]; queued?: number }) {
  const { items } = props;
  const [raw, setRaw] = useState(false); // one toggle for the whole view, as in the design

  return (
    // The fade on top (3x1): what scrolls under the title goes soft instead of being cut off.
    <StickToBottom
      className="relative min-h-0 flex-1 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-6 before:bg-linear-to-b before:from-background before:to-transparent"
      resize="smooth"
      initial="instant"
    >
      <StickToBottom.Content className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-6 pt-1 pb-8">
        {items.map((item, i) => {
          switch (item.type) {
            case "prompt":
              return <PromptBubble key={i} text={item.text} attachments={item.attachments} read={item.read} />;
            case "reply":
              return (
                <Streamdown key={i} mode="static" plugins={{ code: codePlugin }} className="min-w-0">
                  {item.text}
                </Streamdown>
              );
            case "steps":
              return <StepGroup key={i} agent={props.agent} steps={item.steps} raw={raw} onToggleRaw={() => setRaw(!raw)} />;
            case "event":
              return (
                <div key={i} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-faint" aria-hidden="true" />
                  {item.text}
                </div>
              );
          }
        })}
        {/* Last in the scroll, so it follows the newest message (3d6). Mounted for the whole
            turn (its timer counts from the start); hidden while an ask waits for you. */}
        {props.status && props.status !== "idle" && (
          <WorkingIndicator
            activity={currentActivity(items)}
            paused={props.status === "needs_approval" || props.status === "needs_answer"}
            queued={props.queued}
          />
        )}
      </StickToBottom.Content>
    </StickToBottom>
  );
}
