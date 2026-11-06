import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useShallow } from "zustand/react/shallow";
import type { Harness } from "@kratos/core";
import { AgentPicker, type AgentChoice } from "@/components/agent-picker";
import { PromptCard } from "@/components/prompt-card";
import { RecentList } from "@/components/recent-list";
import { useHomeChoice } from "@/lib/home-choice";
import { useKratos } from "@/lib/kratos-store";

/** `/` — new work (owner's design): sending starts a new session; Recent lists all sessions. */
export function HomePage() {
  const { connected, harnesses, sessions, viewing, log, send } = useKratos(
    useShallow((s) => ({ connected: s.connected, harnesses: s.harnesses, sessions: s.sessions, viewing: s.viewing, log: s.log, send: s.send })),
  );
  const { choice: remembered, setChoice } = useHomeChoice();
  const choice = currentChoice(remembered, harnesses);
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
    send({ type: "prompt", text, newSession: true, harness: choice?.harness, model: choice?.model ?? undefined });
  };
  const recent = sessions.filter((s) => s.title !== null); // sessions with at least one prompt

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pt-32 pb-20">
        <h1 className="text-center font-heading text-display font-semibold">What should we build?</h1>
        <PromptCard
          agent={<AgentPicker harnesses={harnesses} value={choice ?? { harness: "", model: null }} onChange={setChoice} />}
          onSend={start}
          disabled={!connected}
          placeholder="Describe a change…"
        />
        <RecentList sessions={recent} harnesses={harnesses} />
      </div>
    </main>
  );
}

/** The remembered choice, if the server still offers it; else the first harness on its default model. */
function currentChoice(remembered: AgentChoice | undefined, harnesses: Harness[]): AgentChoice | undefined {
  const harness = harnesses.find((h) => h.id === remembered?.harness) ?? harnesses[0];
  if (!harness) return undefined;
  const model = remembered?.harness === harness.id ? remembered.model : null;
  // A remembered model the agent no longer lists falls back to the default (an empty list = can't tell).
  const known = model === null || harness.models.length === 0 || harness.models.some((m) => m.id === model);
  return { harness: harness.id, model: known ? model : null };
}
