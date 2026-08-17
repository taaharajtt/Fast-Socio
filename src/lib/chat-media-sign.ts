import { CHAT_MEDIA_TTL_SECONDS } from "@/lib/chat-media";

/**
 * In-memory presigned-URL cache + de-dupe for private chat-media attachments
 * (perf pass). Without this, every newly-visible message signs its own
 * attachment independently — reopening a thread, or loading a page of 50
 * older messages, fired one round trip per image with no reuse.
 *
 * Module-level (not component state) so the cache survives remounting the
 * same conversation thread, not just the component's own lifetime.
 *
 * Signing now goes through our own `/api/storage/sign-get` rather than the
 * Supabase SDK, because a Contabo presigned URL has to be minted server-side —
 * the S3 credentials must never reach the browser. That endpoint authorizes
 * every path individually against the room's membership.
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

function remember(paths: string[], urls: Record<string, string>): void {
  const expiresAt = Date.now() + CHAT_MEDIA_TTL_SECONDS * 1000;
  for (const path of paths) {
    const url = urls[path];
    if (url) cache.set(path, { url, expiresAt });
  }
}

async function fetchSigned(paths: string[]): Promise<Record<string, string>> {
  const res = await fetch("/api/storage/sign-get", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) return {};
  const body = (await res.json()) as { urls?: Record<string, string> };
  return body.urls ?? {};
}

/**
 * Sign one chat-media path, reusing a cached URL until it's near expiry and
 * de-duping concurrent callers asking for the same path (e.g. a realtime
 * INSERT and a bulk older-messages load racing on the same attachment).
 */
export async function signChatMedia(
  path: string,
  _type: "image" | "voice" = "image"
): Promise<string | null> {
  const cached = cache.get(path);
  if (isFresh(cached)) return cached.url;

  const running = inFlight.get(path);
  if (running) return running;

  const promise = (async () => {
    const urls = await fetchSigned([path]);
    remember([path], urls);
    return urls[path] ?? null;
  })().finally(() => inFlight.delete(path));

  inFlight.set(path, promise);
  return promise;
}

/**
 * Sign several paths at once — used when a page of older messages arrives with
 * multiple attachments.
 *
 * This is now a single batched request rather than one per attachment. The old
 * per-file fan-out existed because Supabase's batch signer could not apply a
 * per-file image transform; resizing now happens at the imgproxy layer instead
 * of at signing time, so there is nothing left to vary per file.
 */
export async function signChatMediaMany(
  items: { path: string; type: "image" | "voice" }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];

  for (const { path } of items) {
    const cached = cache.get(path);
    if (isFresh(cached)) out.set(path, cached.url);
    else missing.push(path);
  }

  if (missing.length > 0) {
    const urls = await fetchSigned(missing);
    remember(missing, urls);
    for (const [path, url] of Object.entries(urls)) out.set(path, url);
  }

  return out;
}
