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
    /** The effort level chosen for it (D51); null = never chosen (the agent's default). */
    effort: text("effort"),
    /** The permission mode it runs in, as last chosen or reported by the agent (D53); null = the
     * agent's default, never chosen. */
    permissionMode: text("permission_mode"),
    /** When the owner marked the session done (3d2); null = still being worked on. */
    doneAt: integer("done_at", { mode: "timestamp_ms" }),
    /** The feature it belongs to (D73); null = a one-off. Can change: "Move to feature…". */
    featureId: text("feature_id").references(() => features.id),
    /** Set the first time the agent process starts; from then on, starts must resume. */
    agentStartedAt: integer("agent_started_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("sessions_by_project").on(t.projectDir, t.updatedAt)],
);

/** A piece of work that groups sessions, and later holds their plan (D73). Belongs to one
 * project; a session points at one, or none (a one-off). */
export const features = sqliteTable(
  "features",
  {
    id: text("id").primaryKey(),
    projectDir: text("project_dir").notNull(),
    /** As the owner named it (1–80 chars, trimmed); later, the approved plan's title. */
    title: text("title").notNull(),
    /** When the owner marked it done; null = still being worked on. Its sessions keep their own. */
    doneAt: integer("done_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("features_by_project").on(t.projectDir, t.updatedAt)],
);

/** Files sent with prompts (D55): what they are; the bytes are a file named by `id` in the
 * attachments folder next to the database. */
export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["image", "pdf", "text"] }).notNull(),
  mediaType: text("media_type").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

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

/** The project's files at a session's turn boundaries (3v1, D65): `tree` is a git tree id. A turn
 * the agent starts by itself (queued prompts) has no `turn_start`: the previous `turn_end` is it. */
export const snapshots = sqliteTable(
  "snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    kind: text("kind", { enum: ["turn_start", "turn_end"] }).notNull(),
    tree: text("tree").notNull(),
    /** Where in the session log it was taken: the `seq` the next message gets. Orders snapshots
     * against turns exactly (timestamps can tie). Null for snapshots taken before it existed. */
    logSeq: integer("log_seq"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("snapshots_by_session").on(t.sessionId, t.id)],
);

/** Files the owner marked viewed while reviewing a session's changes (3v3), one row per file:
 * the version viewed (before..after git object ids). Another version = changed since. */
export const viewedFiles = sqliteTable(
  "viewed_files",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    path: text("path").notNull(),
    version: text("version").notNull(),
    viewedAt: integer("viewed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.path] })],
);
