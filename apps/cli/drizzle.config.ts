import { defineConfig } from "drizzle-kit";

// Used only by `pnpm --filter @kratos/cli db:generate` to turn schema changes into SQL migrations.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/store/schema.ts",
  out: "./drizzle",
});
