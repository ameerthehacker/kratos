import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where attachment bytes live (D55), by attachment id. The id is Kratos's own random UUID —
 * never a name or path from a browser — and is checked again before it touches the disk. */
export interface AttachmentFiles {
  write(id: string, data: Uint8Array): void;
  read(id: string): Uint8Array | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function checkedId(id: string): string {
  if (!UUID.test(id)) throw new Error(`Not an attachment id: ${id}`);
  return id;
}

/** Files in a folder (next to the database: `.kratos/attachments/`), made when first needed. */
export function diskFiles(dir: string): AttachmentFiles {
  return {
    write(id, data) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, checkedId(id)), data);
    },
    read(id) {
      if (!UUID.test(id)) return undefined;
      try {
        return readFileSync(join(dir, id));
      } catch {
        return undefined; // gone from disk: treat as not found
      }
    },
  };
}

/** In memory, for tests and an in-memory database. */
export function memoryFiles(): AttachmentFiles {
  const files = new Map<string, Uint8Array>();
  return {
    write: (id, data) => void files.set(checkedId(id), data),
    read: (id) => files.get(id),
  };
}
