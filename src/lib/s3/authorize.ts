import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isWellFormedObjectPath, type StoragePrefix } from "@/lib/s3/buckets";

/**
 * Server-side authorization for Contabo object access (Contabo migration, Phase 3).
 *
 * WHY THIS FILE IS THE RISKIEST PART OF THE MIGRATION
 *
 * On Supabase, authorization lived in RLS policies on `storage.objects`, and the
 * browser talked to Storage directly with the USER'S OWN JWT — so Postgres
 * evaluated the policy on every single object request. Plain S3 has no concept
 * of "this user"; a presigned URL is signed with OUR credentials and grants
 * whatever it says. So every check the database used to make must be made here,
 * before signing, or it simply does not happen.
 *
 * The rules below were reconstructed from BOTH sources, because neither alone
 * describes the real model:
 *   - the RLS policies (migrations 0002, 0007, 0008, 0024, 0030), and
 *   - app-level path-prefix checks in communities/actions.ts and
 *     societies/actions.ts.
 *
 * That gap is not theoretical. `chat-media`'s SELECT policy only ever covered
 * 1:1 `conversations` participants, yet the same bucket also holds community
 * and society attachments keyed by `<community_id>/`. Those were gated purely by
 * app code. Transcribing the RLS policy alone would have locked community chat
 * out; trusting the app checks alone would have opened DMs up.
 */

export type AuthzResult = { ok: true } | { ok: false; status: 401 | 403; reason: string };

const DENY_FORBIDDEN: AuthzResult = { ok: false, status: 403, reason: "Not allowed." };

/**
 * Can `userId` write to `prefix/path`?
 *
 * Mirrors the INSERT/UPDATE policies: owner-folder for avatars, owner-folder or
 * the shared anon folder for post-media, room-membership for chat-media.
 */
export async function authorizeUpload(
  prefix: StoragePrefix,
  path: string,
  userId: string
): Promise<AuthzResult> {
  if (!isWellFormedObjectPath(path)) {
    return { ok: false, status: 403, reason: "Malformed object path." };
  }
  const [folder] = path.split("/");

  switch (prefix) {
    // 0002: `(storage.foldername(name))[1] = auth.uid()::text`
    case "avatars":
      return folder === userId ? { ok: true } : DENY_FORBIDDEN;

    // 0008 + 0024: own folder, or the `shared/` folder used by anonymous posts.
    case "post-media":
      return folder === userId || folder === "shared" ? { ok: true } : DENY_FORBIDDEN;

    // 0007/0030 for DMs, plus the app-level community/society rules.
    case "chat-media":
      return authorizeRoomAccess(folder, userId);
  }
}

/**
 * Can `userId` read `prefix/path`?
 *
 * avatars and post-media are served straight from the public prefixes and never
 * reach this function. Only chat-media needs a presigned GET, and it needs the
 * same room check as writing.
 */
export async function authorizeDownload(
  prefix: StoragePrefix,
  path: string,
  userId: string
): Promise<AuthzResult> {
  if (!isWellFormedObjectPath(path)) {
    return { ok: false, status: 403, reason: "Malformed object path." };
  }
  if (prefix !== "chat-media") {
    // Public prefixes: no signing needed, so asking for one is a caller bug.
    return { ok: false, status: 403, reason: "That prefix is publicly readable." };
  }
  return authorizeRoomAccess(path.split("/")[0], userId);
}

/**
 * The `chat-media` folder segment is a room id that may be EITHER a 1:1
 * conversation or a community/society. Both are checked, because both write
 * into this one prefix.
 *
 * Uses the request-scoped (RLS-bound) client on purpose — not the service-role
 * admin client. If a lookup is somehow visible to this user it is because the
 * database says so, which keeps this check honest even if the SQL below drifts.
 */
async function authorizeRoomAccess(roomId: string, userId: string): Promise<AuthzResult> {
  // Both ids are shape-checked before use. `userId` in particular is
  // interpolated into a PostgREST `.or()` filter below, where a value
  // containing a comma or a dot would change the filter's meaning rather than
  // being treated as data — so it must be a UUID and nothing else.
  if (!isUuid(roomId) || !isUuid(userId)) return DENY_FORBIDDEN;
  const supabase = await createClient();

  // 1:1 DM — 0007/0030: participant of the conversation.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", roomId)
    .or(`user_low.eq.${userId},user_high.eq.${userId}`)
    .maybeSingle();
  if (conversation) return { ok: true };

  // Community or society room — membership, matching the app-level checks in
  // communities/actions.ts and societies/actions.ts. (Societies are communities
  // with is_society = true, so one membership table covers both.)
  const { data: membership } = await supabase
    .from("community_members")
    .select("community_id")
    .eq("community_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membership) return { ok: true };

  return DENY_FORBIDDEN;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
