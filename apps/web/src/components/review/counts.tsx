import type { ChangedFile } from "@kratos/core";
import { cn } from "@/lib/utils";

/** "+12 −3" in the diff colours. */
export function Counts({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
  return (
    <span className={cn("font-mono", className)}>
      <span className="text-add">+{additions}</span> <span className="text-destructive">−{deletions}</span>
    </span>
  );
}

/** A file's +/− in five blocks, like GitHub's: green for added, red for removed, the rest empty. */
export function ChangeBlocks({ file }: { file: ChangedFile }) {
  const total = Math.max(file.additions + file.deletions, 1);
  const added = Math.round((5 * file.additions) / total);
  const removed = Math.min(5 - added, Math.round((5 * file.deletions) / total));
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((k) => (
        <span key={k} className={cn("size-1.75 rounded-xs", k < added ? "bg-add" : k < added + removed ? "bg-destructive" : "bg-input")} />
      ))}
    </span>
  );
}

/** Why a file has no diff to show. */
export const SKIPPED: Record<NonNullable<ChangedFile["skipped"]>, string> = {
  binary: "Binary file, not shown",
  too_big: "Too big to show here",
  submodule: "A submodule or nested repository: its changes are in that repository",
};
