import { useState } from "react";
import type { ServerMessage } from "@kratos/core";
import { KratosLogo } from "@/components/kratos-logo";
import { PromptCard } from "@/components/prompt-card";
import { useKratos } from "@/hooks/use-kratos";
import { cn } from "@/lib/utils";

export function App() {
  const { connected, info, log, send } = useKratos();
  const [atHome, setAtHome] = useState(false); // the logo opens Home even mid-conversation
  const agent = info?.agent ?? "Agent";
  const started = log.some((m) => m.type === "user_prompt");
  const reply = (text: string) => send({ type: "prompt", text });
  // Home = new work: the server starts a fresh session (unless the current one is still empty).
  const startFromHome = (text: string) => {
    send({ type: "prompt", text, newSession: true });
    setAtHome(false);
  };

  return (
    <div className="flex min-h-screen flex-col text-body antialiased">
      <header className="flex min-h-16 items-center gap-4 px-6 py-3">
        <a
          href="/"
          aria-label="Kratos home"
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={(e) => {
            e.preventDefault();
            setAtHome(true);
          }}
        >
          <KratosLogo />
        </a>
        <span className="flex-1" />
        {info && <span className="truncate font-mono text-xs text-muted-foreground" title={info.cwd}>{info.cwd}</span>}
        <span
          className={cn("size-2 shrink-0 rounded-full", connected ? "bg-primary" : "animate-pulse bg-wait")}
          title={connected ? "Connected" : "Connecting…"}
          aria-label={connected ? "Connected" : "Connecting"}
        />
      </header>

      {started && !atHome ? (
        // 3c1: a bare list; 3c2 replaces it with the AI Elements conversation.
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 pb-8">
          <ol className="flex flex-1 flex-col gap-3">
            {log.map((message, i) => (
              <BareMessage key={i} message={message} />
            ))}
          </ol>
          <PromptCard agent={agent} onSend={reply} disabled={!connected} rows={2} placeholder="Reply…" />
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pt-32 pb-20">
          <h1 className="text-center font-heading text-display font-semibold">
            What should we build?
          </h1>
          <PromptCard
            agent={agent}
            onSend={startFromHome}
            disabled={!connected}
            placeholder="Describe the change. Kratos will come back with a plan you can review before anything is built."
          />
        </main>
      )}
    </div>
  );
}

function BareMessage({ message }: { message: ServerMessage }) {
  if (message.type === "user_prompt") {
    return <li className="self-end rounded-2xl bg-secondary px-4 py-2 whitespace-pre-wrap">{message.text}</li>;
  }
  if (message.type === "agent_event" && message.event.kind === "text") {
    return <li className="whitespace-pre-wrap">{message.event.text}</li>;
  }
  const label =
    message.type === "agent_event" ? message.event.kind.replace("_", " ")
    : message.type === "permission_request" ? `asks to use ${message.request.tool}`
    : message.type === "permission_resolved" ? `ask ${message.outcome}`
    : message.type;
  return <li className="font-mono text-xs text-muted-foreground">{label}</li>;
}
