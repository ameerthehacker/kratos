import ClaudeMark from "@/assets/claude-logo.svg?react";

/** Claude's official mark (from claude.ai's own icon, D43), in its brand color. */
export function ClaudeLogo({ className }: { className?: string }) {
  return <ClaudeMark aria-hidden="true" className={className ?? "size-4 text-claude"} />;
}
