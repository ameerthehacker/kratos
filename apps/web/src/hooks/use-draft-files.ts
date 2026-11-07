import { useEffect, useRef, useState } from "react";
import { useDropzone, type DropEvent } from "react-dropzone";
import type { AttachmentPolicy, AttachmentUpload } from "@kratos/core";
import { discard, fitting, pastedFile, readDraft, toUploads, type DraftFile } from "@/lib/attachments";

/**
 * The files in a composer before sending (3s2): added from the "+" picker, a drop on the card, or
 * a paste; checked with the harness's policy (core's rules, D55); local previews freed when files
 * leave. Picking, dropping and pasting are react-dropzone's (D55): spread `rootProps` on the card,
 * `inputProps` on a hidden input, and call `openPicker` from "+". Without a policy, it's off.
 */
export function useDraftFiles(policy: AttachmentPolicy | undefined) {
  const [drafts, setDrafts] = useState<DraftFile[]>([]);
  const [note, setNote] = useState<string | null>(null); // files that weren't added; fades

  // The latest list, for async adds and the unmount cleanup.
  const current = useRef(drafts);
  current.current = drafts;
  useEffect(() => () => current.current.forEach(discard), []);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(timer);
  }, [note]);

  const add = async (files: File[]) => {
    if (!policy || files.length === 0) return;
    const read = await Promise.all(files.map((file) => readDraft(file, policy)));
    const { kept, note } = fitting(policy, current.current, read);
    setDrafts((all) => [...all, ...kept]);
    setNote(note ?? null);
  };

  const remove = (key: string) =>
    setDrafts((all) => {
      all.filter((d) => d.key === key).forEach(discard);
      return all.filter((d) => d.key !== key);
    });

  /** What the prompt carries; empties the list. */
  const take = (): AttachmentUpload[] => {
    const uploads = toUploads(current.current);
    current.current.forEach(discard);
    setDrafts([]);
    return uploads;
  };

  // Everything is accepted here: our own check (core's rules) marks what can't go, so a refused
  // file shows in the list with its reason instead of silently vanishing.
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (files, _rejected, event) => void add(isPaste(event) ? files.map(pastedFile) : files),
    disabled: !policy,
    noClick: true, // the "+" opens the picker, not a click anywhere on the card
    noKeyboard: true, // Enter in the text box sends; it mustn't open the picker
    useFsAccessApi: false, // the plain file input: works the same in every browser
  });

  return {
    drafts,
    /** The first file that can't go: it blocks sending until removed. */
    failed: drafts.find((d) => d.error),
    note,
    dragging: isDragActive,
    full: policy !== undefined && drafts.length >= policy.maxCount,
    add,
    remove,
    take,
    rootProps: getRootProps,
    inputProps: getInputProps,
    openPicker: open,
  };
}

const isPaste = (event: DropEvent) => "type" in event && event.type === "paste";
