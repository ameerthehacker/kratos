import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, FileCode, LoaderCircle, PanelRight, Pencil, Sparkles } from "lucide-react";
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
import { useSessionPlans } from "@/components/plans-island";
import { Hint } from "@/components/shortcut";
import { Counts } from "@/components/review/counts";
import { useChanges } from "@/hooks/use-changes";
import { SessionStatus, sessionTitle } from "@/components/session-status";
import { NameField } from "@/components/name-field";
import { SessionTitle } from "@/components/session-title";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PromptCard } from "@/components/prompt-card";
import { useKratos, type LogMessage } from "@/lib/kratos-store";
import { clientLog } from "@/lib/log";
import { cn } from "@/lib/utils";
import { usePlansPrefs } from "@/lib/plans-prefs";
import { SCOPES } from "@/lib/shortcuts";
import { buildTimeline, openAsks, openQuestions, openQueue } from "@/lib/timeline";
import { QueueCard } from "@/components/conversation/queue-card";
import { QuestionDock } from "@/components/conversation/question-card";

const NO_LOG: LogMessage[] = [];

/** `/s/:sessionId` — one session's conversation. Opening the URL makes this tab view it. */
export function SessionPage() {
  const { sessionId } = useParams();
  const { connected, sessionAnnounced, harnesses, sessions, viewing, log, send, cwd, loaded } = useKratos(
    useShallow((s) => ({
      connected: s.connected,
      sessionAnnounced: s.sessionAnnounced,
      harnesses: s.harnesses,
      sessions: s.sessions,
      viewing: s.viewing,
      log: s.log,
      send: s.send,
      cwd: s.info?.cwd,
      loaded: s.ready,
    })),
  );
  const session = sessions.find((s) => s.id === sessionId);
  const feature = useKratos((s) => (session?.featureId ? s.features.find((f) => f.id === session.featureId) : undefined));
  const agentName = harnesses.find((h) => h.id === session?.harness)?.name ?? "Agent";
  const modes = harnesses.find((h) => h.id === session?.harness)?.permissionModes ?? [];
  const rememberMode = useHomeChoice((s) => s.rememberMode);
  const shown = viewing === sessionId ? log : NO_LOG;
  // This session's whole history has arrived, and the project dir its steps' paths are shown
  // relative to (from `pong`, just after a connect's replay): so the chat draws once (3y6b).
  const ready = viewing === sessionId && loaded && cwd !== undefined;
  // The server shows this tab this session now: not while a reconnect hasn't said which one yet.
  const live = connected && sessionAnnounced && viewing === sessionId;
  const items = useMemo(() => buildTimeline(shown, cwd, agentName), [shown, cwd, agentName]);
  const queue = useMemo(() => openQueue(shown), [shown]);
  const working = session !== undefined && session.status !== "idle";
  // Skip planning (4p6c): back to the mode it had (else the agent's own default), then the agent
  // is told to go ahead — as the answer to its plan if one is waiting, else as a prompt it reads
  // at its next step (D56). Memoized: the chat redraws what's on screen when this changes.
  const skipPlanning = useCallback(
    (before: string | null) => {
      const mode = modes.find((m) => m.id === before) ?? modes.find((m) => m.kind === "ask") ?? modes[0];
      if (mode) send({ type: "set_permission_mode", mode: mode.id, ...(mode.dangerous ? { confirmDangerous: true } : {}) });
      const plan = openAsks(items).find((step) => step.kind === "plan");
      if (plan?.ask) send({ type: "permission_decision", id: plan.ask.id, decision: { decision: "deny", message: SKIP_PLANNING } });
      else send({ type: "prompt", text: SKIP_PLANNING });
    },
    [modes, items, send],
  );
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

  // Ask the server to show this session in this tab, once it has said what it shows: connecting
  // shows this one already (3y6b), so asking then would replay it twice.
  useEffect(() => {
    if (connected && sessionAnnounced && sessionId && viewing !== sessionId) send({ type: "open_session", id: sessionId });
  }, [connected, sessionAnnounced, sessionId, viewing, send]);

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
          <Conversation
            key={sessionId}
            items={items}
            agent={agentName}
            status={session?.status}
            queued={queue.length}
            onSkipPlanning={session?.permissionMode === "plan" ? skipPlanning : undefined}
            reviewHref={sessionId && reviewPath(sessionId)}
          />
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
          <AskDock
            asks={openAsks(items)}
            agent={agentName}
            where={{ inFeature: !!feature, featureHasPlan: feature?.hasPlan ?? false, featureTitle: feature?.title }}
            onDecide={(id, decision, savePlanAs, planText) =>
              send({ type: "permission_decision", id, decision, ...(savePlanAs ? { savePlanAs } : {}), ...(planText !== undefined ? { planText } : {}) })
            }
          />
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
                  disabled={!live}
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
                  disabled={!live}
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
            disabled={!live}
            size="compact"
            placeholder={working ? "Add to the queue…" : "Reply…"}
          />
        </div>
      </main>
    </HotkeysProvider>
  );
}

