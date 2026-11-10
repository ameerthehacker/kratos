import { useMemo } from "react";
import { Command } from "@/components/conversation/command";
import { diffLinesOf, foldRows } from "@/lib/diff-rows";
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
        // Long unchanged runs fold to a count, as in review (3v), only in a plan's change: a whole
        // file (4p3b). An edit you're asked to allow shows every line of it.
        <EditDiff edit={step.edit} fold={step.id.startsWith("plan-")} />
      ) : step.raw.command ? (
        <Command text={step.raw.command} />
      ) : (
        <span className="text-secondary-foreground">{step.raw.call}</span>
      )}
      {showOutput && step.raw.output && <div className="text-muted-foreground">{step.raw.output}</div>}
    </div>
  );
}

function EditDiff({ edit, fold }: { edit: NonNullable<Step["edit"]>; fold: boolean }) {
  const isNew = edit.changes.length === 1 && edit.changes[0]!.before === "";
  return (
    <>
      <div className="text-faint">
        {edit.path} {isNew ? "· new file" : ""}
      </div>
      {edit.changes.map((change, i) => (
        <div key={i}>
          {i > 0 && <div className="text-faint">⋯</div>}
          <ChangeRows before={change.before} after={change.after} fold={fold} />
          {change.truncated && <div className="text-faint">… preview cut short</div>}
        </div>
      ))}
    </>
  );
}

/** One change's lines, diffed once per text (the chat redraws what's on screen with every message). */
function ChangeRows({ before, after, fold }: { before: string; after: string; fold: boolean }) {
  const rows = useMemo(() => {
    const lines = diffLinesOf(before, after);
    return fold ? foldRows(lines) : lines.map((line) => ({ type: "line" as const, line }));
  }, [before, after, fold]);
  return rows.map((row, j) =>
    row.type === "fold" ? (
      <div key={`fold-${row.id}`} className="text-faint">
        ⋯ {row.count} unchanged {row.count === 1 ? "line" : "lines"}
      </div>
    ) : (
      <div key={j} className={cn(row.line.kind === "add" ? "text-add" : row.line.kind === "del" ? "text-destructive" : "text-muted-foreground")}>
        {row.line.kind === "add" ? "+ " : row.line.kind === "del" ? "− " : "  "}
        {row.line.text}
      </div>
    ),
  );
}
