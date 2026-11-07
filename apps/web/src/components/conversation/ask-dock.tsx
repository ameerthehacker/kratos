import { useState } from "react";
import { useAppHotkeys, useHotkey } from "@tanstack/react-hotkeys";
import type { PermissionDecision } from "@kratos/core";
import { Preview } from "@/components/conversation/preview";
import { Shortcut } from "@/components/shortcut";
import type { Step } from "@/lib/timeline";

/** Answer a permission ask (the hub routes it to the session that asked; first answer wins). */
export type Decide = (askId: string, decision: PermissionDecision) => void;

/**
 * The open permission ask, docked above the composer (owner's option C, 3c3): "Claude Code wants
 * to write notes.txt", a readable preview of exactly what will happen, Deny / Allow. With several
 * open asks the oldest comes first. The step in the chat just says "Waiting for you".
 * ⌘↵ allows and ⌘⌫ denies (3k3), their keys inside the buttons (the design).
 */
export function AskDock(props: { asks: Step[]; agent: string; onDecide: Decide }) {
  const [sent, setSent] = useState<string | null>(null); // until the server settles it
  const step = props.asks[0];
  const askId = step?.ask?.id;
  const busy = sent === askId;
  const decide = (decision: PermissionDecision) => {
    if (!askId) return;
    setSent(askId);
    props.onDecide(askId, decision);
  };
  const appHotkeys = useAppHotkeys();
  // ⌘↵ in the prompt with text to send is the prompt's "send now": it handles it first.
  useHotkey(appHotkeys["ask.allow"], () => decide({ decision: "allow" }), { enabled: !!askId && !busy, ignoreDefaultPrevented: true });
  // ⌘⌫ while typing deletes the line, as always; we only take it when there's nothing to delete.
  useHotkey(
    appHotkeys["ask.deny"],
    (event) => {
      if (typing(event.target)) return;
      event.preventDefault();
      decide(DENY);
    },
    { enabled: !!askId && !busy, preventDefault: false },
  );
  if (!step?.ask) return null;

  return (
    <div role="group" aria-label={`${props.agent} needs your OK`} className="mb-2 flex flex-col gap-2 rounded-2xl bg-card py-2.5 pr-2.5 pl-3.5 ring-1 ring-border">
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1 text-secondary-foreground">
          {props.agent} wants to <span className="text-foreground">{lowerFirst(step.intent)}</span>
          {props.asks.length > 1 && <span className="text-muted-foreground"> · 1 of {props.asks.length}</span>}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(DENY)}
          className="inline-flex h-8 items-center gap-2 rounded-full bg-secondary pr-1.5 pl-3.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Deny
          <Shortcut id="ask.deny" variant="secondary" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide({ decision: "allow" })}
          className="inline-flex h-8 items-center gap-2 rounded-full bg-foreground pr-1.5 pl-4 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Allow
          <Shortcut id="ask.allow" variant="inverse" />
        </button>
      </div>
      {step.ask.reason && <div className="text-sm text-muted-foreground">{step.ask.reason}</div>}
      <Preview step={step} />
    </div>
  );
}

const DENY: PermissionDecision = { decision: "deny", message: "The owner denied this in Kratos." };

/** A text field with something in it: ⌘⌫ there means "delete to the line start". */
const typing = (target: EventTarget | null) =>
  (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && target.value.length > 0;

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
