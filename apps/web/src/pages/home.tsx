import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { useShallow } from "zustand/react/shallow";
import { PromptCard } from "@/components/prompt-card";
import { SessionStatus, sessionTitle } from "@/components/session-status";
import { useKratos } from "@/lib/kratos-store";

/** `/` — new work (owner's design): sending starts a new session; Recent lists all sessions. */
export function HomePage() {
  const { connected, agent, sessions, viewing, log, send } = useKratos(
    useShallow((s) => ({ connected: s.connected, agent: s.info?.agent, sessions: s.sessions, viewing: s.viewing, log: s.log, send: s.send })),
  );
  const navigate = useNavigate();
  // After sending, go to the session the prompt landed in — known once the server echoes it.
  const pending = useRef<{ text: string; viewing?: string; seen: number } | null>(null);

  useEffect(() => {
    const p = pending.current;
    if (!p || !viewing) return;
    const fresh = viewing !== p.viewing ? log : log.slice(p.seen); // only messages after the send
    if (fresh.some((m) => m.type === "user_prompt" && m.text === p.text)) {
      pending.current = null;
      navigate(`/s/${viewing}`);
    }
  }, [log, viewing, navigate]);

  const start = (text: string) => {
    pending.current = { text, viewing, seen: log.length };
    send({ type: "prompt", text, newSession: true });
  };
  const recent = sessions.filter((s) => s.title !== null); // sessions with at least one prompt

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pt-32 pb-20">
      <h1 className="text-center font-heading text-display font-semibold">What should we build?</h1>
      <PromptCard
        agent={agent ?? "Agent"}
        onSend={start}
        disabled={!connected}
        placeholder="Describe the change. Kratos will come back with a plan you can review before anything is built."
      />
      {recent.length > 0 && (
        <section aria-labelledby="recent" className="flex flex-col">
          <h2 id="recent" className="mb-2 text-sm font-medium text-muted-foreground">
            Recent
          </h2>
          {recent.map((session) => (
            <Link
              key={session.id}
              to={`/s/${session.id}`}
              className="-mx-2.5 flex min-h-12 items-center gap-3 rounded-lg px-2.5 hover:bg-accent"
            >
              <span className="flex-1 truncate">{sessionTitle(session)}</span>
              <SessionStatus status={session.status} />
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
