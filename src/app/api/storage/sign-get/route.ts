import { NextResponse } from "next/server";
import { authorizeDownload } from "@/lib/s3/authorize";
import { presignDownload, s3Configured } from "@/lib/s3/sign";
import { isWellFormedObjectPath } from "@/lib/s3/buckets";
import { CHAT_MEDIA_TTL_SECONDS } from "@/lib/chat-media";
import { getAuthUserId } from "@/lib/auth/user";

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
 *
 * PERF (audit F7) — "individually" is a statement about the SECURITY property,
 * not about how many round trips it should cost. This used to be a plain
 * `for (const path of paths) await authorizeDownload(...)`, and
 * `authorizeRoomAccess` makes up to two queries, so a 60-attachment batch could
 * serialise up to 120 database round trips into one request. At a 30ms RTT that
 * is 3.6s of blank image frames; at 150ms it is 18s.
 *
 * The redeeming detail is that authorization depends ONLY on the folder segment
 * of the path — the room id — so a batch from one chat thread asks the same
 * question sixty times. Grouping by that segment and resolving the DISTINCT
 * rooms concurrently collapses the common case to a single pair of queries,
 * while every path still gets its own verdict. Nothing is authorized by
 * association: two paths share a verdict only when they name the same room.
 */
const MAX_BATCH = 60;

export async function POST(request: Request) {
  if (!s3Configured) {
    return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  }

  // getAuthUserId() verifies the session JWT locally against a module-cached
  // JWKS (see lib/auth/user.ts). This used to be `supabase.auth.getUser()`,
  // which calls the Auth API over the network on every invocation — the exact
  // round trip the rest of the app was audited to remove. The id is only used
  // to scope the authorization queries below, which is what `user.id` did.
  const userId = await getAuthUserId();
  if (!userId) {
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

  // Shape-check first, so a malformed path can never reach the grouping step
  // and can never contribute a room id. isWellFormedObjectPath guarantees
  // exactly two non-empty segments with no traversal, so `split("/")[0]` below
  // is a real folder segment and not an attacker-chosen fragment.
  const wellFormed = paths.filter(isWellFormedObjectPath);

  // One authorization per DISTINCT room, resolved concurrently. authorizeDownload
  // is called with a representative path from each group; it derives the room
  // from that path's folder segment, which is by construction identical for
  // every member of the group.
  const byRoom = new Map<string, string[]>();
  for (const path of wellFormed) {
    const room = path.split("/")[0];
    const group = byRoom.get(room);
    if (group) group.push(path);
    else byRoom.set(room, [path]);
  }

  const verdicts = await Promise.all(
    [...byRoom.entries()].map(async ([room, roomPaths]) => {
      const authz = await authorizeDownload("chat-media", roomPaths[0], userId);
      return [room, authz.ok] as const;
    })
  );
  const allowedRooms = new Set(
    verdicts.filter(([, ok]) => ok).map(([room]) => room)
  );

  const urls: Record<string, string> = {};
  for (const path of wellFormed) {
    // Unauthorized paths are silently omitted rather than failing the batch:
    // one stale attachment must not blank out an entire thread.
    if (!allowedRooms.has(path.split("/")[0])) continue;
    urls[path] = presignDownload("chat-media", path, CHAT_MEDIA_TTL_SECONDS);
  }

  return NextResponse.json({ urls }, { headers: { "cache-control": "no-store" } });
}
