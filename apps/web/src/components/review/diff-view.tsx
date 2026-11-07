import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import type { ThemedToken } from "shiki";
import type { ChangedFile } from "@kratos/core";
import { SKIPPED } from "@/components/review/counts";
import { diffLinesOf, foldRows, lineSpans, type DiffLine } from "@/lib/diff-rows";
import { languageFor, useLineTokens } from "@/lib/highlight";
import { cn } from "@/lib/utils";

/**
 * One file's diff, unified (3v2, the design's Diff board): both line numbers, the sign, tinted
 * rows with a bar on the left, syntax colour, changed words marked, unchanged runs folded into
 * bars that open. Keyed by file by its parent, so folds start closed for each file.
 */
export function DiffView({ file }: { file: ChangedFile }) {
  const lines = useMemo(() => diffLinesOf(file.before ?? "", file.after ?? ""), [file.before, file.after]);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const rows = useMemo(() => foldRows(lines, open), [lines, open]);
  const lang = languageFor(file.path);
  const oldTokens = useLineTokens(file.before, lang);
  const newTokens = useLineTokens(file.after, lang);

  if (file.skipped) {
    return <div className="rounded-2xl bg-well px-6 py-8 text-sm text-muted-foreground ring-1 ring-border">{SKIPPED[file.skipped]}</div>;
  }
  return (
    <div className="overflow-hidden rounded-2xl bg-well ring-1 ring-border">
      <div className="overflow-x-auto py-2.5">
        {/* As wide as the longest line, so every row's tint spans the scrolled width. */}
        <div className="w-max min-w-full">
          {rows.map((row) =>
            row.type === "fold" ? (
              <button
                key={`fold-${row.id}`}
                type="button"
                onClick={() => setOpen((current) => new Set(current).add(row.id))}
                // Indented to the code column: two line numbers (w-13 each) and the sign (w-5).
                className="my-1.5 flex h-10 w-full items-center gap-2.5 bg-secondary/60 pr-6 pl-31 text-sm text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
              >
                <ChevronsUpDown className="size-4" aria-hidden="true" />
                Show {row.count} unchanged {row.count === 1 ? "line" : "lines"}
              </button>
            ) : (
              <Line key={`${row.line.old ?? ""}-${row.line.new ?? ""}`} line={row.line} tokens={row.line.kind === "del" ? oldTokens?.[row.line.old! - 1] : newTokens?.[row.line.new! - 1]} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ line, tokens }: { line: DiffLine; tokens: ThemedToken[] | undefined }) {
  const added = line.kind === "add";
  const removed = line.kind === "del";
  return (
    <div className={cn("relative flex font-mono text-sm/7.5", added && "bg-add/10", removed && "bg-destructive/10")}>
      {(added || removed) && <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-0.75", added ? "bg-add" : "bg-destructive")} />}
      <span className="w-13 flex-none pr-3.5 text-right text-xs/7.5 text-faint select-none">{line.old}</span>
      <span className="w-13 flex-none pr-3.5 text-right text-xs/7.5 text-faint select-none">{line.new}</span>
      <span className={cn("w-5 flex-none text-center select-none", added ? "text-add" : "text-destructive")}>{added ? "+" : removed ? "−" : ""}</span>
      <span className="pr-8 whitespace-pre text-secondary-foreground">
        {lineSpans(line.text, tokens, line.marks).map((span, i) => (
          <span
            key={i}
            // The colour is Shiki's, from the code theme: data, not a design value.
            style={span.color ? { color: span.color } : undefined}
            className={cn(span.marked && "rounded-xs py-0.5", span.marked && (added ? "bg-add/30" : "bg-destructive/30"))}
          >
            {span.text}
          </span>
        ))}
      </span>
    </div>
  );
}
