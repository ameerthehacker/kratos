import { checkAttachmentSet, classifyAttachment, type AttachmentKind, type AttachmentPolicy, type AttachmentUpload } from "@kratos/core";

/** A file in the composer before sending (3s2): checked with core's rules — the same the server
 * applies (D55) — so a refusal shows before you send. `error` = it can't go; `previewUrl` = a
 * local preview for images. */
export type DraftFile = {
  key: string;
  name: string;
  size: number;
  mediaType: string;
  kind?: AttachmentKind;
  error?: string;
  /** base64, for the prompt message (only for files that can go). */
  data?: string;
  previewUrl?: string;
};

let nextKey = 0;

/** Read and check one file. Images get a local preview URL (revoke it with `discard`). */
export async function readDraft(file: File, policy: AttachmentPolicy): Promise<DraftFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const draft = { key: `file-${nextKey++}`, name: file.name, size: bytes.byteLength, mediaType: file.type };
  const result = classifyAttachment(policy, { name: file.name, mediaType: file.type, data: bytes });
  if ("error" in result) return { ...draft, error: result.error };
  return {
    ...draft,
    kind: result.kind,
    mediaType: result.mediaType,
    data: await base64(file),
    previewUrl: result.kind === "image" ? URL.createObjectURL(file) : undefined,
  };
}

/** Which of `incoming` fit after `current` under the policy's count and total, and a note naming
 * the ones that don't ("Up to 10 files per prompt: 2 weren't added (k.ts, l.ts)"). */
export function fitting(policy: AttachmentPolicy, current: DraftFile[], incoming: DraftFile[]): { kept: DraftFile[]; note?: string } {
  const kept: DraftFile[] = [];
  const left: string[] = [];
  let limit = "";
  for (const draft of incoming) {
    const sizes = [...current, ...kept, draft].filter((d) => !d.error).map((d) => d.size);
    // Over the count, or (for a file that can go) over the total: core says which, e.g. "Up to 30 MB per prompt".
    const problem = current.length + kept.length + 1 > policy.maxCount ? `Up to ${policy.maxCount} files per prompt` : !draft.error && checkAttachmentSet(policy, sizes);
    if (problem) {
      left.push(draft.name);
      limit ||= problem.replace(/ \(got .*\)$/, "");
    } else kept.push(draft);
  }
  for (const draft of incoming) if (!kept.includes(draft)) discard(draft);
  if (left.length === 0) return { kept };
  return { kept, note: `${limit}: ${left.length === 1 ? `${left[0]} wasn't added` : `${left.length} weren't added (${left.join(", ")})`}` };
}

/** What the prompt message carries for the files that can go. */
export const toUploads = (drafts: DraftFile[]): AttachmentUpload[] =>
  drafts.flatMap((d) => (d.data !== undefined ? [{ name: d.name, mediaType: d.mediaType, data: d.data }] : []));

/** Free a draft's local preview. */
export function discard(draft: DraftFile): void {
  if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
}

/** A pasted screenshot arrives as "image.png": give it a clearer name (the design). */
export function pastedFile(file: File): File {
  return file.name === "image.png" ? new File([file], "pasted-image.png", { type: file.type }) : file;
}

/** The file's bytes as base64, via the browser's own FileReader (a data URL, minus its prefix). */
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
