/**
 * next/image custom loader (audit C2).
 *
 * Routes storage images through imgproxy so the browser downloads a WebP/AVIF
 * render at exactly the width next/image asks for (responsive srcset) instead
 * of the full-size original.
 *
 * Using a per-`<Image>` loader (rather than the built-in optimizer) keeps image
 * resizing on the imgproxy container we already run, instead of burning VPS CPU
 * in the Next.js process on every request, and avoids needing
 * `images.remotePatterns`. Presigned/private URLs (chat media) and external
 * images are returned unchanged — imgproxy is locked to our own public bucket,
 * and a presigned URL's signature would not survive proxying anyway.
 */

const IMGPROXY = process.env.NEXT_PUBLIC_IMGPROXY_URL?.replace(/\/$/, "") ?? "";
const PUBLIC_BASE = process.env.NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";

/**
 * Normalize `src` back to the plain object URL so the transform below always
 * applies exactly once. A src can already be pre-transformed if a caller ran it
 * through `optimizedImage`/`optimizedAvatar` (lib/image.ts) before handing it
 * to <AppImage> — without this, wrapping an imgproxy URL in another imgproxy
 * URL would request a transform-of-a-transform instead of the single width
 * next/image actually wants for its current breakpoint.
 */
function toPlainSource(src: string): string | null {
  if (IMGPROXY && src.startsWith(`${IMGPROXY}/`)) {
    const encoded = src.split("/plain/")[1];
    if (!encoded) return null;
    const decoded = decodeURIComponent(encoded);
    return decoded.startsWith(`${PUBLIC_BASE}/`) ? decoded : null;
  }
  if (PUBLIC_BASE && src.startsWith(`${PUBLIC_BASE}/`)) return src;
  return null; // presigned / external — not ours to transform
}

export function storageLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  if (!IMGPROXY) return src;
  const plain = toPlainSource(src);
  if (!plain) return src;
  // Width only → aspect ratio preserved; the sized container crops via
  // object-fit. The trailing :0 disables enlargement past the original.
  return `${IMGPROXY}/insecure/rs:fit:${width}:0:0/q:${quality ?? 70}/plain/${encodeURIComponent(plain)}`;
}
