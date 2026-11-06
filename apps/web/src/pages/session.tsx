import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import { AgentPicker } from "@/components/agent-picker";
import { PromptCard } from "@/components/prompt-card";
import { useKratos, type LogMessage } from "@/lib/kratos-store";

/** `/s/:sessionId` — one session's conversation. Opening the URL makes this tab view it. */
export function SessionPage() {
  const { sessionId } = useParams();
  const { connected, harnesses, sessions, viewing, log, send } = useKratos(
    useShallow((s) => ({ connected: s.connected, harnesses: s.harnesses, sessions: s.sessions, viewing: s.viewing, log: s.log, send: s.send })),
  );
  const session = sessions.find((s) => s.id === sessionId);

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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 pb-8">
      {/* 3c2 replaces this bare list with the AI Elements conversation. */}
      <ol className="flex flex-1 flex-col gap-3">
        {viewing === sessionId && log.map((message, i) => <BareMessage key={i} message={message} />)}
      </ol>
      <PromptCard
        agent={
          <AgentPicker
            harnesses={harnesses}
            value={{ harness: session?.harness ?? "", model: session?.model ?? null }}
            // Switches this session's model, live if its agent is running (D43). null = the default.
            onChange={(choice) => choice.model !== session?.model && send({ type: "set_model", model: choice.model ?? "default" })}
            harnessLocked
            disabled={!connected || viewing !== sessionId}
          />
        }
        onSend={(text) => send({ type: "prompt", text })}
        disabled={!connected || viewing !== sessionId}
        rows={2}
        placeholder="Reply…"
      />
    </main>
  );
}

function BareMessage({ message }: { message: LogMessage }) {
  if (message.type === "user_prompt") {
    return <li className="self-end rounded-2xl bg-secondary px-4 py-2 whitespace-pre-wrap">{message.text}</li>;
  }
  if (message.type === "agent_event" && message.event.kind === "text") {
    return <li className="whitespace-pre-wrap">{message.event.text}</li>;
  }
  if (message.type === "agent_event" && message.event.kind === "turn_end") {
    // A normal end needs no marker (owner); only say so when the turn was cut short.
    if (message.event.reason === "completed") return null;
    const why = message.event.reason === "interrupted" ? "Stopped" : `Stopped: ${message.event.error ?? "agent error"}`;
    return <li className="text-sm text-muted-foreground">{why}</li>;
  }
  const label =
    message.type === "agent_event" ? message.event.kind.replace("_", " ")
    : message.type === "permission_request" ? `asks to use ${message.request.tool}`
    : `ask ${message.outcome}`;
  return <li className="font-mono text-xs text-muted-foreground">{label}</li>;
}
