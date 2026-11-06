import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { StickToBottom } from "use-stick-to-bottom";
import { StepGroup } from "@/components/conversation/step-group";
import { codePlugin } from "@/lib/appearance";
import type { LogMessage } from "@/lib/kratos-store";
import { buildTimeline } from "@/lib/timeline";

/**
 * A session's conversation, drawn like the owner's chat design (D45): your prompts as bubbles,
 * the agent's replies as markdown, its tool calls as plain-words steps. Scrolls itself and stays
 * pinned to the newest message unless you scroll up.
 */
export function Conversation(props: { log: readonly LogMessage[]; agent: string; cwd?: string }) {
  const items = useMemo(() => buildTimeline(props.log, props.cwd), [props.log, props.cwd]);
  const [raw, setRaw] = useState(false); // one toggle for the whole view, as in the design

  return (
    <StickToBottom className="relative min-h-0 flex-1" resize="smooth" initial="instant">
      <StickToBottom.Content className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-6 pt-1 pb-8">
        {items.map((item, i) => {
          switch (item.type) {
            case "prompt":
              return (
                <div key={i} className="max-w-4/5 self-end rounded-2xl bg-secondary px-4 py-2.5 whitespace-pre-wrap">
                  {item.text}
                </div>
              );
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
      </StickToBottom.Content>
    </StickToBottom>
  );
}
