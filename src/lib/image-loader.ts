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

/**
 * Normalize `src` back to its `object/public` form so the transform below
 * always applies exactly once. A src can already be pre-transformed if a
 * caller ran it through `optimizedImage`/`optimizedAvatar` (lib/image.ts)
 * before handing it to <AppImage> — without this, re-applying width/quality
 * on top of an existing render URL would stack query params and request a
 * transform-of-a-transform instead of the single width next/image actually
 * wants for its current breakpoint.
 */
function toPublicForm(src: string): string | null {
  if (src.includes(PUBLIC_SEGMENT)) return src;
  if (src.includes(RENDER_SEGMENT)) {
    return src.split("?")[0].replace(RENDER_SEGMENT, PUBLIC_SEGMENT);
  }
  return null;
}

export function supabaseLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  const publicForm = toPublicForm(src);
  if (!publicForm) return src; // signed / external — leave as-is
  const rendered = publicForm.replace(PUBLIC_SEGMENT, RENDER_SEGMENT);
  // width only → aspect ratio preserved; the sized container crops via object-fit.
  return `${rendered}?width=${width}&resize=contain&quality=${quality ?? 70}`;
}
