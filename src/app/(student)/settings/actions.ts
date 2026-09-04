"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatMediaPath } from "@/lib/chat-media";
import { postMediaPaths } from "@/lib/post-media";
import { listObjects, deleteObjects } from "@/lib/s3/sign";

/**
 * Permanently delete the caller's own account (UAT-16).
 *
 * THE ORDER MATTERS, and it is the opposite of what it used to be.
 *
 * Before: purge storage, then delete the auth user. If the delete failed — a
 * transient Auth API error, a missing service-role key — the student had just
 * had every avatar, post image and DM attachment destroyed while their account
 * carried on existing. The irreversible half ran first and the authoritative
 * half could still fail.
 *
 * Now: READ the object paths (they are only discoverable while the rows exist),
 * DELETE the account, then purge. If the purge fails the account is genuinely
 * gone — which is what the user asked for and what the UI is about to claim —
 * and the leftover objects are logged with their keys so the purge can be
 * re-run. Deletion is therefore idempotent: calling it again on an already
 * deleted user is a no-op, not an error.
 *
 * The service-role client is server-only and is only ever handed the id read
 * from the caller's own verified session; there is no parameter a caller could
 * use to name someone else.
 */
export async function deleteAccount(): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { error: "You are not signed in." };
  const uid = userId;

  // Gather the user's storage objects BEFORE the DB rows cascade away — after
  // the delete there is nothing left to derive these paths from.
  const [{ data: myPostMedia }, { data: myMsgs }] = await Promise.all([
    // Every media URL this account's posts reference — the single image of a
    // legacy post, the cover AND all five slides of a carousel, and posts the
    // feed view hides (pending moderation, hidden). Reading feed_posts.image_url
    // used to miss all three of those (mig 0180).
    supabase.rpc("my_post_media_urls"),
    supabase
      .from("messages")
      .select("attachment_url")
      .eq("sender_id", uid)
      .not("attachment_url", "is", null),
  ]);

  // Avatars live under avatars/<uid>/…; post images and DM attachments are
  // derived from the URLs their rows carry. A listing failure must not abort
  // the deletion — it only means fewer objects can be purged, and that is
  // reported below rather than silently swallowed.
  let avatarPaths: string[] = [];
  try {
    avatarPaths = await listObjects("avatars", uid);
  } catch (e) {
    console.error("[deleteAccount] avatar listing failed", { uid, error: e });
  }

  const postPaths = postMediaPaths((myPostMedia as string[] | null) ?? []);

  const chatPaths = (myMsgs ?? [])
    .map((m) => chatMediaPath(m.attachment_url as string | null))
    .filter((p): p is string => Boolean(p));

  // THE IRREVERSIBLE STEP, and the one whose failure the user must hear about.
  // Deleting the auth user cascades to profiles and every owned row via the
  // FK graph; Object Storage has no cascade, which is what the purge below is
  // for.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) {
    // Nothing has been destroyed at this point — the account is intact and the
    // media is untouched — so this is safely retryable.
    console.error("[deleteAccount] auth delete failed", { uid, error: error.message });
    return { error: "We couldn’t delete your account just now. Please try again." };
  }

  // Best-effort purge. The account is already gone; a failure here leaves
  // orphaned objects, which is a cleanup task, not a reason to tell the user
  // their deletion failed (it did not) or to leave them signed in.
  await purge("avatars", avatarPaths, uid);
  await purge("post-media", postPaths, uid);
  await purge("chat-media", chatPaths, uid);

  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Delete a batch of objects, logging what could not be removed.
 *
 * The keys are logged because they are the only record of what still needs
 * purging once the owning rows are gone. No secrets are logged — a bucket
 * prefix and object keys carry no credential, and the keys are already
 * de-identified (`post-media/shared/<uuid>`).
 */
async function purge(bucket: string, paths: string[], uid: string): Promise<void> {
  if (paths.length === 0) return;
  try {
    await deleteObjects(bucket, paths);
  } catch (e) {
    console.error("[deleteAccount] orphaned objects after account delete", {
      uid,
      bucket,
      paths,
      error: e,
    });
  }
}
