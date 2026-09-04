/**
 * Post-media object-path helpers.
 *
 * Post images are stored under the `post-media` prefix at a de-identified,
 * random key (`shared/<uuid>.<ext>` — P3-01, so an anonymous post's image URL
 * cannot leak its author). The rows store the full public URL; every cleanup
 * path needs the bucket-relative key instead.
 *
 * The marker matches both the Contabo form ({base}/post-media/…) and any legacy
 * Supabase URL still on an old row ({base}/storage/v1/object/public/post-media/…),
 * so cleanup keeps working across the storage migration rather than silently
 * skipping files whose URL predates it.
 */
const POST_MEDIA_MARKER = "/post-media/";

/** Bucket-relative key for a stored post-media URL, or null if it isn't one. */
export function postMediaPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const idx = url.indexOf(POST_MEDIA_MARKER);
  if (idx === -1) return null;
  const path = url.slice(idx + POST_MEDIA_MARKER.length);
  return path.length > 0 ? path : null;
}

/** Keys for a batch of URLs, dropping anything that isn't post media. */
export function postMediaPaths(urls: readonly (string | null | undefined)[]): string[] {
  return urls.flatMap((u) => {
    const path = postMediaPath(u);
    return path ? [path] : [];
  });
}
