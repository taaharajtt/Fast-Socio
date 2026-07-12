"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isAppStorageUrl } from "@/lib/url-safety";
import { FEED_PAGE_SIZE, type FeedPost } from "@/lib/feed/types";
import { scoreContent, blockMessage } from "@/lib/moderation/rules";
import { postingBlockReason } from "@/lib/moderation/server";

/**
 * Fetch a page of the main campus feed older than `cursor` (a created_at ISO
 * string). Keyset pagination on created_at — stable under inserts and cheap
 * (indexed) — so the feed can load older posts when it runs out (P4-05).
 */
export async function fetchFeedPage(
  cursor: string | null
): Promise<FeedPost[]> {
  const supabase = await createClient();
  let query = supabase
    .from("feed_posts")
    .select("*")
    .is("community_id", null)
    .order("created_at", { ascending: false })
    .limit(FEED_PAGE_SIZE);
  if (cursor) query = query.lt("created_at", cursor);
  const { data } = await query;
  return (data as FeedPost[]) ?? [];
}

/** Create a post (text and/or image), optionally anonymous and/or in a community. */
export async function createPost(input: {
  body: string;
  imageUrl?: string | null;
  isAnonymous: boolean;
  communityId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const body = input.body.trim();
  if (!body && !input.imageUrl)
    return { ok: false, error: "Write something or add an image." };
  if (body.length > 2000)
    return { ok: false, error: "Posts are limited to 2000 characters." };
  // Only accept images we host (P2-04): the client supplies this URL.
  if (input.imageUrl && !isAppStorageUrl(input.imageUrl))
    return { ok: false, error: "Invalid image." };

  const allowed = await checkRateLimit("post", 30, 60 * 60);
  if (!allowed) return { ok: false, error: "You're posting too fast." };

  // Moderation restriction gate (Phase 9).
  const restricted = await postingBlockReason();
  if (restricted) return { ok: false, error: restricted };

  // Rule engine (Phase 9): block severe content; a risky score (≥41) is written
  // to risk_score and the create trigger holds the post as pending for review.
  const risk = scoreContent(body);
  if (risk.action === "block")
    return { ok: false, error: blockMessage(risk) };

  // UAT-005: community Main-panel posts are always attributed — anonymity moved
  // to the community chat room. The composer hides the toggle, but the flag is
  // client-supplied, so it is enforced here rather than trusted.
  const isAnonymous = input.communityId ? false : input.isAnonymous;

  // No .select() — the posts table's SELECT is revoked (anonymity). return=minimal.
  const { error } = await supabase.from("posts").insert({
    author_id: userId,
    body: body || null,
    image_url: input.imageUrl ?? null,
    is_anonymous: isAnonymous,
    community_id: input.communityId ?? null,
    risk_score: risk.score,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(input.communityId ? `/communities/${input.communityId}` : "/home");
  return { ok: true };
}

/**
 * Toggle a like on a post. Returns { ok } so the caller can roll back an
 * optimistic UI update when the like doesn't persist (rate-limited, blocked, or
 * a DB error) — P6-02.
 */
export async function toggleLike(
  postId: string,
  currentlyLiked: boolean
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false };

  // Throttle like/unlike loops so a target can't be flooded with like
  // notifications + Web Push (P5-04).
  const allowed = await checkRateLimit(
    "postLike",
    RATE_LIMITS.postLike.max,
    RATE_LIMITS.postLike.windowSeconds
  );
  if (!allowed) return { ok: false };

  const { error } = currentlyLiked
    ? await supabase
        .from("post_likes")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", userId)
    : await supabase
        .from("post_likes")
        .insert({ post_id: postId, user_id: userId });

  return { ok: !error };
}

/**
 * Delete one of the caller's own posts (UAT-003). RLS ("authors delete their
 * own posts") is the real guard; we scope the delete to author_id as well so a
 * mistargeted id can never touch someone else's row. Likes/comments cascade.
 */
export async function deletePost(
  postId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("author_id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/home");
  revalidatePath("/profile");
  return { ok: true };
}

export type CommentAuthor = { full_name: string | null; avatar_url: string | null };

/** A comment or reply row, enriched for the Instagram-style thread UI. */
export type FeedComment = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  /** null for a top-level comment; the parent comment's id for a reply. */
  parent_id: string | null;
  /** Likes on this comment (denormalized; maintained by trigger). */
  like_count: number;
  /** Direct replies to this comment (always 0 for a reply — one level deep). */
  reply_count: number;
  /** Whether the signed-in viewer has liked this comment. */
  liked_by_me: boolean;
};

/**
 * Attach author profiles and the viewer's like state to a set of comment rows.
 * Shared by the top-level thread load and the lazy reply load so both render
 * identical, fully-hydrated rows.
 */
async function hydrateComments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: Omit<FeedComment, "liked_by_me">[],
  viewerId: string | null
): Promise<{ comments: FeedComment[]; authors: Record<string, CommentAuthor> }> {
  const authorIds = [...new Set(rows.map((c) => c.author_id))];
  const authors: Record<string, CommentAuthor> = {};
  if (authorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", authorIds);
    (profs ?? []).forEach((p: { id: string } & CommentAuthor) => {
      authors[p.id] = { full_name: p.full_name, avatar_url: p.avatar_url };
    });
  }

  // One query for every comment the viewer has liked among this batch.
  const likedIds = new Set<string>();
  if (viewerId && rows.length > 0) {
    const { data: likes } = await supabase
      .from("comment_likes")
      .select("comment_id")
      .eq("user_id", viewerId)
      .in(
        "comment_id",
        rows.map((c) => c.id)
      );
    (likes ?? []).forEach((l: { comment_id: string }) => likedIds.add(l.comment_id));
  }

  const comments: FeedComment[] = rows.map((c) => ({
    ...c,
    liked_by_me: likedIds.has(c.id),
  }));
  return { comments, authors };
}

