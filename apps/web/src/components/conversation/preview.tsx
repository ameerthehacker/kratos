import { diffLines } from "diff";
import { Command } from "@/components/conversation/command";
import type { Step } from "@/lib/timeline";
import { cn } from "@/lib/utils";

/**
 * What a step will change, readably (3c3): a diff for edits (jsdiff), the highlighted command for
 * runs, the raw call otherwise. Used by the ask dock and the "Show raw" view.
 */
export function Preview({ step, showOutput = false }: { step: Step; showOutput?: boolean }) {
  return (
    <div className="flex max-h-72 flex-col gap-1 overflow-auto rounded-lg bg-well px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre">
      {step.edit ? (
        <EditDiff edit={step.edit} />
      ) : step.raw.command ? (
        <Command text={step.raw.command} />
      ) : (
        <span className="text-secondary-foreground">{step.raw.call}</span>
      )}
      {showOutput && step.raw.output && <div className="text-muted-foreground">{step.raw.output}</div>}
    </div>
  );
}

function EditDiff({ edit }: { edit: NonNullable<Step["edit"]> }) {
  const isNew = edit.changes.length === 1 && edit.changes[0]!.before === "";
  return (
    <>
      <div className="text-faint">
        {edit.path} {isNew ? "· new file" : ""}
      </div>
      {edit.changes.map((change, i) => (
        <div key={i}>
          {i > 0 && <div className="text-faint">⋯</div>}
          {diffLines(change.before, change.after).map((part, j) =>
            lines(part.value).map((line, k) => (
              <div
                key={`${j}-${k}`}
                className={cn(part.added ? "text-add" : part.removed ? "text-destructive" : "text-muted-foreground")}
              >
                {part.added ? "+ " : part.removed ? "− " : "  "}
                {line}
              </div>
            )),
          )}
          {change.truncated && <div className="text-faint">… preview cut short</div>}
        </div>
      ))}
    </>
  );
}

/** A diff part's text as lines (jsdiff keeps the trailing newline on each part). */
const lines = (text: string) => text.replace(/\n$/, "").split("\n");
