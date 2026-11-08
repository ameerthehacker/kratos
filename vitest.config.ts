import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * `pnpm test` runs Vitest over the whole repo (D28). Agent sessions keep git worktrees under
 * `.claude/worktrees/` — full copies of the repo on other branches — so skip `.claude/` too,
 * or their tests run here as well (and fail, without their own installs).
 */
export default defineConfig({
  // The web app's "@/…" imports (apps/web/vite.config.ts), so its modules can be tested too.
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "apps/web/src") } },
  test: {
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
