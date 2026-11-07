import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import type { ThemedToken } from "shiki";
import type { ChangedFile } from "@kratos/core";
import { SKIPPED } from "@/components/review/counts";
import { diffLinesOf, foldRows, lineSpans, pairRows, type DiffLine } from "@/lib/diff-rows";
import { languageFor, useLineTokens } from "@/lib/highlight";
import { cn } from "@/lib/utils";

type Tokens = ThemedToken[][] | undefined;

/**
 * One file's diff (the design's Diff board), unified (3v2) or split (3v3): line numbers, signs,
 * tinted rows with a bar on the left, syntax colour, changed words marked, unchanged runs folded
 * into bars that open. Keyed by file by its parent, so folds start closed for each file.
 */
export function DiffView({ file, layout }: { file: ChangedFile; layout: "split" | "unified" }) {
  const lines = useMemo(() => diffLinesOf(file.before ?? "", file.after ?? ""), [file.before, file.after]);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const rows = useMemo(() => foldRows(lines, open), [lines, open]);
  const pairs = useMemo(() => (layout === "split" ? pairRows(rows) : []), [layout, rows]);
  const lang = languageFor(file.path);
  const oldTokens = useLineTokens(file.before, lang);
  const newTokens = useLineTokens(file.after, lang);

  if (file.skipped) {
    return <div className="flex-none rounded-2xl bg-well px-6 py-8 text-sm text-muted-foreground ring-1 ring-border">{SKIPPED[file.skipped]}</div>;
  }
  const fold = (id: number, count: number) => (
    <Fold key={`fold-${id}`} count={count} split={layout === "split"} onOpen={() => setOpen((current) => new Set(current).add(id))} />
  );
  return (
    // A fixed-size box, like an editor, filling what the page leaves it and scrolling inside
    // (owner): the file's title above it never moves.
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-well ring-1 ring-border">
      {layout === "split" ? (
        // Each side half the width; long lines wrap, so both sides stay row by row.
        <div className="min-h-0 overflow-y-auto py-2.5">
          {pairs.map((pair, i) =>
            pair.type === "fold" ? (
              fold(pair.id, pair.count)
            ) : (
              <div key={i} className="grid grid-cols-2 font-mono text-sm/7.5">
                <Half line={pair.left} number={pair.left?.old} tokens={pair.left && oldTokens?.[pair.left.old! - 1]} />
                <Half line={pair.right} number={pair.right?.new} tokens={pair.right && newTokens?.[pair.right.new! - 1]} className="border-l border-border" />
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="min-h-0 overflow-auto py-2.5">
          {/* As wide as the longest line, so every row's tint spans the scrolled width. */}
          <div className="w-max min-w-full">
            {rows.map((row) => (row.type === "fold" ? fold(row.id, row.count) : <Line key={`${row.line.old ?? ""}-${row.line.new ?? ""}`} line={row.line} oldTokens={oldTokens} newTokens={newTokens} />))}
          </div>
        </div>
      )}
    </div>
  );
}

function Fold({ count, split, onOpen }: { count: number; split: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      // Indented to the code column: unified, two line numbers (w-13 each) and the sign (w-5);
      // split, one number (w-12) and the sign (w-4.5).
      className={cn(
        "my-1.5 flex h-10 w-full items-center gap-2.5 bg-secondary/60 pr-6 text-sm text-muted-foreground hover:bg-secondary hover:text-secondary-foreground",
        split ? "pl-16.5" : "pl-31",
      )}
    >
      <ChevronsUpDown className="size-4" aria-hidden="true" />
      Show {count} unchanged {count === 1 ? "line" : "lines"}
    </button>
  );
}

/** A unified row: both line numbers, the sign, the code. */
function Line({ line, oldTokens, newTokens }: { line: DiffLine; oldTokens: Tokens; newTokens: Tokens }) {
  const tokens = line.kind === "del" ? oldTokens?.[line.old! - 1] : newTokens?.[line.new! - 1];
  return (
    <div className={cn("relative flex font-mono text-sm/7.5", tint(line))}>
      <ChangeBar line={line} />
      <span className="w-13 flex-none pr-3.5 text-right text-xs/7.5 text-faint select-none">{line.old}</span>
      <span className="w-13 flex-none pr-3.5 text-right text-xs/7.5 text-faint select-none">{line.new}</span>
      <Sign line={line} className="w-5" />
      <Code line={line} tokens={tokens} className="pr-8 whitespace-pre" />
    </div>
  );
}

/** One side of a split row; hatched where this side has no line. */
function Half({ line, number, tokens, className }: { line: DiffLine | undefined; number: number | undefined; tokens: ThemedToken[] | undefined; className?: string }) {
  if (!line) return <div aria-hidden="true" className={cn("bg-hatch", className)} />;
  return (
    <div className={cn("relative flex min-w-0", tint(line), className)}>
      <ChangeBar line={line} />
      <span className="w-12 flex-none pr-3.5 text-right text-xs/7.5 text-faint select-none">{number}</span>
      <Sign line={line} className="w-4.5" />
      <Code line={line} tokens={tokens} className="min-w-0 flex-1 pr-4 whitespace-pre-wrap wrap-anywhere" />
    </div>
  );
}

const tint = (line: DiffLine) => (line.kind === "add" ? "bg-add/10" : line.kind === "del" ? "bg-destructive/10" : undefined);

function ChangeBar({ line }: { line: DiffLine }) {
  if (line.kind === "same") return null;
  return <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-0.75", line.kind === "add" ? "bg-add" : "bg-destructive")} />;
}

function Sign({ line, className }: { line: DiffLine; className: string }) {
  return (
    <span className={cn("flex-none text-center select-none", line.kind === "add" ? "text-add" : "text-destructive", className)}>
      {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
    </span>
  );
}

/** The line's code: Shiki's colours, changed words marked. */
function Code({ line, tokens, className }: { line: DiffLine; tokens: ThemedToken[] | undefined; className: string }) {
  return (
    <span className={cn("text-secondary-foreground", className)}>
      {lineSpans(line.text, tokens, line.marks).map((span, i) => (
        <span
          key={i}
          // The colour is Shiki's, from the code theme: data, not a design value.
          style={span.color ? { color: span.color } : undefined}
          className={cn(span.marked && "rounded-xs py-0.5", span.marked && (line.kind === "add" ? "bg-add/30" : "bg-destructive/30"))}
        >
          {span.text}
        </span>
      ))}
    </span>
  );
}
