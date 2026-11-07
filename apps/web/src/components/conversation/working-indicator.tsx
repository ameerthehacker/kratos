import { useState } from "react";
import { useInterval, useMediaQuery } from "usehooks-ts";
import { ForgeHammer } from "@/components/conversation/forge-hammer";

/** Between steps (thinking, writing its reply), the indicator cycles these (3d6, owner). */
const WORDS = ["Thinking", "Forging", "Tempering", "Pondering", "Hammering it out", "Sharpening", "Weighing it up", "Untangling", "Mulling it over", "Plotting"];

/**
 * The line under the conversation while the agent works (3d6, D52): what it is doing now (its
 * unfinished step, e.g. "Reading store.ts"), or a cycling word between steps; a shimmering text,
 * the logo's hammer striking, and the time since this tab saw the turn start.
 */
export function WorkingIndicator({ activity, paused }: { activity: string | null; paused?: boolean }) {
  const startedAt = useState(() => Date.now())[0]; // mounted when the turn starts
  const [now, setNow] = useState(startedAt);
  // A new word every 3s, starting from a random one; none of that with reduced motion.
  const [wordIndex, setWordIndex] = useState(() => Math.floor(Math.random() * WORDS.length));
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  useInterval(() => setNow(Date.now()), 1000);
  useInterval(() => setWordIndex((i) => (i + 1) % WORDS.length), reducedMotion ? null : 3000); // null = paused
  const word = WORDS[wordIndex];
  const text = `${activity ?? word}…`;
  // While an ask waits, the ask dock says so; stay mounted so the time keeps counting the turn.
  if (paused) return null;

  return (
    <div role="status" aria-live="polite" className="flex items-center gap-1.5 text-sm">
      <ForgeHammer className="h-5 w-4 shrink-0" />
      {/* Screen readers hear the step, not every word change. */}
      <span className="min-w-0 truncate text-shimmer animate-shimmer" aria-label={activity ?? "Working"}>
        {text}
      </span>
      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{elapsed(now - startedAt)}</span>
    </div>
  );
}

/** "8s", "1m 05s". */
function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

