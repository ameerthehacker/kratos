import { z } from "zod";

/**
 * The generic seam between Kratos and any coding agent (Claude Code, Codex CLI, …).
 * Kratos only ever talks to agents through these types, so the UI, plan, and gates never
 * depend on one vendor's output format. Decisions: DECISIONS.md D14–D19.
 */

// ── Events: what the agent did ──────────────────────────────────────────────────────────
// Data that crosses to the UI, so it's a zod schema (validated) with an inferred TS type.

/**
 * What a tool call does, in agent-neutral terms (D45): the adapter knows its agent's tools, the
 * UI only knows these. Lets the UI say "Read store.ts" or "Ran the tests" without knowing that
 * Claude calls them `Read` and `Bash`.
 */
export const ToolAction = z.object({
  type: z.enum(["read", "edit", "run", "search", "web", "task", "other"]),
  /** What it acts on: a file path, search pattern, URL or query. */
  target: z.string().optional(),
  /** For `run`: the shell command. */
  command: z.string().optional(),
  /** The agent's own one-line summary of the call, if it gave one. */
  description: z.string().optional(),
  /** For `edit`: lines written and replaced, when known. */
  added: z.number().optional(),
  removed: z.number().optional(),
  /**
   * For `edit`: the text replaced and written, for a readable preview (`before` is "" for a new
   * file). Each side is capped; `truncated` says the preview is partial (the call itself isn't).
   */
  edits: z.array(z.object({ before: z.string(), after: z.string(), truncated: z.boolean().optional() })).optional(),
});
export type ToolAction = z.infer<typeof ToolAction>;

export const AttachmentKind = z.enum(["image", "pdf", "text"]);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

/** A stored attachment, as the session log and the UI know it (D55): fetch it from
 * `/attachments/<id>`. A prompt's files, or an image a tool returned (3z). */
export const AttachmentRef = z.object({ id: z.string(), name: z.string(), kind: AttachmentKind, mediaType: z.string(), size: z.number() });
export type AttachmentRef = z.infer<typeof AttachmentRef>;

