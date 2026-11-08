import { useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@kratos/core";
import { sessionTitle } from "@/components/session-status";
import { cn } from "@/lib/utils";

/**
 * A session's title (3z4). While the agent is naming the session it pulses gently; when the title
 * changes while shown (the agent named it, or you renamed it) the new one fades and slides in. Not
 * when first drawn: opening a page or the sidebar doesn't replay it.
 */
export function SessionTitle({ session, className }: { session: SessionSummary; className?: string }) {
  const text = sessionTitle(session);
  const shown = useRef(text);
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    if (shown.current === text) return;
    shown.current = text;
    setChanged((n) => n + 1);
  }, [text]);
  return (
    <span
      key={changed} // a new key replays the animation on each change
      className={cn(className, session.titling && "animate-pulse", changed > 0 && "animate-in fade-in slide-in-from-bottom-1 duration-500")}
    >
      {text}
    </span>
  );
}