/**
 * Load a post's top-level comments (parent_id is null) plus a lookup of their
 * authors and the viewer's like state, for the in-feed comment sheet (UAT-004).
 * Replies are lazy-loaded per comment via fetchReplies. Mirrors the post-detail
 * page's server load so the sheet and the full page render identical data.
 */
export async function fetchComments(postId: string): Promise<{
  comments: FeedComment[];
  authors: Record<string, CommentAuthor>;
  /** The signed-in viewer's avatar — rendered beside the composer (IG format). */
  viewerAvatar: string | null;
  /** The signed-in viewer's id — used to attribute their own replies. */
  viewerId: string | null;
}> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  const viewerId = userId;

  const { data: rows } = await supabase
    .from("post_comments")
    .select("id, author_id, body, created_at, parent_id, like_count, reply_count")
    .eq("post_id", postId)
    .is("parent_id", null)
    .eq("hidden", false)
    .order("created_at", { ascending: true });

  const { comments, authors } = await hydrateComments(
    supabase,
    (rows as Omit<FeedComment, "liked_by_me">[]) ?? [],
    viewerId
  );

  let viewerAvatar: string | null = null;
  if (userId) {
    const { data: me } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", userId)
      .single();
    viewerAvatar = me?.avatar_url ?? null;
  }

  return { comments, authors, viewerAvatar, viewerId };
}

/**
 * Lazy-load the replies for a single top-level comment (the "View replies"
 * toggle). Returns the same enriched shape as fetchComments so a reply renders
 * exactly like a comment.
 */
export async function fetchReplies(commentId: string): Promise<{
  replies: FeedComment[];
  authors: Record<string, CommentAuthor>;
}> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();

  const { data: rows } = await supabase
    .from("post_comments")
    .select("id, author_id, body, created_at, parent_id, like_count, reply_count")
    .eq("parent_id", commentId)
    .eq("hidden", false)
    .order("created_at", { ascending: true });

  const { comments, authors } = await hydrateComments(
    supabase,
    (rows as Omit<FeedComment, "liked_by_me">[]) ?? [],
    userId
  );
  return { replies: comments, authors };
}

/**
 * Add a comment to a post, or a reply when parentId is set. One level of
 * nesting only — a reply's parent must itself be a top-level comment, enforced
 * by the enforce_comment_depth trigger (0065) in addition to this check.
 */
export async function addComment(
  postId: string,
  body: string,
  parentId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const text = body.trim();
  if (text.length < 1 || text.length > 1000)
    return { ok: false, error: "Comment must be 1–1000 characters." };

  const allowed = await checkRateLimit("comment", 60, 60 * 60);
  if (!allowed) return { ok: false, error: "You're commenting too fast." };

  const restricted = await postingBlockReason();
  if (restricted) return { ok: false, error: restricted };

  // Rule engine (Phase 9): block severe content; hold a risky comment (hidden
  // until a moderator restores it).
  const risk = scoreContent(text);
  if (risk.action === "block")
    return { ok: false, error: blockMessage(risk) };

  const { error } = await supabase.from("post_comments").insert({
    post_id: postId,
    author_id: userId,
    body: text,
    parent_id: parentId ?? null,
    risk_score: risk.score,
    hidden: risk.action === "hold",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/post/${postId}`);
  return { ok: true };
}

/**
 * Toggle a like on a comment or reply. Returns { ok } so the caller can roll
 * back an optimistic UI update when it doesn't persist (rate-limited, blocked,
 * or a DB error) — mirrors toggleLike for posts.
 */
export async function toggleCommentLike(
  commentId: string,
  currentlyLiked: boolean
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false };

  // Throttle like/unlike loops (parity with post likes).
  const allowed = await checkRateLimit("commentLike", 120, 60 * 60);
  if (!allowed) return { ok: false };

  const { error } = currentlyLiked
    ? await supabase
        .from("comment_likes")
        .delete()
        .eq("comment_id", commentId)
        .eq("user_id", userId)
    : await supabase
        .from("comment_likes")
        .insert({ comment_id: commentId, user_id: userId });

  return { ok: !error };
}

/** Report a post (target_type = 'post'), feeding /admin/reports?type=post. */
export async function reportPost(
  postId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const allowed = await checkRateLimit(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Too many reports for now." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: userId,
    target_type: "post",
    target_id: postId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
