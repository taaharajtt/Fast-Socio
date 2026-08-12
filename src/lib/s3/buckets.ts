/**
 * Storage prefix rules (Contabo migration, Phase 3).
 *
 * On Supabase these were three separate buckets. On Contabo they are three
 * PREFIXES inside one bucket, because a bucket policy can grant anonymous read
 * per-prefix but bucket ACLs are all-or-nothing — and `chat-media` must stay
 * private while the other two are publicly readable.
 *
 * The size/MIME limits below are NOT decoration. On Supabase they were enforced
 * by the storage service itself (`storage.buckets.file_size_limit` /
 * `allowed_mime_types`, migration 0023). Plain S3 enforces neither, so the
 * presign endpoint is now the ONLY thing standing between a client and an
 * arbitrarily large or arbitrarily typed object. Keep these in sync with 0023.
 */

export const PREFIXES = ["avatars", "post-media", "chat-media"] as const;
export type StoragePrefix = (typeof PREFIXES)[number];

export function isStoragePrefix(value: unknown): value is StoragePrefix {
  return typeof value === "string" && (PREFIXES as readonly string[]).includes(value);
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg"] as const;

export const PREFIX_LIMITS: Record<
  StoragePrefix,
  { maxBytes: number; mimeTypes: readonly string[]; publicRead: boolean }
> = {
  // Mirrors supabase/migrations/0023_storage_bucket_limits.sql.
  avatars: { maxBytes: 5 * 1024 * 1024, mimeTypes: IMAGE_TYPES, publicRead: true },
  "post-media": { maxBytes: 10 * 1024 * 1024, mimeTypes: IMAGE_TYPES, publicRead: true },
  "chat-media": {
    maxBytes: 15 * 1024 * 1024,
    mimeTypes: [...IMAGE_TYPES, ...AUDIO_TYPES],
    publicRead: false,
  },
};

/**
 * Reject anything that isn't a plain `<segment>/<segment>` object path.
 *
 * Path traversal matters more here than it did on Supabase: there, a malformed
 * path still hit RLS on `storage.objects` and was refused. Here the path is
 * interpolated into an S3 key we sign, so a `..` that normalizes upward would
 * be signed as legitimate. This is the last line of defence — call it before
 * any prefix-specific authorization.
 */
export function isWellFormedObjectPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) return false;
  if (path.startsWith("/") || path.includes("..") || path.includes("//")) return false;
  // Control characters, backslashes and whitespace have no business in a key.
  if (/[\x00-\x1f\x7f\\\s]/.test(path)) return false;
  const segments = path.split("/");
  if (segments.length !== 2) return false;
  return segments.every((s) => s.length > 0);
}

/** Validate a declared content type + size against the prefix's limits. */
export function validateUploadShape(
  prefix: StoragePrefix,
  contentType: string,
  sizeBytes: number
): { ok: true } | { ok: false; reason: string } {
  const limits = PREFIX_LIMITS[prefix];
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, reason: "Invalid file size." };
  }
  if (sizeBytes > limits.maxBytes) {
    const mb = Math.round(limits.maxBytes / (1024 * 1024));
    return { ok: false, reason: `File is too large (max ${mb}MB).` };
  }
  if (!limits.mimeTypes.includes(contentType)) {
    return { ok: false, reason: `Unsupported file type (${contentType}).` };
  }
  return { ok: true };
}

/** Public URL for an object under a publicly-readable prefix. */
export function publicObjectUrl(prefix: StoragePrefix, path: string): string {
  const base = process.env.NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL!.replace(/\/$/, "");
  return `${base}/${prefix}/${encodeURI(path)}`;
}
