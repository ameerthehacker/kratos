import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import type { SessionSummary } from "@kratos/core";
import { AgentPicker } from "@/components/agent-picker";
import { PermissionPicker } from "@/components/permission-picker";
import { useHomeChoice } from "@/lib/home-choice";
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
  const modes = harnesses.find((h) => h.id === session?.harness)?.permissionModes ?? [];
  const rememberMode = useHomeChoice((s) => s.rememberMode);
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
      <Conversation items={items} agent={agentName} status={session?.status} />
      {/* Below the scroll area, so it's always in view (the design's sticky composer). */}
      <div className="mx-auto w-full max-w-3xl px-6 pb-5">
        <AskDock asks={openAsks(items)} agent={agentName} onDecide={(id, decision) => send({ type: "permission_decision", id, decision })} />
        <PromptCard
          chips={
            <>
              <AgentPicker
                harnesses={harnesses}
                value={{ harness: session?.harness ?? "", model: session?.model ?? null, effort: session?.effort ?? null }}
                // Switches this session's model or effort, live if its agent is running (D43, D51).
                // Model null = the default; effort has no "default" to go back to (D51).
                onChange={(choice) => {
                  if (choice.model !== session?.model) send({ type: "set_model", model: choice.model });
                  else if (choice.effort && choice.effort !== session?.effort) send({ type: "set_effort", effort: choice.effort });
                }}
                harnessLocked
                disabled={!connected || viewing !== sessionId}
              />
              <PermissionPicker
                agentName={agentName}
                modes={modes}
                value={session?.permissionMode ?? null}
                // Live if its agent runs (D53); the server refuses a dangerous mode without consent.
                // A pick also becomes the mode new sessions start in — Bypass too, once consented
                // (owner, 3q2).
                onChange={(mode, confirmed) => {
                  if (!session || mode === session.permissionMode) return;
                  send({ type: "set_permission_mode", mode, ...(confirmed ? { confirmDangerous: true } : {}) });
                  const picked = modes.find((m) => m.id === mode);
                  if (picked && (!picked.dangerous || confirmed)) rememberMode(session.harness, picked.isDefault ? null : mode);
                }}
                disabled={!connected || viewing !== sessionId}
              />
            </>
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
      {/* Open: live status + a quiet check icon; done: the green "Done" chip, which reopens (3d7). */}
      {!session.done && <SessionStatus status={session.status} />}
      <DoneButton session={session} variant="header" />
    </div>
  );
}
