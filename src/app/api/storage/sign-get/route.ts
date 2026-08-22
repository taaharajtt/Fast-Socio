import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeDownload } from "@/lib/s3/authorize";
import { presignDownload, s3Configured } from "@/lib/s3/sign";
import { isWellFormedObjectPath } from "@/lib/s3/buckets";
import { CHAT_MEDIA_TTL_SECONDS } from "@/lib/chat-media";

/**
 * Mint short-lived presigned GETs for private `chat-media` objects
 * (Contabo migration, Phase 3) — the replacement for
 * `supabase.storage.createSignedUrl()`.
 *
 * Accepts a BATCH of paths because the chat thread signs many attachments at
 * once (a page of 50 older messages can carry several). Supabase's own batch
 * signer couldn't apply per-file transforms, which is why the client used to
 * fan out one request per attachment; since transforms now happen at the
 * imgproxy layer rather than at signing time, one round trip does the whole page.
 *
 * Every path is authorized individually — a caller that can read one room must
 * not get a free pass on another room in the same batch.
 */
const MAX_BATCH = 60;

export async function POST(request: Request) {
  if (!s3Configured) {
    return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { paths } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_BATCH) {
    return NextResponse.json({ error: "Invalid paths." }, { status: 400 });
  }

  const urls: Record<string, string> = {};
  for (const path of paths) {
    if (!isWellFormedObjectPath(path)) continue;
    const authz = await authorizeDownload("chat-media", path, user.id);
    // Unauthorized paths are silently omitted rather than failing the batch:
    // one stale attachment must not blank out an entire thread.
    if (!authz.ok) continue;
    urls[path] = presignDownload("chat-media", path, CHAT_MEDIA_TTL_SECONDS);
  }

  return NextResponse.json({ urls }, { headers: { "cache-control": "no-store" } });
}
