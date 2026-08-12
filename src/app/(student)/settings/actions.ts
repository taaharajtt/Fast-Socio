"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatMediaPath } from "@/lib/chat-media";
import { listObjects, deleteObjects } from "@/lib/s3/sign";

// Matches both the Contabo form ({base}/post-media/…) and any legacy Supabase
// URL still stored on an old row ({base}/storage/v1/object/public/post-media/…),
// so account deletion keeps working across the migration rather than silently
// skipping files whose URL predates it.
const POST_MEDIA_MARKER = "/post-media/";

/**
 * Permanently delete the caller's account. Deleting the auth user cascades to
 * profiles and all owned DB rows (FK on delete cascade), but Supabase Storage is
 * NOT cascaded — so we first purge the user's uploaded objects (avatars, post
 * images, DM attachments), otherwise they linger and stay retrievable (P5-03).
 * Requires the service-role key, so it runs through the admin client — but only
 * ever for the caller's own id, read from their authenticated session.
 */
export async function deleteAccount(): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { error: "You are not signed in." };
  const uid = userId;

  // Gather the user's storage objects BEFORE the DB rows cascade away.
  const [{ data: myPosts }, { data: myMsgs }] = await Promise.all([
    supabase.from("feed_posts").select("image_url").eq("author_id", uid),
    supabase
      .from("messages")
      .select("attachment_url")
      .eq("sender_id", uid)
      .not("attachment_url", "is", null),
  ]);

  const admin = createAdminClient();

  // Media now lives in Contabo Object Storage, which has no cascade — these
  // deletes are the only thing stopping a removed account's files from living
  // on indefinitely.

  // Avatars live under avatars/<uid>/…
  const avatarPaths = await listObjects("avatars", uid);
  await deleteObjects("avatars", avatarPaths);

  // Post images (post-media/shared/<uuid>): extract paths from the public URLs.
  const postPaths = (myPosts ?? [])
    .map((p) => p.image_url as string | null)
    .filter((u): u is string => u !== null && u.includes(POST_MEDIA_MARKER))
    .map((u) => u.slice(u.indexOf(POST_MEDIA_MARKER) + POST_MEDIA_MARKER.length));
  await deleteObjects("post-media", postPaths);

  // DM attachments (chat-media): normalize each stored value to a path.
  const chatPaths = (myMsgs ?? [])
    .map((m) => chatMediaPath(m.attachment_url as string | null))
    .filter((p): p is string => Boolean(p));
  await deleteObjects("chat-media", chatPaths);

  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) return { error: error.message };

  await supabase.auth.signOut();
  redirect("/login");
}
