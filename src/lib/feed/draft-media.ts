/**
 * The composer's ordered draft-media model, as pure rules.
 *
 * The composer used to hold exactly two pieces of media state — `imageUrl` and
 * `pendingFile` — which is why it could only ever describe one image, in one
 * state, with no ordering and no per-item error. A carousel needs all four, so
 * the draft is an ORDERED LIST of items each carrying its own lifecycle.
 *
 * Every rule that decides what the user is allowed to do (how many more images
 * fit, whether Post may be pressed, what moving a slide does to the viewport)
 * lives here rather than in the component, so it can be tested without a DOM
 * and cannot drift between the preview and the submit path.
 *
 * Deliberately NOT here: object URLs. Previews are derived from an item's blob
 * by the component that renders it, inside an effect whose cleanup revokes the
 * same URL it created — the only shape that survives React Strict Mode's
 * setup → cleanup → setup. See `useObjectUrl`.
 */

import {
  MAX_POST_MEDIA,
  type MediaAspect,
  type PostMediaInput,
} from "@/lib/feed/media";

export type DraftMediaStatus =
  /** Cropped and held in memory; nothing has been uploaded yet. */
  | "ready"
  /** Bytes are on the wire. */
  | "uploading"
  /** Stored; `url` is set and the item may be published. */
  | "uploaded"
  /** The upload failed; the blob is still here so it can be retried. */
  | "error";

export type DraftMediaItem = {
  /** Stable across reorders, re-crops and re-renders — the React key. */
  id: string;
  /** The user's original file. Never uploaded; kept only so a re-crop can
   *  reopen the full-resolution source without touching the network. */
  file: File;
  /** The cropped export. Cleared once uploaded, so a 5-image draft does not
   *  pin ~10MB of blobs for the rest of the session. */
  blob: Blob | null;
  /** What `renderCrop` emitted for this crop — kept so a failed upload can be
   *  retried from the blob without re-deriving the encoding. */
  extension: string;
  mimeType: string;
  aspect: MediaAspect;
  width: number;
  height: number;
  status: DraftMediaStatus;
  /** 0–100 for this item's own upload. */
  progress: number;
  /** The stored object URL, once uploaded. */
  url: string | null;
  error: string | null;
};

/** How many more images this draft can still take. */
export function remainingCapacity(count: number): number {
  return Math.max(0, MAX_POST_MEDIA - count);
}

/**
 * Take as many newly-picked files as still fit, and say so when some were
 * dropped.
 *
 * A picker cannot be told "you may select 3 more", so the truncation has to
 * happen here — silently discarding the overflow would look like the app lost
 * the user's photos. Generic over the file type so the rule is testable without
 * a `File` implementation.
 */
export function acceptFiles<T>(
  existingCount: number,
  picked: readonly T[]
): { accepted: T[]; rejected: number; message: string | null } {
  const room = remainingCapacity(existingCount);
  const accepted = picked.slice(0, room);
  const rejected = picked.length - accepted.length;
  return {
    accepted,
    rejected,
    message: rejected > 0 ? overLimitMessage() : null,
  };
}

/** The one wording for "that's more than a post can hold". */
export function overLimitMessage(): string {
  return `A post can have up to ${MAX_POST_MEDIA} photos, so we kept the first ${MAX_POST_MEDIA}.`;
}

/** Move a slide, keeping every other slide's relative order. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...items];
  if (from < 0 || from >= items.length) return [...items];
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function removeAt<T>(items: readonly T[], index: number): T[] {
  if (index < 0 || index >= items.length) return [...items];
  return items.filter((_, i) => i !== index);
}

export function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  if (index < 0 || index >= items.length) return [...items];
  return items.map((existing, i) => (i === index ? item : existing));
}

/** Every item is stored and has a URL — the only state media may be posted in. */
export function allUploaded(items: readonly DraftMediaItem[]): boolean {
  return items.every((m) => m.status === "uploaded" && !!m.url);
}

/** Aggregate upload progress across the whole draft, 0–100. */
export function aggregateProgress(items: readonly DraftMediaItem[]): number {
  if (items.length === 0) return 0;
  const total = items.reduce(
    (sum, m) => sum + (m.status === "uploaded" ? 100 : m.progress),
    0
  );
  return Math.round(total / items.length);
}

/**
 * Whether the composer may publish.
 *
 * A poll needs a question and two filled options. Otherwise a post needs text
 * or at least one image — and if it has images, every one of them must be
 * uploaded. A half-uploaded carousel must never be publishable: the post would
 * be created without the slides the user is looking at.
 */
export function canPublish(input: {
  body: string;
  media: readonly DraftMediaItem[];
  pollOptions: readonly string[] | null;
  busy: boolean;
}): boolean {
  const { body, media, pollOptions, busy } = input;
  if (busy) return false;
  if (pollOptions) {
    if (media.length > 0) return false; // polls and media are exclusive
    const filled = pollOptions.map((o) => o.trim()).filter(Boolean).length;
    return body.trim().length > 0 && filled >= 2;
  }
  if (media.length > MAX_POST_MEDIA) return false;
  if (media.length > 0) return allUploaded(media);
  return body.trim().length > 0;
}

/** The ordered payload for `createPost`. Order IS position. */
export function toMediaInput(items: readonly DraftMediaItem[]): PostMediaInput[] {
  return items.flatMap((m) =>
    m.url
      ? [{ url: m.url, aspect: m.aspect, width: m.width, height: m.height }]
      : []
  );
}

/**
 * Object URLs of items that were uploaded during a submit which then failed.
 *
 * Used for best-effort cleanup: a post that never got created leaves its
 * uploaded objects orphaned in storage, and they are only discoverable from the
 * draft that is still on screen.
 */
export function uploadedUrls(items: readonly DraftMediaItem[]): string[] {
  return items.flatMap((m) => (m.status === "uploaded" && m.url ? [m.url] : []));
}
