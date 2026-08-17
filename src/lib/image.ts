/**
 * Image rendering helpers.
 *
 * Objects live in Contabo Object Storage, which — unlike Supabase Storage — has
 * no image transformation endpoint. Resizing is done by an imgproxy instance
 * running alongside the app on the VPS, so the browser still downloads a
 * resized/optimized render instead of the full-size original.
 *
 * Supabase render URLs looked like:
 *   {base}/storage/v1/render/image/public/{bucket}/{path}?width=&height=&resize=
 * imgproxy URLs look like:
 *   {imgproxy}/insecure/rs:fit:{w}:{h}:0/q:{quality}/plain/{source-url}
 *
 * `insecure` (unsigned) is safe here only because the imgproxy deployment is
 * locked to our own bucket via IMGPROXY_ALLOWED_SOURCES — without that it would
 * be an open image proxy for the whole internet. Keep those two in step.
 *
 * When IMGPROXY is unset (local dev, or before the VPS side is up) every helper
 * returns the original URL untouched, so images still render — just unresized.
 */

const IMGPROXY = process.env.NEXT_PUBLIC_IMGPROXY_URL?.replace(/\/$/, "") ?? "";
const PUBLIC_BASE = process.env.NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";

/** True if `url` is one of our own storage objects and so safe to send to imgproxy. */
function isOwnStorageUrl(url: string): boolean {
  return Boolean(PUBLIC_BASE) && url.startsWith(`${PUBLIC_BASE}/`);
}

/**
 * Return a transformed URL that renders `url` at most `size`px on its largest
 * edge (default 1080). Non-storage URLs (or non-images) are returned unchanged.
 */
export function optimizedImage(
  url: string | null | undefined,
  size = 1080,
  quality = 75
): string | null {
  if (!url) return null;
  if (!IMGPROXY || !isOwnStorageUrl(url)) return url;
  // rs:fit keeps aspect ratio; the trailing :0 disables enlargement, matching
  // the old resize=contain behaviour of never upscaling past the original.
  return `${IMGPROXY}/insecure/rs:fit:${size}:${size}:0/q:${quality}/plain/${encodeURIComponent(url)}`;
}

/** Avatars are small; 256px is plenty and much lighter than a full upload. */
export function optimizedAvatar(
  url: string | null | undefined,
  size = 256
): string | null {
  return optimizedImage(url, size);
}
