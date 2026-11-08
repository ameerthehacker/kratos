import { z } from "zod";
import { Title, hostTool, type HostTool, type HostToolContext, type PermissionDecision, type PermissionRequest } from "@kratos/core";

/** Where a session can be filed (D73): an existing feature, a new one by name, or none. */
export type Filing = { featureId: string } | { newTitle: string } | { oneOff: true };

/** What the tools may do, all on their own session (4m3). A change that can't happen says why
 * (a string) instead of doing it; the hub tells every tab about the ones that do. */
export interface SessionFeatureOps {
  features(): { features: Array<{ id: string; title: string; done: boolean }>; current: string | null };
  /** Why this filing can't happen (a done or unknown feature), or undefined. */
  cannotFile(filing: Filing): string | undefined;
  file(filing: Filing): string | undefined;
  /** Marks it done once its turn ends (it's in one: the agent is calling the tool). */
  markSessionDone(): void;
  /** Why its feature can't be marked done now (none, already done, another session works). */
  cannotFinishFeature(): string | undefined;
  /** Mark `featureId` (the feature the owner was asked about) done once the turn ends, if the
   * session is still in it then and nothing else in it works. */
  markFeatureDone(featureId: string): string | undefined;
}

type Ask = (request: PermissionRequest, signal: AbortSignal) => Promise<PermissionDecision>;

const FileInput = z.object({
  featureId: z.string().optional().describe("An existing, not-done feature's id from list_features."),
  newFeatureTitle: Title.optional().describe("Create a feature with this name and file the session in it."),
  oneOff: z.boolean().optional().describe("True: take the session out of its feature."),
  reason: z.string().max(300).optional().describe("One short sentence on why, shown to the owner with the request."),
});
/** How many places it was told to file the session in: exactly one is a valid call. */
const targets = (input: z.output<typeof FileInput>) =>
  [input.featureId !== undefined, input.newFeatureTitle !== undefined, input.oneOff === true].filter(Boolean).length;

const Reason = z
  .string()
  .max(300)
  .optional()
  .describe("One short sentence on why, shown to the owner with the request.");

/**
 * Kratos's tools for the agent (D77, 4m3): read the features, and file or finish its own session
 * and feature. Every change waits for the owner's Allow on the session's usual ask, in every
 * permission mode (Bypass too: the agent's own permission check doesn't see these, D77); a Deny
 * reaches the agent as a tool error. Reads never ask.
 */
export function kratosTools(ops: SessionFeatureOps, ask: Ask): HostTool[] {
  const titleOf = (id: unknown, features = ops.features().features) => features.find((f) => f.id === id)?.title;
  const described = (filing: Partial<{ featureId: string; newFeatureTitle: string; oneOff: boolean }>) =>
    filing.newFeatureTitle
      ? `Create the feature “${filing.newFeatureTitle}” and move this session into it`
      : filing.oneOff
        ? "Take this session out of its feature (a one-off)"
        : `Move this session into the feature “${titleOf(filing.featureId) ?? filing.featureId ?? "?"}”`;

  /** Ask the owner; on Allow do it. What the agent hears either way. */
  const askThen = async (
    request: { tool: string; input: unknown; description: string; reason?: string },
    context: HostToolContext,
    act: () => string | undefined,
    done: string,
  ) => {
    const decision = await ask(
      {
        tool: context.toolName ?? request.tool, // as on its step, so the ask finds it by name too
        input: request.input,
        toolCallId: context.toolCallId,
        action: { type: "other", description: request.description },
        ...(request.reason ? { reason: request.reason } : {}),
      },
      context.signal,
    );
    if (decision.decision === "deny") return { text: `The owner said no (${decision.message}). Nothing changed; carry on without it.`, isError: true };
    const problem = act();
    return problem ? { text: problem, isError: true } : { text: done };
  };

  return [
    hostTool({
      name: "list_features",
      description:
        "List this project's features in Kratos (folders that group the sessions working on one piece of work) and say which feature this session is in. Reading only: it never asks the owner.",
      input: z.object({}),
      describe: () => "List the features",
      async call() {
        const { features, current } = ops.features();
        return { text: JSON.stringify({ thisSession: { featureId: current, feature: titleOf(current, features) ?? null }, features }) };
      },
    }),
    hostTool({
      name: "file_session",
      description:
        "File this session (the one you're running in) in a Kratos feature: an existing one by its id (from list_features), a new one by name, or none (oneOff). Give exactly one. Kratos asks the owner first and waits for their answer; offer this when the work clearly belongs to a feature, don't insist.",
      input: FileInput,
      // On the raw call: a confident label only for input the call will take.
      describe: (raw) => {
        const input = FileInput.safeParse(raw);
        return input.success && targets(input.data) === 1 ? described(input.data) : "File this session in a feature";
      },
      async call(input, context) {
        if (targets(input) !== 1) return { text: "Give exactly one of featureId, newFeatureTitle or oneOff: true.", isError: true };
        const filing: Filing = input.newFeatureTitle ? { newTitle: input.newFeatureTitle } : input.oneOff ? { oneOff: true } : { featureId: input.featureId! };
        const problem = ops.cannotFile(filing);
        if (problem) return { text: problem, isError: true }; // refused before bothering the owner
        return askThen({ tool: "file_session", input, description: described(input), reason: input.reason }, context, () => ops.file(filing), "Done: the session is filed.");
      },
    }),
    hostTool({
      name: "mark_session_done",
      description:
        "Mark this session done in Kratos when its work is finished (it moves to the owner's Done list). Kratos asks the owner first. Your current turn isn't stopped: the session is marked done when it ends, so finish your reply as usual.",
      input: z.object({ reason: Reason }),
      describe: () => "Mark this session done",
      async call(input, context) {
        return askThen(
          { tool: "mark_session_done", input, description: "Mark this session done", reason: input.reason },
          context,
          () => (ops.markSessionDone(), undefined),
          "Allowed: the session is marked done as soon as this turn ends. Finish your reply as usual.",
        );
      },
    }),
    hostTool({
      name: "mark_feature_done",
      description:
        "Mark this session's feature done in Kratos when the whole piece of work is finished; its sessions are marked done with it. Refused while another session in it is still working. Kratos asks the owner first.",
      input: z.object({ reason: Reason }),
      describe: () => {
        const { features, current } = ops.features();
        return `Mark the feature “${titleOf(current, features) ?? "this session's feature"}” done`;
      },
      async call(input, context) {
        const problem = ops.cannotFinishFeature();
        if (problem) return { text: problem, isError: true };
        const { features, current } = ops.features();
        // The owner allows *this* feature: if the session moves meanwhile, the hub refuses.
        const featureId = current!;
        return askThen(
          { tool: "mark_feature_done", input, description: `Mark the feature “${titleOf(featureId, features)}” done`, reason: input.reason },
          context,
          () => ops.markFeatureDone(featureId),
          "Allowed: the feature and its sessions are marked done as soon as this turn ends. Finish your reply as usual.",
        );
      },
    }),
  ];
}
