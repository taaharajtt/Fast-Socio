import { createClient } from "@/lib/supabase/client";
import { CHAT_MEDIA_TTL_SECONDS, CHAT_IMAGE_DISPLAY_SIZE } from "@/lib/chat-media";

/**
 * In-memory signed-URL cache + de-dupe for private chat-media attachments
 * (perf pass). Without this, every newly-visible message signs its own
 * attachment independently — reopening a thread, or loading a page of 50
 * older messages, fired one Storage round trip per image with no reuse.
 *
 * Module-level (not component state) so the cache survives remounting the
 * same conversation thread, not just the component's own lifetime.
 */

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();

// Refresh a bit before the token actually expires so a nearly-stale entry is
// never handed out only to 403 moments later.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return Boolean(entry) && entry!.expiresAt - REFRESH_MARGIN_MS > Date.now();
}

/**
 * Sign one chat-media path, reusing a cached URL until it's near expiry and
 * de-duping concurrent callers asking for the same path (e.g. a realtime
 * INSERT and a bulk older-messages load racing on the same attachment).
 * Images are signed at display size, not the full 1080p upload.
 */
export async function signChatMedia(
  path: string,
  type: "image" | "voice"
): Promise<string | null> {
  const cached = cache.get(path);
  if (isFresh(cached)) return cached.url;

  const running = inFlight.get(path);
  if (running) return running;

  const promise = (async () => {
    const supabase = createClient();
    const { data } = await supabase.storage.from("chat-media").createSignedUrl(
      path,
      CHAT_MEDIA_TTL_SECONDS,
      type === "image"
        ? {
            transform: {
              width: CHAT_IMAGE_DISPLAY_SIZE,
              height: CHAT_IMAGE_DISPLAY_SIZE,
              resize: "contain",
            },
          }
        : undefined
    );
    if (!data?.signedUrl) return null;
    cache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + CHAT_MEDIA_TTL_SECONDS * 1000,
    });
    return data.signedUrl;
  })().finally(() => inFlight.delete(path));

  inFlight.set(path, promise);
  return promise;
}

/**
 * Sign several paths concurrently rather than serially — used when a page of
 * older messages arrives with multiple attachments at once. Supabase's batch
 * `createSignedUrls()` can't apply a per-file transform, so this is the
 * closest equivalent: every request fires in parallel while still keeping
 * the at-display-size transform, cache, and de-dupe from `signChatMedia`.
 */
export async function signChatMediaMany(
  items: { path: string; type: "image" | "voice" }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    items.map(async ({ path, type }) => {
      const url = await signChatMedia(path, type);
      if (url) out.set(path, url);
    })
  );
  return out;
}
