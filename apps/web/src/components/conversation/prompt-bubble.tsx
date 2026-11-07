import { useEffect, useState } from "react";
import copyToClipboard from "copy-to-clipboard";
import { Check, CheckCheck, Clock, Copy, Zap } from "lucide-react";
import type { AttachmentRef } from "@kratos/core";
import type { ReadMark } from "@/lib/timeline";
import { SentFiles } from "@/components/attachments";
import { clientLog } from "@/lib/log";

/** One of your prompts: a right-aligned bubble, with a copy button under it on hover/focus (3c5),
 * the files sent with it above (3s2), and — for one sent while the agent worked — how it was read
 * (3t3). */
export function PromptBubble({ text, attachments = [], read }: { text: string; attachments?: AttachmentRef[]; read?: ReadMark }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  // copy-to-clipboard: the Clipboard API, falling back to execCommand where it isn't allowed
  // (e.g. plain http on a LAN address); no window.prompt fallback.
  const copy = async () => {
    if (await copyToClipboard(text)) setCopied(true);
    else clientLog("warn", "could not copy the prompt");
  };

  return (
    <div className="group flex max-w-4/5 flex-col items-end gap-1 self-end">
      <SentFiles files={attachments} />
      <div className="rounded-2xl bg-secondary px-4 py-2.5 whitespace-pre-wrap">{text}</div>
      {read && <ReadNote read={read} />}
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy prompt"}
        title={copied ? "Copied" : "Copy"}
        className="flex size-7 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {copied ? <Check className="size-3.5 text-add" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

/** Under a prompt sent while the agent worked (the steering design): read at a step, sent now
 * (stopping a step), or sent once the last turn ended. */
function ReadNote({ read }: { read: ReadMark }) {
  const [Icon, tone, text] =
    read.how === "now"
      ? [Zap, "text-wait", read.stopped ? `Sent now · stopped ${read.stopped}` : "Sent now"]
      : read.how === "step"
        ? [CheckCheck, "text-add", read.after ? `Read after ${read.after}` : "Read while working"]
        : [Clock, "text-muted-foreground", "Sent when the last turn ended"];
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className={`size-3.5 ${tone}`} aria-hidden="true" />
      {text}
    </span>
  );
}
