import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import type { SessionSummary } from "@kratos/core";
import { AgentPicker } from "@/components/agent-picker";
import { AskDock } from "@/components/conversation/ask-dock";
import { Conversation } from "@/components/conversation/conversation";
import { DoneButton } from "@/components/done-button";
import { SessionStatus, sessionTitle } from "@/components/session-status";
import { PromptCard } from "@/components/prompt-card";
import { useKratos, type LogMessage } from "@/lib/kratos-store";
import { buildTimeline, openAsks } from "@/lib/timeline";

const NO_LOG: LogMessage[] = [];

/** `/s/:sessionId` — one session's conversation. Opening the URL makes this tab view it. */
export function SessionPage() {
  const { sessionId } = useParams();
  const { connected, harnesses, sessions, viewing, log, send, cwd } = useKratos(
    useShallow((s) => ({ connected: s.connected, harnesses: s.harnesses, sessions: s.sessions, viewing: s.viewing, log: s.log, send: s.send, cwd: s.info?.cwd })),
  );
  const session = sessions.find((s) => s.id === sessionId);
  const agentName = harnesses.find((h) => h.id === session?.harness)?.name ?? "Agent";
  const shown = viewing === sessionId ? log : NO_LOG;
  const items = useMemo(() => buildTimeline(shown, cwd), [shown, cwd]);

  // Ask the server to show this session in this tab (connecting shows the latest one).
  useEffect(() => {
    if (connected && sessionId && viewing !== sessionId) send({ type: "open_session", id: sessionId });
  }, [connected, sessionId, viewing, send]);

  if (sessions.length > 0 && !session) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-6 pt-32 text-muted-foreground">
        <p>This session doesn't exist in this project.</p>
        <Link to="/" className="text-foreground underline underline-offset-4">
          Start something new
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {session && <SessionHeader session={session} />}
      <Conversation items={items} agent={agentName} />
      {/* Below the scroll area, so it's always in view (the design's sticky composer). */}
      <div className="mx-auto w-full max-w-3xl px-6 pb-5">
        <AskDock asks={openAsks(items)} agent={agentName} onDecide={(id, decision) => send({ type: "permission_decision", id, decision })} />
        <PromptCard
          agent={
            <AgentPicker
              harnesses={harnesses}
              value={{ harness: session?.harness ?? "", model: session?.model ?? null }}
              // Switches this session's model, live if its agent is running (D43). null = the default.
              onChange={(choice) => choice.model !== session?.model && send({ type: "set_model", model: choice.model })}
              harnessLocked
              disabled={!connected || viewing !== sessionId}
            />
          }
          onSend={(text) => send({ type: "prompt", text })}
          onStop={session?.status === "idle" || !session ? undefined : () => send({ type: "interrupt" })}
          disabled={!connected || viewing !== sessionId}
          size="compact"
          placeholder="Reply…"
        />
      </div>
    </main>
  );
}

/** The open session's title bar (3d2): what it is, its status, and Mark as done / Reopen. */
function SessionHeader({ session }: { session: SessionSummary }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 pb-3">
      <h1 className="min-w-0 flex-1 truncate text-base font-medium" title={sessionTitle(session)}>
        {sessionTitle(session)}
      </h1>
      {session.done ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-add">
          <span className="size-2 rounded-full bg-add" aria-hidden="true" />
          Done
        </span>
      ) : (
        <SessionStatus status={session.status} />
      )}
      <DoneButton session={session} variant="full" />
    </div>
  );
}