/** What the agent hears when you skip the plan it chose to make (4p6c). */
const SKIP_PLANNING = "The owner skipped planning: leave plan mode and make the change directly, without a plan.";

/** The open session's title bar (3d2): what it is, its status, and Mark as done / Reopen. Its
 * title has a small menu (3z4): have the agent name it again, or rename it yourself. */
function SessionHeader({ session }: { session: SessionSummary }) {
  const send = useKratos((s) => s.send);
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 pb-3">
      {renaming ? (
        <NameField
          icon={Pencil}
          label="Session name"
          placeholder="Name this session"
          initial={sessionTitle(session)}
          keepOnBlur
          onDone={(title) => {
            setRenaming(false);
            if (title && title !== session.title) send({ type: "rename_session", sessionId: session.id, title });
          }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-secondary px-2.5 py-1"
          iconClassName="size-3.5 text-muted-foreground"
          inputClassName="h-7 text-base font-medium"
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <h1 className="min-w-0 truncate text-base font-medium" title={sessionTitle(session)}>
            <SessionTitle session={session} />
          </h1>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Session title"
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className="size-3.5" strokeWidth={2.2} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuItem disabled={session.titling || session.title === null} onClick={() => send({ type: "regenerate_title", sessionId: session.id })}>
                <Sparkles className="size-4" />
                {session.titling ? "Naming…" : "Regenerate title"}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={session.title === null} onClick={() => setRenaming(true)}>
                <Pencil className="size-4" />
                Rename…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <ChangesButton sessionId={session.id} />
      {/* Open: live status + a quiet check icon; done: the green "Done" chip, which reopens (3d7). */}
      {!session.done && <SessionStatus status={session.status} queued={session.queued} />}
      <DoneButton session={session} variant="header" />
      <PlansToggle sessionId={session.id} />
    </div>
  );
}

/** Shows or hides the plans island (4p5a, ⌥⌘B), at the header's right end like the sidebar's
 * button at its left; only when the session has a plan to show. */
function PlansToggle({ sessionId }: { sessionId: string }) {
  const { offered } = useSessionPlans(sessionId);
  const open = usePlansPrefs((s) => s.open);
  const setOpen = usePlansPrefs((s) => s.setOpen);
  if (!offered) return null;
  return (
    <Hint label={open ? "Hide plans" : "Show plans"} id="plans.toggle">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Hide plans" : "Show plans"}
        aria-pressed={open}
        className={cn(
          "hidden size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent hover:text-foreground lg:flex",
          open ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <PanelRight className="size-4" />
      </button>
    </Hint>
  );
}

/** The review page of a session's changes (3v2): the changes button's and the scope-drift notice's way in. */
const reviewPath = (sessionId: string) => `/s/${sessionId}/review`;

/** The way into reviewing what this session changed (3v2, the design's "4 files +25 −5"); hidden
 * until it has changed something. */
function ChangesButton({ sessionId }: { sessionId: string }) {
  const files = useChanges(sessionId)?.files ?? [];
  if (files.length === 0) return null;
  return (
    <Link
      to={reviewPath(sessionId)}
      className="inline-flex h-8 flex-none items-center gap-2 rounded-full bg-secondary px-3 text-sm text-secondary-foreground hover:bg-input hover:text-foreground"
    >
      <FileCode className="size-3.5" aria-hidden="true" />
      {files.length} {files.length === 1 ? "file" : "files"}
      <Counts additions={files.reduce((n, f) => n + f.additions, 0)} deletions={files.reduce((n, f) => n + f.deletions, 0)} />
    </Link>
  );
}
