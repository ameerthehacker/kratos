import { useState } from "react";
import prettyBytes from "pretty-bytes";
import { ExternalLink, FileCode, FileImage, FileText, Plus, X, type LucideIcon } from "lucide-react";
import type { AttachmentKind, AttachmentPolicy, AttachmentRef } from "@kratos/core";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DraftFile } from "@/lib/attachments";
import { cn } from "@/lib/utils";

const ICON: Record<AttachmentKind, LucideIcon> = { image: FileImage, pdf: FileText, text: FileCode };

/** A stored attachment's address on the server (D55). */
export const attachmentUrl = (id: string) => `/attachments/${id}`;

/** The composer's "+" (3s2, design option 1): opens the system file picker. */
export function AttachButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Attach files"
      title="Attach files — or drop them here, or paste"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
    >
      <Plus className="size-4.5" />
    </button>
  );
}

/** Over the prompt card while files are dragged onto it (the design). */
export function DropOverlay({ policy }: { policy: AttachmentPolicy }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-primary/10 text-sm text-foreground ring-2 ring-primary">
      Drop to attach · Images, PDFs and text files · up to {policy.maxCount}
    </div>
  );
}

/** Under the prompt card: why a file can't go (red, until it's removed), or which files weren't
 * added (amber, fades). */
export function FileNotes({ error, note }: { error?: string; note: string | null }) {
  if (error) return <p className="px-4.5 text-xs text-destructive">{error}. Remove it to send.</p>;
  if (note) return <p className="px-4.5 text-xs text-wait">{note}</p>;
  return null;
}

/**
 * Files in the composer before sending (3s2, design option B): images as 56px thumbnails from a
 * local preview, everything else as chips; × removes. A file that can't go stays, outlined in red,
 * until you remove it (the reason shows under the card).
 */
export function DraftList({ drafts, onRemove }: { drafts: DraftFile[]; onRemove: (key: string) => void }) {
  if (drafts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {drafts.map((draft) =>
        draft.previewUrl ? (
          <div key={draft.key} className="group relative size-14 overflow-hidden rounded-xl ring-1 ring-border" title={`${draft.name} · ${prettyBytes(draft.size)}`}>
            <img src={draft.previewUrl} alt={draft.name} className="size-full object-cover" />
            <RemoveButton name={draft.name} onClick={() => onRemove(draft.key)} className="absolute top-1 right-1 bg-background/80 opacity-0 group-hover:opacity-100" />
          </div>
        ) : (
          <FileChip
            key={draft.key}
            name={draft.name}
            kind={draft.kind}
            detail={draft.error ? "Can't attach" : prettyBytes(draft.size)}
            failed={Boolean(draft.error)}
            remove={() => onRemove(draft.key)}
          />
        ),
      )}
    </div>
  );
}

/**
 * A sent prompt's files, above its bubble (3s2): images as thumbnails that open a lightbox, other
 * files as chips that open the original in a new tab — never rendered in the page. A file that's
 * gone from disk shows "Not available".
 */
export function SentFiles({ files }: { files: AttachmentRef[] }) {
  const [open, setOpen] = useState<AttachmentRef | null>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {files.map((file) =>
        file.kind === "image" && !missing.has(file.id) ? (
          <ImageThumb key={file.id} image={file} label={file.name} onOpen={setOpen} onMissing={() => setMissing((m) => new Set(m).add(file.id))} className="h-20 w-30" />
        ) : missing.has(file.id) ? (
          <FileChip key={file.id} name={file.name} kind={file.kind} detail="Not available" />
        ) : (
          <FileChip key={file.id} name={file.name} kind={file.kind} detail={prettyBytes(file.size)} href={attachmentUrl(file.id)} />
        ),
      )}
      <ImageLightbox image={open} title={open?.name} onClose={() => setOpen(null)} />
    </div>
  );
}

/**
 * Images a tool returned (3z), under its step: a screenshot the agent read, as it saw it. Small
 * thumbnails that open the same lightbox as sent files, titled with what the step did ("Read
 * shot.png"); one gone from disk shows "Not available".
 */
export function ToolImages({ images, label }: { images: AttachmentRef[]; label: string }) {
  const [open, setOpen] = useState<AttachmentRef | null>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((image) =>
        missing.has(image.id) ? (
          <FileChip key={image.id} name={label} kind="image" detail="Not available" />
        ) : (
          <ImageThumb key={image.id} image={image} label={label} onOpen={setOpen} onMissing={() => setMissing((m) => new Set(m).add(image.id))} className="h-16 w-24" />
        ),
      )}
      <ImageLightbox image={open} title={label} onClose={() => setOpen(null)} />
    </div>
  );
}

/** A stored image as a thumbnail button (sized by `className`) that opens it. */
function ImageThumb(props: { image: AttachmentRef; label: string; onOpen: (image: AttachmentRef) => void; onMissing: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.image)}
      aria-label={`View ${props.label}`}
      className={cn("overflow-hidden rounded-xl ring-1 ring-border hover:ring-ring focus-visible:outline-2 focus-visible:outline-ring", props.className)}
    >
      <img src={attachmentUrl(props.image.id)} alt={props.label} onError={props.onMissing} className="size-full object-cover" />
    </button>
  );
}

/** A stored image, large (shadcn Dialog): its size and a link to the original. */
function ImageLightbox({ image, title, onClose }: { image: AttachmentRef | null; title?: string; onClose: () => void }) {
  return (
    <Dialog open={image !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{title}</DialogTitle>
          <DialogDescription className="flex items-center gap-3">
            {image && prettyBytes(image.size)}
            {image && (
              <a href={attachmentUrl(image.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                Open original <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            )}
          </DialogDescription>
        </DialogHeader>
        {image && <img src={attachmentUrl(image.id)} alt={title} className="max-h-150 w-full rounded-xl object-contain" />}
      </DialogContent>
    </Dialog>
  );
}

/** One file as a chip: kind icon, name (full name on hover), a detail; removable, or a link. */
function FileChip(props: { name: string; kind?: AttachmentKind; detail: string; failed?: boolean; remove?: () => void; href?: string }) {
  const Icon = props.kind ? ICON[props.kind] : FileText;
  const body = (
    <>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="max-w-60 truncate">{props.name}</span>
      <span className={props.failed ? "" : "text-muted-foreground"}>{props.detail}</span>
      {props.href && <ExternalLink className="size-3 shrink-0 opacity-0 group-hover:opacity-100" aria-hidden="true" />}
    </>
  );
  const look = cn(
    "group inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs",
    props.failed ? "bg-destructive/10 text-destructive ring-1 ring-destructive/60" : "bg-secondary text-secondary-foreground",
  );
  if (props.href) {
    return (
      <a href={props.href} target="_blank" rel="noopener noreferrer" title={`Open ${props.name}`} className={cn(look, "hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring")}>
        {body}
      </a>
    );
  }
  return (
    <span className={look} title={props.name}>
      {body}
      {props.remove && <RemoveButton name={props.name} onClick={props.remove} className="-mr-1" />}
    </span>
  );
}

function RemoveButton({ name, onClick, className }: { name: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Remove ${name}`}
      className={cn("flex size-5 items-center justify-center rounded-full hover:bg-accent focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring", className)}
    >
      <X className="size-3" />
    </button>
  );
}
