import { useEffect, useMemo, useState } from "react";
import { FileCode, LoaderCircle } from "lucide-react";
import { Link, useParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import { HotkeysProvider, useAppHotkeys, useHotkey } from "@tanstack/react-hotkeys";
import type { SessionSummary } from "@kratos/core";
import { AgentPicker } from "@/components/agent-picker";
import { PermissionPicker } from "@/components/permission-picker";
import { useHomeChoice } from "@/lib/home-choice";
import { askToNotify } from "@/hooks/use-attention";
import { AskDock } from "@/components/conversation/ask-dock";
import { Conversation } from "@/components/conversation/conversation";
import { DoneButton } from "@/components/done-button";
import { Counts } from "@/components/review/counts";
import { useChanges } from "@/hooks/use-changes";
import { SessionStatus, sessionTitle } from "@/components/session-status";
import { PromptCard } from "@/components/prompt-card";
import { useKratos, type LogMessage } from "@/lib/kratos-store";
import { clientLog } from "@/lib/log";
import { SCOPES } from "@/lib/shortcuts";
import { buildTimeline, openAsks, openQuestions, openQueue } from "@/lib/timeline";
import { QueueCard } from "@/components/conversation/queue-card";
import { QuestionDock } from "@/components/conversation/question-card";

const NO_LOG: LogMessage[] = [];

/** `/s/:sessionId` — one session's conversation. Opening the URL makes this tab view it. */
export function SessionPage() {
  const { sessionId } = useParams();
  const { connected, harnesses, sessions, viewing, log, send, cwd, loaded } = useKratos(
    useShallow((s) => ({ connected: s.connected, harnesses: s.harnesses, sessions: s.sessions, viewing: s.viewing, log: s.log, send: s.send, cwd: s.info?.cwd, loaded: s.ready })),
  );
  const session = sessions.find((s) => s.id === sessionId);
  const agentName = harnesses.find((h) => h.id === session?.harness)?.name ?? "Agent";
  const modes = harnesses.find((h) => h.id === session?.harness)?.permissionModes ?? [];
  const rememberMode = useHomeChoice((s) => s.rememberMode);
  const shown = viewing === sessionId ? log : NO_LOG;
  const ready = viewing === sessionId && loaded; // this session's whole history has arrived
  const items = useMemo(() => buildTimeline(shown, cwd, agentName), [shown, cwd, agentName]);
  const queue = useMemo(() => openQueue(shown), [shown]);
  const working = session !== undefined && session.status !== "idle";
  // Text going back into the composer (D56): a queued prompt being edited, or what Stop dropped.
  const [insert, setInsert] = useState<{ text: string; key: number }>();
  const putBack = (text: string) => setInsert((current) => ({ text, key: (current?.key ?? 0) + 1 }));
  const returned = useKratos((s) => s.returned);
  useEffect(() => {
    if (returned === undefined) return;
    putBack(returned);
    useKratos.setState({ returned: undefined });
  }, [returned]);

  // How long opening took, to the first frame that shows the chat (3y6a): in the debug log. Once
  // per open: coming back to the page of a session still viewed opens nothing.
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() =>
      setTimeout(() => {
        if (performance.getEntriesByName("kratos:drawn").length > 0) return;
        const { duration } = performance.measure("kratos:drawn", "kratos:open");
        clientLog("debug", "session drawn", { ms: Math.round(duration) });
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [ready, sessionId]);

  // Ask the server to show this session in this tab (connecting shows the latest one).
  useEffect(() => {
    if (connected && sessionId && viewing !== sessionId) send({ type: "open_session", id: sessionId });
  }, [connected, sessionId, viewing, send]);

  // Esc stops the turn, from the prompt too (like Claude Code) — but not while a question waits
  // (its card's Esc skips it), and not an Esc that closed a menu (base-ui handles those on the
  // document and prevents the default; on the window we see the event after it).
  const questions = openQuestions(items);
  const appHotkeys = useAppHotkeys();
  useHotkey(appHotkeys["agent.stop"], () => send({ type: "interrupt" }), {
    enabled: working && questions.length === 0,
    target: window,
    ignoreDefaultPrevented: true,
  });

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
    // The session's own shortcuts (Esc, allow / deny) fire only on this page.
    <HotkeysProvider scope={SCOPES.session}>
      <main className="flex min-h-0 flex-1 flex-col">
        {session && <SessionHeader session={session} />}
        {/* Only once the whole history is here (the server says so), keyed by session: it then opens
            at its bottom instead of scrolling through the replay (owner, 3d9). */}
        {ready ? (
          <Conversation key={sessionId} items={items} agent={agentName} status={session?.status} queued={queue.length} />
        ) : (
          // Faded in late, so a quick open doesn't flash it (3y6a). The fade is on the box: one
          // element can't run both animations.
          <div role="status" aria-label="Loading the session" className="flex min-h-0 flex-1 items-center justify-center">
            <span className="animate-in fade-in fill-mode-both delay-300">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </span>
          </div>
        )}
        {/* Below the scroll area, so it's always in view (the design's sticky composer). */}
        <div className="mx-auto w-full max-w-3xl px-6 pb-5">
          <QuestionDock questions={questions} agent={agentName} onAnswer={(id, reply) => send({ type: "question_answer", id, reply })} />
          <QueueCard
            queue={queue}
            onSendNow={(id) => send({ type: "send_now", id })}
            onEdit={(prompt) => {
              send({ type: "remove_queued", id: prompt.id }); // out of the queue, back into the box
              putBack(prompt.text);
            }}
            onRemove={(id) => send({ type: "remove_queued", id })}
          />
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
            onSend={(text, attachments, { now }) => {
              askToNotify(); // once, from this click (3r3)
              send({ type: "prompt", text, ...(attachments.length > 0 ? { attachments } : {}), ...(now ? { sendNow: true } : {}) });
            }}
            insert={insert}
            attachments={harnesses.find((h) => h.id === session?.harness)?.attachments}
            onStop={session?.status === "idle" || !session ? undefined : () => send({ type: "interrupt" })}
            disabled={!connected || viewing !== sessionId}
            size="compact"
            placeholder={working ? "Add to the queue…" : "Reply…"}
          />
        </div>
      </main>
    </HotkeysProvider>
  );
}

/** The open session's title bar (3d2): what it is, its status, and Mark as done / Reopen. */
function SessionHeader({ session }: { session: SessionSummary }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 pb-3">
      <h1 className="min-w-0 flex-1 truncate text-base font-medium" title={sessionTitle(session)}>
        {sessionTitle(session)}
      </h1>
      <ChangesButton sessionId={session.id} />
      {/* Open: live status + a quiet check icon; done: the green "Done" chip, which reopens (3d7). */}
      {!session.done && <SessionStatus status={session.status} queued={session.queued} />}
      <DoneButton session={session} variant="header" />
    </div>
  );
}

/** The way into reviewing what this session changed (3v2, the design's "4 files +25 −5"); hidden
 * until it has changed something. */
function ChangesButton({ sessionId }: { sessionId: string }) {
  const files = useChanges(sessionId)?.files ?? [];
  if (files.length === 0) return null;
  return (
    <Link
      to={`/s/${sessionId}/review`}
      className="inline-flex h-8 flex-none items-center gap-2 rounded-full bg-secondary px-3 text-sm text-secondary-foreground hover:bg-input hover:text-foreground"
    >
      <FileCode className="size-3.5" aria-hidden="true" />
      {files.length} {files.length === 1 ? "file" : "files"}
      <Counts additions={files.reduce((n, f) => n + f.additions, 0)} deletions={files.reduce((n, f) => n + f.deletions, 0)} />
    </Link>
  );
}
