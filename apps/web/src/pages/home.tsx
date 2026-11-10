import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import type { AttachmentUpload, Harness } from "@kratos/core";
import { AgentPicker, type AgentChoice } from "@/components/agent-picker";
import { FeaturePill } from "@/components/feature-pill";
import { PermissionPicker } from "@/components/permission-picker";
import { askToNotify } from "@/hooks/use-attention";
import { PromptCard } from "@/components/prompt-card";
import { Shortcut } from "@/components/shortcut";
import { PROMPT_KEYS } from "@/lib/shortcuts";
import { RecentList } from "@/components/recent-list";
import { useHomeChoice } from "@/lib/home-choice";
import { useKratos } from "@/lib/kratos-store";
import { usePlan } from "@/hooks/use-plan";
import { startable } from "@/components/plan-parts";
import { cn } from "@/lib/utils";

/** `/` — new work (owner's design): sending starts a new session; Recent lists all sessions. */
export function HomePage() {
  const { connected, harnesses, sessions, features, viewing, log, send } = useKratos(
    useShallow((s) => ({ connected: s.connected, harnesses: s.harnesses, sessions: s.sessions, features: s.features, viewing: s.viewing, log: s.log, send: s.send })),
  );
  // What the new session belongs to (D73): a one-off unless picked, or preset by a folder's +
  // (`/?feature=<id>`), or a new feature named on the shelf (`?new=<name>`: the server makes it
  // when this prompt starts the session). Kept in the URL, so it isn't remembered for the next
  // one; a feature that's gone or done falls back to a one-off.
  const [params, setParams] = useSearchParams();
  const newFeatureTitle = params.get("new")?.trim() || null;
  const featureId = newFeatureTitle ? null : (features.find((f) => f.id === params.get("feature") && !f.done)?.id ?? null);
  // Its plan's next steps (4p5b): a chip, or ▶ on a step elsewhere (`&step=P3`), starts the
  // session on one — the prompt filled once, the session tagged with it.
  const feature = features.find((f) => f.id === featureId);
  const featurePlan = usePlan("feature", feature?.hasPlan ? feature.id : undefined)?.plan ?? undefined;
  const upNext = featurePlan?.steps.filter(startable).slice(0, 3) ?? [];
  const stepParam = params.get("step");
  // Only a step still to do, as the chips and ▶ offer: an old link to a finished one tags nothing.
  const step = featureId && stepParam ? featurePlan?.steps.find((s) => s.id === stepParam && startable(s)) : undefined;
  // Picking another step replaces the last one's prompt, if it's still there untouched.
  const [insert, setInsert] = useState<{ text: string; key: number; replaces?: string }>();
  // Which step it filled the prompt for, by feature too: every plan has a P1.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    const which = step?.id && `${featureId}:${step.id}`;
    if (!which || filledFor.current === which) return;
    filledFor.current = which;
    setInsert((current) => ({ text: `Work on ${step.id} of the plan: ${step.title}.`, key: (current?.key ?? 0) + 1, replaces: current?.text }));
  }, [featureId, step?.id, step?.title]);
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

  // ⌘↵ (3z5): start it but stay here, the box cleared and focused for the next one. A new feature
  // it named is made by the server: the pill then picks it, so the next ones join it.
  // Only a feature that wasn't there at the send counts, so one already named the same isn't picked.
  const awaitedFeature = useRef<{ title: string; existing: Set<string> } | null>(null);
  // This page's own URL changes (the shelf's choice) aren't landing here: they keep the focus.
  const ownParams = useRef(false);
  const choose = (next: Record<string, string>) => {
    ownParams.current = true;
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const awaited = awaitedFeature.current;
    const made = awaited && features.find((f) => f.title === awaited.title && !f.done && !awaited.existing.has(f.id));
    if (!made) return;
    awaitedFeature.current = null;
    ownParams.current = true;
    setParams({ feature: made.id }, { replace: true });
  }, [features, setParams]);
  // Landing here (New session, its shortcut, opening Kratos) puts the cursor in the box.
  const { key } = useLocation();
  useEffect(() => {
    if (ownParams.current) ownParams.current = false;
    else document.getElementById("prompt")?.focus();
  }, [key]);

  const start = (text: string, attachments: AttachmentUpload[], { mod: stay }: { mod: boolean }) => {
    if (!stay) pending.current = { text, viewing, seen: log.length }; // go to it once it lands
    else if (newFeatureTitle) {
      awaitedFeature.current = { title: newFeatureTitle, existing: new Set(features.map((f) => f.id)) };
      choose({}); // not a second one with the same name
    } else if (step && featureId) {
      filledFor.current = null; // the step went with this one: the next starts on none, unless picked again
      choose({ feature: featureId });
    }
    askToNotify(); // once, from this click: so Kratos can tell you when the agent needs you
    send({
      type: "prompt",
      text,
      newSession: true,
      harness: choice?.harness,
      model: choice?.model ?? undefined,
      effort: choice?.effort ?? undefined,
      permissionMode: permissionMode ?? undefined,
      featureId: featureId ?? undefined,
      stepId: step?.id,
      newFeatureTitle: newFeatureTitle ?? undefined,
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
        {upNext.length > 0 && (
          // Close to the box it fills (the design's "Up next", board §5b).
          <div className="-mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Up next in the plan">
            <span className="text-xs font-semibold tracking-wider text-faint uppercase">Up next</span>
            {upNext.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={step?.id === s.id}
                onClick={() => choose(step?.id === s.id ? { feature: featureId! } : { feature: featureId!, step: s.id! })}
                className={cn(
                  "flex h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring",
                  step?.id === s.id ? "bg-primary/15 text-foreground ring-1 ring-primary/40" : "bg-secondary text-secondary-foreground hover:bg-accent",
                )}
              >
                <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                <span className="truncate">{s.title}</span>
              </button>
            ))}
          </div>
        )}
        <PromptCard
          insert={insert}
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
          shelf={
            <>
              <FeaturePill
                features={features}
                value={featureId}
                newTitle={newFeatureTitle}
                onChange={(id) => choose(id ? { feature: id } : {})}
                onCreate={(name) => choose({ new: name })}
              />
              {/* ⌘↵ isn't something you'd guess: said where you type (3z5). */}
              <span className="ml-auto flex items-center gap-1.5 pr-1 text-xs text-faint max-sm:hidden">
                <Shortcut hotkey={PROMPT_KEYS.startAndStay} variant="faint" />
                start and stay here
              </span>
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
