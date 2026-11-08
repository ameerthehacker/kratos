import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { ServerMessage } from "@kratos/core";
import { MIGRATIONS } from "../paths.js";
import { attachments, features, messages, sessions, snapshots, viewedFiles } from "./schema.js";


export type StoredSession = typeof sessions.$inferSelect;
export type StoredAttachment = typeof attachments.$inferSelect;
export type StoredSnapshot = typeof snapshots.$inferSelect;
export type StoredFeature = typeof features.$inferSelect;

/** Most recently active first; a tie (same millisecond) goes to the later-created session. */
const NEWEST_FIRST = [desc(sessions.updatedAt), desc(sql`rowid`)];

/** Kratos's SQLite database: sessions and their message logs (D36). Synchronous, like SQLite. */
export class SessionStore {
  private constructor(
    private readonly sqlite: Database.Database,
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  /** Open (creating folder and file if needed) and bring the schema up to date. */
  static open(path: string): SessionStore {
    mkdirSync(dirname(path), { recursive: true });
    const sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL"); // crash-safe, readers don't block the writer
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: MIGRATIONS });
    return new SessionStore(sqlite, db);
  }

  /** Start a new session for a project. Its id doubles as the agent's conversation id. */
  create(projectDir: string, agent: string): StoredSession {
    const now = new Date();
    return this.db.insert(sessions).values({ id: randomUUID(), projectDir, agent, createdAt: now, updatedAt: now }).returning().get();
  }

  /** The project's most recently active session, or a new one if it has none. */
  latestOrCreate(projectDir: string, agent: string): StoredSession {
    const latest = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.projectDir, projectDir))
      .orderBy(...NEWEST_FIRST)
      .limit(1)
      .get();
    return latest ?? this.create(projectDir, agent);
  }

  get(sessionId: string): StoredSession | undefined {
    return this.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  }

  /** A project's sessions, most recently active first. */
  list(projectDir: string): StoredSession[] {
    return this.db.select().from(sessions).where(eq(sessions.projectDir, projectDir)).orderBy(...NEWEST_FIRST).all();
  }

  /** Remember the model a session runs with (D43); null = the agent's default. */
  setModel(sessionId: string, model: string | null): void {
    this.db.update(sessions).set({ model }).where(eq(sessions.id, sessionId)).run();
  }

  /** Remember the effort level chosen for a session (D51). */
  setEffort(sessionId: string, effort: string): void {
    this.db.update(sessions).set({ effort }).where(eq(sessions.id, sessionId)).run();
  }

  /** Remember the permission mode a session runs in (D53). */
  setPermissionMode(sessionId: string, permissionMode: string): void {
    this.db.update(sessions).set({ permissionMode }).where(eq(sessions.id, sessionId)).run();
  }

  /** Mark a session done, or reopen it (3d2). Housekeeping: it doesn't change its place in Recent. */
  setDone(sessionId: string, done: boolean): void {
    this.db
      .update(sessions)
      .set({ doneAt: done ? new Date() : null })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  /** Put a session in a feature, or back to a one-off with null (D73). A session joining moves
   * the feature up in its list; the session's own place doesn't change. */
  setSessionFeature(sessionId: string, featureId: string | null): void {
    this.db.transaction((tx) => {
      tx.update(sessions).set({ featureId }).where(eq(sessions.id, sessionId)).run();
      if (featureId) tx.update(features).set({ updatedAt: new Date() }).where(eq(features.id, featureId)).run();
    });
  }

  /** Start a feature in a project (D73). */
  createFeature(projectDir: string, title: string): StoredFeature {
    const now = new Date();
    return this.db.insert(features).values({ id: randomUUID(), projectDir, title, createdAt: now, updatedAt: now }).returning().get();
  }

  getFeature(featureId: string): StoredFeature | undefined {
    return this.db.select().from(features).where(eq(features.id, featureId)).get();
  }

  /** A project's features, most recently changed first (a tie: the later-created). */
  listFeatures(projectDir: string): StoredFeature[] {
    return this.db
      .select()
      .from(features)
      .where(eq(features.projectDir, projectDir))
      .orderBy(desc(features.updatedAt), desc(sql`rowid`))
      .all();
  }

  /** Rename a feature. Not work on it: its place in the list stays (`updatedAt` untouched). */
  renameFeature(featureId: string, title: string): void {
    this.db.update(features).set({ title }).where(eq(features.id, featureId)).run();
  }

  /** A feature's sessions, most recently active first. */
  sessionsOfFeature(featureId: string): StoredSession[] {
    return this.db.select().from(sessions).where(eq(sessions.featureId, featureId)).orderBy(...NEWEST_FIRST).all();
  }

  /** Mark a feature done — and its sessions with it, the whole folder is finished (owner) — or
   * reopen it (its sessions stay done). Unlike a session's, this moves it: Done is newest first. */
  setFeatureDone(featureId: string, done: boolean): void {
    const now = new Date();
    this.db.transaction((tx) => {
      tx.update(features)
        .set({ doneAt: done ? now : null, updatedAt: now })
        .where(eq(features.id, featureId))
        .run();
      if (done) tx.update(sessions).set({ doneAt: now }).where(and(eq(sessions.featureId, featureId), isNull(sessions.doneAt))).run();
    });
  }

  /** Give a session its title (its first prompt). Only the first call has an effect. */
  setTitle(sessionId: string, title: string): void {
    this.db
      .update(sessions)
      .set({ title })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.title)))
      .run();
  }

  /** Give a session another title (3z4: the agent's, or the owner's). Not activity: it keeps its
   * place in the list. */
  renameSession(sessionId: string, title: string): void {
    this.db.update(sessions).set({ title }).where(eq(sessions.id, sessionId)).run();
  }

  /** A session's log, in the order it was published. */
  load(sessionId: string): ServerMessage[] {
    return this.db
      .select({ message: messages.message })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.seq))
      .all()
      .map((row) => row.message);
  }

  /** Append one message to a session's log and mark the session as just active. */
  append(sessionId: string, message: ServerMessage, options: { activity?: boolean } = {}): void {
    const now = new Date();
    this.db.transaction((tx) => {
      const next = tx
        .select({ seq: sql<number>`coalesce(max(${messages.seq}) + 1, 0)` })
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .get()!.seq;
      tx.insert(messages).values({ sessionId, seq: next, message, createdAt: now }).run();
      // Kratos's own housekeeping (activity: false) mustn't reorder the Recent list.
      if (options.activity !== false) tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, sessionId)).run();
    });
  }

  /** Record a file sent with a prompt (D55); its bytes are stored separately. */
  addAttachment(attachment: Omit<StoredAttachment, "createdAt">): StoredAttachment {
    return this.db.insert(attachments).values({ ...attachment, createdAt: new Date() }).returning().get();
  }

  getAttachment(id: string): StoredAttachment | undefined {
    return this.db.select().from(attachments).where(eq(attachments.id, id)).get();
  }

  /** Record a snapshot taken at a turn boundary (3v1, D65). */
  addSnapshot(sessionId: string, kind: StoredSnapshot["kind"], tree: string, logSeq: number): void {
    this.db.insert(snapshots).values({ sessionId, kind, tree, logSeq, createdAt: new Date() }).run();
  }

  /** All the session's snapshots, oldest first: its turns' boundaries; the first is what its
   * changes are measured from. */
  snapshotsOf(sessionId: string): StoredSnapshot[] {
    return this.db.select().from(snapshots).where(eq(snapshots.sessionId, sessionId)).orderBy(asc(snapshots.id)).all();
  }

  /** Did a turn of this session end at or after `since` (and before `until`), by log position?
   * Then a turn there has no end snapshot of its own (it failed): its edits are in that span (D67).
   * Snapshots from before `logSeq` existed can't tell: false. */
  turnEndedBetween(sessionId: string, since: StoredSnapshot, until?: StoredSnapshot): boolean {
    if (since.logSeq === null) return false;
    const row = this.db
      .select({ seq: messages.seq })
      .from(messages)
      .where(
        and(
          eq(messages.sessionId, sessionId),
          gte(messages.seq, since.logSeq),
          until?.logSeq != null ? lt(messages.seq, until.logSeq) : undefined,
          sql`json_extract(${messages.message}, '$.event.kind') = 'turn_end'`,
        ),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }

  /** Mark a file viewed at this version, or not viewed (3v3). */
  setViewed(sessionId: string, path: string, version: string, viewed: boolean): void {
    const row = and(eq(viewedFiles.sessionId, sessionId), eq(viewedFiles.path, path));
    if (!viewed) {
      this.db.delete(viewedFiles).where(row).run();
      return;
    }
    this.db
      .insert(viewedFiles)
      .values({ sessionId, path, version, viewedAt: new Date() })
      .onConflictDoUpdate({ target: [viewedFiles.sessionId, viewedFiles.path], set: { version, viewedAt: new Date() } })
      .run();
  }

  /** A session's viewed files: path → the version viewed. */
  viewed(sessionId: string): Record<string, string> {
    const rows = this.db.select().from(viewedFiles).where(eq(viewedFiles.sessionId, sessionId)).all();
    return Object.fromEntries(rows.map((r) => [r.path, r.version]));
  }

  /** Did a turn of this session end before this snapshot was taken (ever, without one)? Then
   * its changes predate the snapshot (3v1): the start snapshot failed, or the session is older
   * than snapshots. By log position, so a turn ending in the same millisecond is never confused
   * with one before; snapshots from before `logSeq` existed fall back to their time. */
  turnEndedBefore(sessionId: string, snapshot?: StoredSnapshot): boolean {
    const before = !snapshot
      ? undefined
      : snapshot.logSeq !== null
        ? lt(messages.seq, snapshot.logSeq)
        : lt(messages.createdAt, snapshot.createdAt);
    const row = this.db
      .select({ seq: messages.seq })
      .from(messages)
      .where(
        and(
          eq(messages.sessionId, sessionId),
          before,
          sql`json_extract(${messages.message}, '$.event.kind') = 'turn_end'`,
        ),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }

  /** Record the agent's first start for this session (later starts must resume). Idempotent. */
  markAgentStarted(sessionId: string): void {
    this.db
      .update(sessions)
      .set({ agentStartedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.agentStartedAt)))
      .run();
  }

  close(): void {
    this.sqlite.close();
  }
}
