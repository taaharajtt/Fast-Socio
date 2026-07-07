/**
 * chat-media path helpers (audit fix P5-01).
 *
 * The chat-media bucket is private; messages now store the object PATH
 * (`<conversation_id>/<uuid>.<ext>`) in attachment_url and the app resolves a
 * short-lived signed URL at read time. Legacy rows stored a full public URL, so
 * these helpers normalize either form to a bucket-relative path.
 */

const PUBLIC_MARKER = "/storage/v1/object/public/chat-media/";

/** Normalize a stored attachment value (path OR legacy public URL) to a path. */
export function chatMediaPath(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const idx = stored.indexOf(PUBLIC_MARKER);
  if (idx !== -1) return stored.slice(idx + PUBLIC_MARKER.length);
  // Already a bucket-relative path.
  return stored.replace(/^\/+/, "");
}

/**
 * True if `path` is a well-formed chat-media object path inside `conversationId`
 * — i.e. `<conversationId>/<file>`. Used to validate a client-supplied
 * attachment before it is stored on a message.
 */
export function isChatMediaPathFor(
  path: string | null | undefined,
  conversationId: string
): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("..") || path.startsWith("/")) return false;
  const segs = path.split("/");
  return segs.length === 2 && segs[0] === conversationId && segs[1].length > 0;
}

/** Signed-URL lifetime for DM attachments (P5-01): 1 hour. */
export const CHAT_MEDIA_TTL_SECONDS = 60 * 60;
