"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatMediaPath } from "@/lib/chat-media";

const POST_MEDIA_MARKER = "/storage/v1/object/public/post-media/";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are not signed in." };
  const uid = user.id;

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

  // Avatars live under avatars/<uid>/…
  const { data: avatarFiles } = await admin.storage
    .from("avatars")
    .list(uid, { limit: 1000 });
  if (avatarFiles?.length) {
    await admin.storage
      .from("avatars")
      .remove(avatarFiles.map((f) => `${uid}/${f.name}`));
  }

  // Post images (post-media/shared/<uuid>): extract paths from the public URLs.
  const postPaths = (myPosts ?? [])
    .map((p) => p.image_url as string | null)
    .filter((u): u is string => u !== null && u.includes(POST_MEDIA_MARKER))
    .map((u) => u.slice(u.indexOf(POST_MEDIA_MARKER) + POST_MEDIA_MARKER.length));
  if (postPaths.length) await admin.storage.from("post-media").remove(postPaths);

  // DM attachments (chat-media): normalize each stored value to a path.
  const chatPaths = (myMsgs ?? [])
    .map((m) => chatMediaPath(m.attachment_url as string | null))
    .filter((p): p is string => Boolean(p));
  if (chatPaths.length) await admin.storage.from("chat-media").remove(chatPaths);

  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) return { error: error.message };

  await supabase.auth.signOut();
  redirect("/login");
}
