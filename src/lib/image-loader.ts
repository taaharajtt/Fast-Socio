/**
 * next/image custom loader (audit C2).
 *
 * Routes storage images through Supabase's render/transform endpoint so the
 * browser downloads a WebP/AVIF render at exactly the width next/image asks for
 * (responsive srcset) instead of the full-size original. Verified live: a 78 KB
 * JPEG avatar returns as a 4.7 KB WebP at 256px.
 *
 * Using a per-`<Image>` loader (rather than the built-in optimizer) means we
 * reuse the Supabase transform we already pay for, avoid Vercel image units,
 * and don't need `images.remotePatterns`. Signed/private URLs (chat media) or
 * any non-public object are returned unchanged — they cannot be transformed.
 */

const PUBLIC_SEGMENT = "/storage/v1/object/public/";
const RENDER_SEGMENT = "/storage/v1/render/image/public/";

export function supabaseLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  if (!src.includes(PUBLIC_SEGMENT)) return src; // signed / external — leave as-is
  const rendered = src.replace(PUBLIC_SEGMENT, RENDER_SEGMENT);
  const sep = rendered.includes("?") ? "&" : "?";
  // width only → aspect ratio preserved; the sized container crops via object-fit.
  return `${rendered}${sep}width=${width}&resize=contain&quality=${quality ?? 70}`;
}
