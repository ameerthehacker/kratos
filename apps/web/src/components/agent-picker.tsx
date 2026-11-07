import type { AgentModel, Harness } from "@kratos/core";
import { capitalize } from "lodash-es";
import { ChevronDown } from "lucide-react";
import { ClaudeLogo } from "@/components/claude-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** `effort`: the level picked or in use; null/absent = none known yet (the agent's default). */
export type AgentChoice = { harness: string; model: string | null; effort?: string | null };

/**
 * The prompt card's agent chip (D43): "logo · Claude Code · Opus High ▾". Opens a menu to pick
 * the harness and its model — the latest aliases, then older versions in a submenu — and, when
 * the model has levels, its effort in an "Effort ›" submenu (D51, like Claude's own picker).
 */
export function AgentPicker(props: {
  harnesses: Harness[];
  value: AgentChoice;
  onChange: (choice: AgentChoice) => void;
  /** In a running session the harness is fixed; only the model can change. */
  harnessLocked?: boolean;
  disabled?: boolean;
}) {
  const harness = props.harnesses.find((h) => h.id === props.value.harness);
  const models = harness?.models ?? [];
  const latest = models.filter((m) => m.group === "latest");
  const other = models.filter((m) => m.group === "other");
  // No model chosen (null) is shown as the agent's own default entry, whatever its id (3c4).
  const selected = props.value.model ?? models.find((m) => m.isDefault)?.id ?? "";
  const pickModel = (id: string) => {
    const isDefault = models.find((m) => m.id === id)?.isDefault ?? false;
    props.onChange({ ...props.value, model: isDefault ? null : id });
  };
  // The selected model's effort levels, as the agent reports them; none = no effort control.
  // A level the model doesn't list is never shown — e.g. right after a model switch, until the
  // agent says which level it moved to (D51).
  const efforts = models.find((m) => m.id === selected)?.efforts ?? [];
  const effort = props.value.effort && efforts.includes(props.value.effort) ? props.value.effort : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={props.disabled || !harness}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs whitespace-nowrap text-secondary-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <HarnessIcon id={props.value.harness} />
        {harness?.name ?? "Connecting…"}
        {harness && <span className="text-muted-foreground">· {modelLabel(models, props.value.model)}</span>}
        {effort && <span className="text-muted-foreground/70">{effortLabel(effort)}</span>}
        <ChevronDown className="size-3 text-muted-foreground" strokeWidth={2.2} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Harness</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={props.value.harness}
            onValueChange={(id: string) => props.onChange({ harness: id, model: null, effort: null })}
          >
            {props.harnesses.map((h) => (
              <DropdownMenuRadioItem
                key={h.id}
                value={h.id}
                closeOnClick
                disabled={props.harnessLocked && h.id !== props.value.harness}
              >
                <HarnessIcon id={h.id} />
                {h.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Model</DropdownMenuLabel>
          {models.length === 0 && <p className="px-1.5 py-1 text-sm text-muted-foreground">The agent's default</p>}
          <DropdownMenuRadioGroup value={selected} onValueChange={pickModel}>
            {latest.map((m) => (
              <ModelItem key={m.id} model={m} />
            ))}
          </DropdownMenuRadioGroup>
          {other.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Other versions
                {other.some((m) => m.id === selected) && (
                  <span className="ml-auto text-xs text-muted-foreground">{modelLabel(models, selected)}</span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                <DropdownMenuRadioGroup value={selected} onValueChange={pickModel}>
                  {other.map((m) => (
                    <ModelItem key={m.id} model={m} />
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuGroup>
        {efforts.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Effort
                <span className="ml-auto text-xs text-muted-foreground">{effort ? effortLabel(effort) : "Default"}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal">
                    Higher effort works more thoroughly, but takes longer and uses more of your limits.
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={effort ?? ""}
                    onValueChange={(level: string) => props.onChange({ ...props.value, effort: level })}
                  >
                    {efforts.map((level) => (
                      <DropdownMenuRadioItem key={level} value={level} closeOnClick>
                        {effortLabel(level)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelItem({ model }: { model: AgentModel }) {
  return (
    // closeOnClick: Base UI keeps a menu open after a radio pick by default.
    <DropdownMenuRadioItem value={model.id} closeOnClick className="items-start">
      <span className="flex flex-col">
        {model.label}
        {model.description && <span className="text-xs text-muted-foreground">{model.description}</span>}
      </span>
    </DropdownMenuRadioItem>
  );
}

function HarnessIcon({ id }: { id: string }) {
  if (id === "claude-code") return <ClaudeLogo className="size-3.5 text-claude" />;
  return <span className="size-2 rounded-full bg-primary" aria-hidden="true" />;
}

/** What the chip shows for a model: its label, the raw id if the agent doesn't list it, or "Default". */
export function modelLabel(models: AgentModel[], id: string | null): string {
  const found = models.find((m) => (id === null ? m.isDefault : m.id === id));
  if (found) return shortLabel(found.label);
  return id ?? "Default";
}

/** The CLI's labels can be long ("Default (recommended)"): the chip shows the part before "(". */
function shortLabel(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, "") || label;
}

/** Claude's level ids → words; an id Kratos doesn't know yet is shown capitalized. */
const EFFORT_LABELS: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
export function effortLabel(level: string): string {
  return EFFORT_LABELS[level] ?? capitalize(level);
}
