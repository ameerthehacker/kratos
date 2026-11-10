import picomatch from "picomatch/posix.js";

/**
 * Whether a project-relative path is in a step's Scope (4p7, D79): its entries are globs
 * (picomatch, `dot: true`), and a plain path is itself or, as a folder, everything under it — the
 * format says `path/or/glob`, so `src/plans/` and `src/plans` both cover `src/plans/a.ts`. Shared
 * by the hub's drift check and the notice's "added", so they can't disagree. The posix build: no
 * Node parts, so the browser bundles it too.
 */
export function scopeMatcher(scope: string[]): (path: string) => boolean {
  const globs = scope.flatMap((entry) => {
    const glob = entry.trim().replace(/^\.?\/+/, "");
    if (!glob) return [];
    if (picomatch.scan(glob).isGlob) return [glob];
    const folder = glob.replace(/\/+$/, "");
    return [folder, `${folder}/**`];
  });
  if (globs.length === 0) return () => false;
  const match = picomatch(globs, { dot: true });
  return (path) => match(path);
}
