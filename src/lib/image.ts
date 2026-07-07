/**
 * Image rendering helpers (audit fix P4-04).
 *
 * Storage objects are served through Supabase's image transformation endpoint
 * so the browser downloads a resized/optimized render instead of the full-size
 * original. We cap the largest edge at 1080px (feed/detail images never need
 * more on a phone) and let Supabase pick modern formats + quality.
 *
 * Public object URLs look like:
 *   {base}/storage/v1/object/public/{bucket}/{path}
 * The render endpoint is:
 *   {base}/storage/v1/render/image/public/{bucket}/{path}?width=&height=&resize=
 */

const PUBLIC_SEGMENT = "/storage/v1/object/public/";
const RENDER_SEGMENT = "/storage/v1/render/image/public/";

/**
 * Return a transformed URL that renders `url` at most `size`px on its largest
 * edge (default 1080). Non-storage URLs (or non-images) are returned unchanged.
 */
export function optimizedImage(
  url: string | null | undefined,
  size = 1080
): string | null {
  if (!url) return null;
  if (!url.includes(PUBLIC_SEGMENT)) return url; // not one of our storage objects
  const rendered = url.replace(PUBLIC_SEGMENT, RENDER_SEGMENT);
  const sep = rendered.includes("?") ? "&" : "?";
  // resize=contain keeps aspect ratio and never upscales past the original.
  return `${rendered}${sep}width=${size}&height=${size}&resize=contain&quality=75`;
}

/** Avatars are small; 256px is plenty and much lighter than a full upload. */
export function optimizedAvatar(
  url: string | null | undefined,
  size = 256
): string | null {
  return optimizedImage(url, size);
}
