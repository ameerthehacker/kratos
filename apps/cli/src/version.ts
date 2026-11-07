import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Where Kratos lives (3u1): releases and commits link here. */
export const REPOSITORY = "https://github.com/ameerthehacker/kratos";

/** What the header pill shows, and where clicking it goes. */
export type KratosVersion = { version: string; url?: string };

/** Where the version comes from; real by default, faked in tests. */
export type VersionSources = { packageVersion: () => string | undefined; commit: () => string | undefined };

/**
 * Kratos's own version (3u1, D57). A release sets `apps/cli/package.json`'s version from its tag
 * ("0.3.1" → its GitHub release); unreleased code is 0.0.0, so it shows the commit it runs from
 * ("ab9151c" → that commit), as the design's default does; failing that, "dev".
 */
export function kratosVersion(sources: VersionSources = realSources): KratosVersion {
  const released = sources.packageVersion();
  if (released && released !== "0.0.0") return { version: released, url: `${REPOSITORY}/releases/tag/v${released}` };
  const commit = sources.commit();
  return commit ? { version: commit, url: `${REPOSITORY}/commit/${commit}` } : { version: "dev" };
}

const realSources: VersionSources = {
  // Same path from src/ and dist/: both sit one level below apps/cli.
  packageVersion: () => JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version,
  // The checkout Kratos runs from (not the project it works on).
  commit: () => {
    try {
      const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: fileURLToPath(new URL(".", import.meta.url)),
        stdio: ["ignore", "pipe", "ignore"],
      });
      return sha.toString().trim() || undefined;
    } catch {
      return undefined; // not a git checkout, or no git
    }
  },
};
