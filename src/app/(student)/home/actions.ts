"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/** Create a post (text and/or image), optionally anonymous. */
export async function createPost(input: {
  body: string;
  imageUrl?: string | null;
  isAnonymous: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const body = input.body.trim();
  if (!body && !input.imageUrl)
    return { ok: false, error: "Write something or add an image." };
  if (body.length > 2000)
    return { ok: false, error: "Posts are limited to 2000 characters." };

  const allowed = await checkRateLimit("post", 30, 60 * 60);
  if (!allowed) return { ok: false, error: "You're posting too fast." };

  // No .select() — the posts table's SELECT is revoked (anonymity). return=minimal.
  const { error } = await supabase.from("posts").insert({
    author_id: user.id,
    body: body || null,
    image_url: input.imageUrl ?? null,
    is_anonymous: input.isAnonymous,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/home");
  return { ok: true };
}

/** Toggle a like on a post. */
export async function toggleLike(postId: string, currentlyLiked: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  if (currentlyLiked) {
    await supabase
      .from("post_likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user.id);
  } else {
    await supabase
      .from("post_likes")
      .insert({ post_id: postId, user_id: user.id });
  }
}

/** Add a comment to a post. */
export async function addComment(
  postId: string,
  body: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const text = body.trim();
  if (text.length < 1 || text.length > 1000)
    return { ok: false, error: "Comment must be 1–1000 characters." };

  const allowed = await checkRateLimit("comment", 60, 60 * 60);
  if (!allowed) return { ok: false, error: "You're commenting too fast." };

  const { error } = await supabase
    .from("post_comments")
    .insert({ post_id: postId, author_id: user.id, body: text });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/post/${postId}`);
  return { ok: true };
}

/** Report a post (target_type = 'post'), feeding /admin/reports?type=post. */
export async function reportPost(
  postId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const allowed = await checkRateLimit(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Too many reports for now." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: "post",
    target_id: postId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
