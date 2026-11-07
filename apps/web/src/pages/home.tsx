import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useShallow } from "zustand/react/shallow";
import type { AttachmentUpload, Harness } from "@kratos/core";
import { AgentPicker, type AgentChoice } from "@/components/agent-picker";
import { PermissionPicker } from "@/components/permission-picker";
import { askToNotify } from "@/hooks/use-attention";
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
  const harness = harnesses.find((h) => h.id === choice?.harness);
  const permissionMode = choice?.permissionMode ?? null;
  // A dangerous mode (Bypass) is only ever stored after its consent dialog, so sending it
  // carries that consent (owner: remember Bypass too; D53).
  const dangerous = harness?.permissionModes.find((m) => m.id === permissionMode)?.dangerous ?? false;
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

  const start = (text: string, attachments: AttachmentUpload[]) => {
    pending.current = { text, viewing, seen: log.length };
    askToNotify(); // once, from this click: so Kratos can tell you when the agent needs you
    send({
      type: "prompt",
      text,
      newSession: true,
      harness: choice?.harness,
      model: choice?.model ?? undefined,
      effort: choice?.effort ?? undefined,
      permissionMode: permissionMode ?? undefined,
      ...(attachments.length > 0 ? { attachments } : {}),
      confirmDangerous: dangerous || undefined,
    });
  };
  // Sessions with at least one prompt, not marked done (owner, 3d2: done ones live in the sidebar).
  const recent = sessions.filter((s) => s.title !== null && !s.done);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pt-32 pb-20">
        <h1 className="text-center font-heading text-display font-semibold">What should we build?</h1>
        <PromptCard
          chips={
            <>
              <AgentPicker harnesses={harnesses} value={choice ?? { harness: "", model: null }} onChange={setChoice} />
              <PermissionPicker
                agentName={harness?.name ?? "The agent"}
                modes={harness?.permissionModes ?? []}
                value={permissionMode}
                onChange={(id, confirmed) => {
                  const mode = harness?.permissionModes.find((m) => m.id === id);
                  if (!choice || !mode || (mode.dangerous && !confirmed)) return;
                  setChoice({ ...choice, permissionMode: mode.isDefault ? null : id }); // default = none chosen
                }}
              />
            </>
          }
          onSend={start}
          attachments={harness?.attachments}
          disabled={!connected}
          placeholder="Describe a change…"
        />
        <RecentList sessions={recent} harnesses={harnesses} />
      </div>
    </main>
  );
}

/** The remembered choice, if the server still offers it; else the first harness on its default
 * model. A remembered effort level counts only if the chosen model has it (D51); a remembered
 * permission mode only if the harness still has it (D53). */
function currentChoice(remembered: AgentChoice | undefined, harnesses: Harness[]): AgentChoice | undefined {
  const harness = harnesses.find((h) => h.id === remembered?.harness) ?? harnesses[0];
  if (!harness) return undefined;
  const model = remembered?.harness === harness.id ? remembered.model : null;
  // A remembered model the agent no longer lists falls back to the default (an empty list = can't tell).
  const known = model === null || harness.models.length === 0 || harness.models.some((m) => m.id === model);
  const chosen = known ? model : null;
  const levels = harness.models.find((m) => (chosen === null ? m.isDefault : m.id === chosen))?.efforts ?? [];
  const effort = remembered?.harness === harness.id && remembered.effort && levels.includes(remembered.effort) ? remembered.effort : null;
  const rememberedMode = remembered?.harness === harness.id ? remembered.permissionMode : null;
  const mode = harness.permissionModes.find((m) => m.id === rememberedMode);
  return { harness: harness.id, model: chosen, effort, permissionMode: mode?.id ?? null };
}