export const AgentEvent = z.discriminatedUnion("kind", [
  /** A complete block of the agent's reply (not token-by-token). */
  z.object({ kind: z.literal("text"), text: z.string() }),
  /** The agent's visible reasoning, when the agent exposes it. */
  z.object({ kind: z.literal("thinking"), text: z.string() }),
  /** The agent is calling a tool. `id` links it to its tool_result. */
  z.object({
    kind: z.literal("tool_call"),
    id: z.string(),
    /** The agent's own tool name and input, as-is (shown raw on request). */
    tool: z.string(),
    input: z.unknown(),
    /** Agent-neutral meaning of the call (D45); absent in logs from before it existed. */
    action: ToolAction.optional(),
  }),
  z.object({
    kind: z.literal("tool_result"),
    id: z.string(),
    output: z.string(),
    isError: z.boolean(),
    /** Images the tool returned, as the agent saw them (3z): a screenshot it read. Adapter → runtime
     * only: the runtime stores the bytes and logs `attachments` instead. */
    images: z.array(z.object({ mediaType: z.string(), base64: z.string() })).optional(),
    /** Those images, stored: what the log and the tabs get. */
    attachments: z.array(AttachmentRef).optional(),
  }),
  /** The agent's permission mode changed — by Kratos, or by the agent itself (e.g. leaving plan
   * mode once its plan is approved). D53. */
  z.object({ kind: z.literal("permission_mode"), mode: z.string() }),
  /** What became of a prompt sent with an id (D56): waiting while the agent works (`queued`),
   * taken (`started` — mid-turn at a step boundary, or as a new turn), done, or withdrawn. */
  z.object({ kind: z.literal("prompt_state"), id: z.string(), state: z.enum(["queued", "started", "completed", "cancelled"]) }),
  /** The agent finished responding to a prompt. The session stays open for the next send(). */
  z.object({
    kind: z.literal("turn_end"),
    reason: z.enum(["completed", "interrupted", "error"]),
    error: z.string().optional(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

// ── Permission gate: Kratos decides before the agent runs a tool ────────────────────────

export const PermissionRequest = z.object({
  tool: z.string(),
  input: z.unknown(),
  /** The `tool_call` event this ask is about, when the agent says (3c4): asks attach by id. */
  toolCallId: z.string().optional(),
  /** Agent-neutral meaning of the call (D45), as on `tool_call`. */
  action: ToolAction.optional(),
  /** Why the agent's own rules wanted a check, if it says. */
  reason: z.string().optional(),
});
export type PermissionRequest = z.infer<typeof PermissionRequest>;

export const PermissionDecision = z.discriminatedUnion("decision", [
  /** Run it. `updatedInput` lets the owner edit e.g. a command before it runs. */
  z.object({ decision: z.literal("allow"), updatedInput: z.unknown().optional() }),
  /** Don't run it. `message` is shown to the agent so it can change course. */
  z.object({ decision: z.literal("deny"), message: z.string() }),
]);
export type PermissionDecision = z.infer<typeof PermissionDecision>;

/**
 * Called by the adapter before every tool use the agent asks permission for, and awaited.
 * `signal` aborts if the turn is interrupted while waiting (e.g. close the approval prompt).
 */
export type RequestPermission = (
  request: PermissionRequest,
  options: { signal: AbortSignal },
) => Promise<PermissionDecision>;

// ── Questions: the agent asks the owner to choose (D54) ─────────────────────────────────

/** One multiple-choice question from the agent, in agent-neutral terms (e.g. Claude's
 * AskUserQuestion). The owner may always type their own answer instead ("Other"). */
export const AgentQuestion = z.object({
  /** A short tab label ("Placement"). */
  header: z.string(),
  question: z.string(),
  multiSelect: z.boolean(),
  options: z.array(
    z.object({
      label: z.string(),
      description: z.string().optional(),
      /** The option the agent recommends (shown, never pre-picked). */
      recommended: z.boolean().optional(),
    }),
  ),
});
export type AgentQuestion = z.infer<typeof AgentQuestion>;

export const QuestionRequest = z.object({
  questions: z.array(AgentQuestion).min(1),
  /** The `tool_call` event that carries the questions, when the agent says. */
  toolCallId: z.string().optional(),
});
export type QuestionRequest = z.infer<typeof QuestionRequest>;

/** The owner's answer to one question: picked option labels and/or their own text. */
export const QuestionAnswer = z.object({ selected: z.array(z.string()), other: z.string().optional() });
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

export const QuestionReply = z.discriminatedUnion("outcome", [
  /** One answer per question, in the same order. */
  z.object({ outcome: z.literal("answered"), answers: z.array(QuestionAnswer) }),
  /** The owner skipped: the agent decides for itself. */
  z.object({ outcome: z.literal("skipped") }),
]);
export type QuestionReply = z.infer<typeof QuestionReply>;

/**
 * Called by the adapter when the agent asks the owner questions, and awaited. `signal` aborts
 * if the agent withdraws them (e.g. the turn is interrupted). Like RequestPermission.
 */
export type AskQuestions = (request: QuestionRequest, options: { signal: AbortSignal }) => Promise<QuestionReply>;

/**
 * Why a reply doesn't fit its questions, or null if it does: one answer per question, only the
 * question's own option labels, at most one choice for a single-choice question, and every
 * question answered (an option or non-empty own text). Skipping always fits.
 */
export function checkQuestionReply(request: QuestionRequest, reply: QuestionReply): string | null {
  if (reply.outcome === "skipped") return null;
  if (reply.answers.length !== request.questions.length) {
    return `Expected ${request.questions.length} answers, got ${reply.answers.length}`;
  }
  for (const [i, question] of request.questions.entries()) {
    const answer = reply.answers[i]!;
    const labels = new Set(question.options.map((o) => o.label));
    const unknown = answer.selected.find((label) => !labels.has(label));
    if (unknown !== undefined) return `"${unknown}" is not an option of "${question.header}"`;
    if (new Set(answer.selected).size !== answer.selected.length) return `"${question.header}" lists an option twice`;
    const choices = answer.selected.length + (answer.other?.trim() ? 1 : 0);
    if (choices === 0) return `"${question.header}" has no answer`;
    if (!question.multiSelect && choices > 1) return `"${question.header}" takes one answer`;
  }
  return null;
}

// ── Attachments: files sent with a prompt (D55) ─────────────────────────────────────────

/** What a harness accepts with a prompt (D55): per kind, its media types (none listed = any type,
 * for text: judged by content) and size; and how many files / bytes in all. No kinds = none. */
export const AttachmentPolicy = z.object({
  kinds: z.array(z.object({ kind: AttachmentKind, mediaTypes: z.array(z.string()), maxBytes: z.number() })),
  maxCount: z.number(),
  maxTotalBytes: z.number(),
});
export type AttachmentPolicy = z.infer<typeof AttachmentPolicy>;

/** A file going to the agent with a prompt, in agent-neutral terms (the adapter maps it). */
export type AgentAttachment = { name: string; kind: AttachmentKind; mediaType: string; data: Uint8Array };

/**
 * Which kind a file is under a policy, or why it can't be attached. Images and PDFs by media
 * type; anything else counts as text if its bytes are UTF-8 without NUL (browsers often don't know
 * a `.ts` file's type, so the content decides). Pure: the server checks with it, the UI can too.
 */
export function classifyAttachment(
  policy: AttachmentPolicy,
  file: { name: string; mediaType: string; data: Uint8Array },
): { kind: AttachmentKind; mediaType: string } | { error: string } {
  const typed = policy.kinds.find((k) => k.mediaTypes.includes(file.mediaType));
  const text = policy.kinds.find((k) => k.kind === "text");
  const rule = typed ?? (text && isUtf8Text(file.data) ? text : undefined);
  if (!rule) return { error: `${file.name}: ${file.mediaType || "this kind of"} file can't be attached` };
  if (file.data.byteLength > rule.maxBytes) {
    return { error: `${file.name} is too big (${megabytes(file.data.byteLength)}; ${rule.kind} files up to ${megabytes(rule.maxBytes)})` };
  }
  return { kind: rule.kind, mediaType: rule.kind === "text" ? "text/plain" : file.mediaType };
}

/** Why a set of files can't go together under a policy (count, total size), or null. */
export function checkAttachmentSet(policy: AttachmentPolicy, sizes: readonly number[]): string | null {
  if (sizes.length > policy.maxCount) return `Up to ${policy.maxCount} files per prompt (got ${sizes.length})`;
  const total = sizes.reduce((sum, n) => sum + n, 0);
  if (total > policy.maxTotalBytes) return `Up to ${megabytes(policy.maxTotalBytes)} per prompt (got ${megabytes(total)})`;
  return null;
}

function isUtf8Text(data: Uint8Array): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;

// ── Adapter + session: behaviour, so plain TS interfaces ────────────────────────────────

/**
 * Which conversation a session belongs to (D36). `id` is chosen by Kratos and handed to the
 * agent; `resume: false` starts the conversation under that id, `resume: true` continues it.
 * Agents that can't name or resume conversations may ignore this.
 */
export type Conversation = { id: string; resume: boolean };

/** A model an agent offers (D43). `group`: "latest" = always-newest aliases, "other" = pinned. */
export const AgentModel = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  group: z.enum(["latest", "other"]),
  /** This entry is the agent's own default: choosing it means "no model chosen" (null, 3c4). */
  isDefault: z.boolean().optional(),
  /** How hard it can think, lowest first, in the agent's own words (e.g. "low" … "max"; D51).
   * Absent = this model has no effort control. */
  efforts: z.array(z.string()).optional(),
});
export type AgentModel = z.infer<typeof AgentModel>;

/**
 * How much the agent may do without asking (D53), as the agent defines it: e.g. ask first, accept
 * edits, plan only. `dangerous` = it turns the checks off; Kratos only switches to it with the
 * owner's explicit consent.
 */
export const AgentPermissionMode = z.object({
  id: z.string(),
  label: z.string(),
  /** For the chip ("Ask", "Accept edits"); the menu shows `label`. */
  shortLabel: z.string(),
  /** Agent-neutral meaning, so the UI can pick an icon without knowing agent ids (like ToolAction):
   * ask first, accept edits, plan only, the agent's own checker, never ask (refuse), no checks. */
  kind: z.enum(["ask", "edits", "plan", "auto", "never_ask", "bypass", "other"]),
  description: z.string(),
  /** The agent's own default: choosing it means "no mode chosen" (null). */
  isDefault: z.boolean().optional(),
  dangerous: z.boolean().optional(),
});
export type AgentPermissionMode = z.infer<typeof AgentPermissionMode>;

/** A coding agent Kratos knows how to drive (a "harness"). One adapter per agent (e.g. "claude-code"). */
export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  /** The models this agent offers, as the agent itself reports them (never hardcoded). */
  listModels(): Promise<AgentModel[]>;
  /** The permission modes this agent has (D53); empty = it has no modes (always asks Kratos). */
  readonly permissionModes: readonly AgentPermissionMode[];
  /** The files it accepts with a prompt (D55); no kinds = none. */
  readonly attachments: AttachmentPolicy;
  /** Without `conversation`, a fresh, unnamed conversation; without `model` or `effort`, the
   * agent's default. An `effort` the model lacks is the agent's to handle (Claude clamps it; D51). */
  startSession(options: {
    cwd: string;
    requestPermission: RequestPermission;
    conversation?: Conversation;
    model?: string;
    effort?: string;
    /** One of `permissionModes`; without it, the agent's default mode (D53). */
    permissionMode?: string;
    /** Where the agent's questions go (D54); without it, questions are refused. */
    askQuestions?: AskQuestions;
  }): AgentSession;
}

/** One running conversation with an agent. */
export interface AgentSession {
  /** Every event for the whole conversation. Ends when the session stops. Iterate it once. */
  readonly events: AsyncIterable<AgentEvent>;
  /** Send a prompt, with files if any (already checked against the adapter's policy, D55).
   * Events arrive on `events`; the turn ends with a `turn_end` event. Sent while a turn runs, the
   * agent holds it and takes it later (steering, D56); with an `id`, `prompt_state` events say
   * what became of it. */
  send(prompt: string, attachments?: readonly AgentAttachment[], options?: { id?: string }): void;
  /** Withdraw a prompt the agent still holds (D56); false if it was already taken. */
  cancelPrompt(id: string): Promise<boolean>;
  /** Stop the current step and have the agent read a held prompt right away (D56). Claude's
   * send-now delivers *every* held prompt: withdraw the others first to send just one. */
  sendNow(id: string): Promise<void>;
  /** Stop the current turn (emits turn_end "interrupted"); the session stays usable. With
   * `cancelQueued`, prompts it holds are withdrawn too (`prompt_state` cancelled); without, they
   * run right after (D56). */
  interrupt(options?: { cancelQueued?: boolean }): Promise<void>;
  /** Switch the running conversation to another model (from listModels); `null` = back to the
   * agent's default (3c4). Resolves when the agent confirms — which it reports on its output, so
   * `events` must be being consumed (the hub always does). */
  setModel(model: string | null): Promise<void>;
  /** Switch the effort level (one of the current model's `efforts`); rejects a level it doesn't
   * list. Resolves when the agent confirms; like setModel, needs `events` consumed (D51). */
  setEffort(effort: string): Promise<void>;
  /** The effort level the agent is really using now (it may differ from what was asked, e.g.
   * after a model switch); null = none (the model has no effort control, or the agent won't say). */
  effort(): Promise<string | null>;
  /** Switch the permission mode (one of the adapter's `permissionModes`). Resolves with the mode
   * the agent applied once it confirms; like setModel, needs `events` consumed (D53). Changes
   * also arrive as `permission_mode` events — including ones the agent makes itself. */
  setPermissionMode(mode: string): Promise<string>;
  /** A short title for the conversation, from the agent's own fast model (3z4), given what it's
   * about: the first prompt, or the conversation so far. Optional: without it a session keeps
   * its first prompt as its title. Works while a turn runs, without disturbing it. */
  title?(description: string): Promise<string>;
  /** End the conversation and clean up the agent's process; `events` then completes. */
  stop(): Promise<void>;
}
