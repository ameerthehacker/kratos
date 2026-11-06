import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ServerMessage } from "@kratos/core";

/**
 * Kratos's SQLite schema (D36). Change it here, then run `pnpm --filter @kratos/cli db:generate`
 * to create the SQL migration in `apps/cli/drizzle/` — never edit the database by hand.
 */

/** One conversation. `id` is also the agent's own conversation id (claude --session-id/--resume). */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectDir: text("project_dir").notNull(),
    agent: text("agent").notNull(),
    /** The session's first prompt, shown in the Recent list / sidebar (D41). */
    title: text("title"),
    /** The model the session runs with (D43); null = the agent's default. `agent` = harness id. */
    model: text("model"),
    /** When the owner marked the session done (3d2); null = still being worked on. */
    doneAt: integer("done_at", { mode: "timestamp_ms" }),
    /** Set the first time the agent process starts; from then on, starts must resume. */
    agentStartedAt: integer("agent_started_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("sessions_by_project").on(t.projectDir, t.updatedAt)],
);

/** The session log: every message the hub published to tabs, in order (`seq` from 0). */
export const messages = sqliteTable(
  "messages",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    seq: integer("seq").notNull(),
    message: text("message", { mode: "json" }).$type<ServerMessage>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.seq] })],
);
