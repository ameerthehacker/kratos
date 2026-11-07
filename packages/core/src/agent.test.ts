import { describe, expect, it } from "vitest";
import { checkAttachmentSet, classifyAttachment, type AttachmentPolicy } from "./agent.js";

const MB = 1024 * 1024;
const POLICY: AttachmentPolicy = {
  kinds: [
    { kind: "image", mediaTypes: ["image/png"], maxBytes: 5 * MB },
    { kind: "pdf", mediaTypes: ["application/pdf"], maxBytes: 30 * MB },
    { kind: "text", mediaTypes: [], maxBytes: 1 * MB },
  ],
  maxCount: 2,
  maxTotalBytes: 6 * MB,
};
const file = (name: string, mediaType: string, data: Uint8Array) => ({ name, mediaType, data });
const text = (s: string) => new TextEncoder().encode(s);

describe("attachments (D55)", () => {
  it("knows images and PDFs by media type, and text by its content (types browsers miss)", () => {
    expect(classifyAttachment(POLICY, file("a.png", "image/png", new Uint8Array([137, 80])))).toEqual({ kind: "image", mediaType: "image/png" });
    expect(classifyAttachment(POLICY, file("b.pdf", "application/pdf", text("%PDF")))).toEqual({ kind: "pdf", mediaType: "application/pdf" });
    // A .ts file: browsers give it an odd type or none; it's UTF-8, so it's text.
    expect(classifyAttachment(POLICY, file("c.ts", "", text("export const x = 1; // ünïcode")))).toEqual({ kind: "text", mediaType: "text/plain" });
    expect(classifyAttachment(POLICY, file("d.ts", "video/mp2t", text("let y")))).toEqual({ kind: "text", mediaType: "text/plain" });
  });

  it("refuses binary files that aren't an accepted type, and files over their kind's size", () => {
    expect(classifyAttachment(POLICY, file("e.zip", "application/zip", new Uint8Array([80, 75, 0, 4])))).toEqual({
      error: "e.zip: application/zip file can't be attached",
    });
    expect(classifyAttachment(POLICY, file("f.bin", "", new Uint8Array([0xff, 0xfe, 0xfd])))).toHaveProperty("error"); // not UTF-8
    expect(classifyAttachment(POLICY, file("big.txt", "text/plain", new Uint8Array(1 * MB + 1).fill(97)))).toEqual({
      error: "big.txt is too big (1 MB; text files up to 1 MB)",
    });
    expect(classifyAttachment(POLICY, file("pic.svg", "image/svg+xml", text("<svg/>")))).toEqual({ kind: "text", mediaType: "text/plain" }); // never an image
  });

  it("limits how many files and bytes go with one prompt", () => {
    expect(checkAttachmentSet(POLICY, [1, 2])).toBeNull();
    expect(checkAttachmentSet(POLICY, [1, 2, 3])).toBe("Up to 2 files per prompt (got 3)");
    expect(checkAttachmentSet(POLICY, [4 * MB, 3 * MB])).toBe("Up to 6 MB per prompt (got 7 MB)");
  });
});
