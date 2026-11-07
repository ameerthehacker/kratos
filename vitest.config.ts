import { configDefaults, defineConfig } from "vitest/config";

/**
 * `pnpm test` runs Vitest over the whole repo (D28). Agent sessions keep git worktrees under
 * `.claude/worktrees/` — full copies of the repo on other branches — so skip `.claude/` too,
 * or their tests run here as well (and fail, without their own installs).
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
