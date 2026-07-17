"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isAppStorageUrl } from "@/lib/url-safety";
import { FEED_PAGE_SIZE, type FeedPost } from "@/lib/feed/types";
import { scoreContent, blockMessage } from "@/lib/moderation/rules";
import { postingBlockReason } from "@/lib/moderation/server";
import {
  mentionToken,
  mentionsToPlainText,
  parseMentions,
} from "@/lib/mentions";

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

/** Create a post (text and/or image, or a poll), optionally anonymous and/or in
 *  a community. When `pollOptions` is present the post carries a poll: `body` is
 *  the question and no image is attached. */
export async function createPost(input: {
  body: string;
  imageUrl?: string | null;
  isAnonymous: boolean;
  communityId?: string | null;
  /** 2–6 option labels. Present ⇒ this is a poll post (body is the question). */
  pollOptions?: string[] | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const body = input.body.trim();
  // A poll needs its question; the options carry the rest of the meaning.
  const pollOptions = (input.pollOptions ?? [])
    .map((o) => o.trim())
    .filter(Boolean);
  const isPoll = (input.pollOptions?.length ?? 0) > 0;

  if (isPoll) {
    if (!body) return { ok: false, error: "Ask a poll question." };
    if (pollOptions.length < 2 || pollOptions.length > 6)
      return { ok: false, error: "A poll needs 2–6 options." };
    if (pollOptions.some((o) => o.length > 80))
      return { ok: false, error: "Poll options are limited to 80 characters." };
  } else if (!body && !input.imageUrl) {
    return { ok: false, error: "Write something or add an image." };
  }
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

  // A poll post: create the poll + options first (definer RPC), then attach it.
  // Done after the moderation gate so a blocked question never mints a poll.
  let pollId: string | null = null;
  if (isPoll) {
    const { data, error } = await supabase.rpc("create_post_poll", {
      p_question: body,
      p_options: pollOptions,
    });
    if (error) return { ok: false, error: error.message };
    pollId = data as string;
  }

  // No .select() — the posts table's SELECT is revoked (anonymity). return=minimal.
  const { error } = await supabase.from("posts").insert({
    author_id: userId,
    body: body || null,
    image_url: isPoll ? null : (input.imageUrl ?? null),
    is_anonymous: isAnonymous,
    community_id: input.communityId ?? null,
    poll_id: pollId,
    risk_score: risk.score,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(input.communityId ? `/communities/${input.communityId}` : "/home");
  return { ok: true };
}

export type PostPollOption = {
  option_id: string;
  label: string;
  position: number;
  votes: number;
  voted_by_me: boolean;
};

/**
 * Tallies for a single post poll plus the caller's own choice. Individual
 * ballots are private (RLS); post_poll_results aggregates under definer rights.
 */
export async function fetchPostPoll(pollId: string): Promise<PostPollOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("post_poll_results")
    .select("option_id, label, position, votes, voted_by_me")
    .eq("poll_id", pollId)
    .order("position", { ascending: true });
  return (data ?? []).map((row) => ({
    option_id: row.option_id as string,
    label: row.label as string,
    position: row.position as number,
    votes: Number(row.votes),
    voted_by_me: Boolean(row.voted_by_me),
  }));
}

/** Cast (or move) the caller's vote on a post poll. One ballot per poll. */
export async function votePostPoll(
  pollId: string,
  optionId: string
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("vote_post_poll", {
    p_poll_id: pollId,
    p_option_id: optionId,
  });
  return { ok: !error };
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
 * Delete one of the caller's own posts (UAT-003). Goes through the delete_post
 * SECURITY DEFINER RPC (mig 0072): the client can't DELETE from `posts` directly
 * because table SELECT is revoked for anonymity, and a DELETE's WHERE clause
 * needs SELECT on the columns it reads. The RPC enforces ownership via auth.uid()
 * and cleans up any attached poll. Likes/comments cascade.
 */
export async function deletePost(
  postId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("delete_post", { p_post_id: postId });
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

/** A user the viewer can @-mention in a comment (one of their matches). */
export type MentionTarget = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

/**
 * The set of people the viewer may @-mention: their matches. Returned once when
 * the composer first needs it and filtered client-side as the user types, so
 * autocomplete is instant and there's no per-keystroke round trip. Mentions are
 * restricted to matches by design — you can only tag people you've matched with.
 */
export async function fetchMentionRoster(): Promise<MentionTarget[]> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return [];

  const { data: matchRows } = await supabase
    .from("matches")
    .select("user_low, user_high")
    .or(`user_low.eq.${userId},user_high.eq.${userId}`);
  const otherIds = [
    ...new Set(
      (matchRows ?? []).map((m) =>
        m.user_low === userId ? m.user_high : m.user_low
      )
    ),
  ];
  if (otherIds.length === 0) return [];

  const { data } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .in("id", otherIds);
  return (data ?? []) as MentionTarget[];
}

/**
 * Make every @-mention token in a comment truthful before it's stored. For each
 * token the client sent, we keep the link only when its id is a REAL profile
 * that the author is actually matched with, and we relabel it with that
 * profile's own username — so a crafted body can never render "@victim" pointing
 * at someone else's page. Anything else is downgraded to plain "@handle" text.
 */
async function sanitizeMentions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  authorId: string,
  body: string
): Promise<string> {
  const parts = parseMentions(body);
  const ids = [
    ...new Set(parts.flatMap((p) => (p.type === "mention" ? [p.id] : []))),
  ];
  if (ids.length === 0) return body;

  const [{ data: profs }, { data: matchRows }] = await Promise.all([
    supabase.from("profiles").select("id, username").in("id", ids),
    supabase
      .from("matches")
      .select("user_low, user_high")
      .or(`user_low.eq.${authorId},user_high.eq.${authorId}`),
  ]);
  const nameById = new Map(
    (profs ?? []).map((p: { id: string; username: string | null }) => [
      p.id,
      p.username,
    ])
  );
  const matched = new Set(
    (matchRows ?? []).map((m) =>
      m.user_low === authorId ? m.user_high : m.user_low
    )
  );

  return parts
    .map((part) => {
      if (part.type === "text") return part.value;
      const realName = nameById.get(part.id);
      if (realName && matched.has(part.id) && part.id !== authorId)
        return mentionToken(realName, part.id);
      return `@${realName ?? part.username}`;
    })
    .join("");
}

/**
 * Add a comment to a post, or a reply when parentId is set. One level of
 * nesting only — a reply's parent must itself be a top-level comment, enforced
 * by the enforce_comment_depth trigger (0065) in addition to this check.
 *
 * `body` may carry @-mention tokens (see lib/mentions). Length and moderation
 * run on the human-visible text, and mentions are sanitized so stored links are
 * always truthful.
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
  // Validate + moderate the human-readable text, not the token markup.
  const visible = mentionsToPlainText(text);
  if (visible.length < 1 || visible.length > 1000)
    return { ok: false, error: "Comment must be 1–1000 characters." };

  const allowed = await checkRateLimit("comment", 60, 60 * 60);
  if (!allowed) return { ok: false, error: "You're commenting too fast." };

  const restricted = await postingBlockReason();
  if (restricted) return { ok: false, error: restricted };

  // Rule engine (Phase 9): block severe content; hold a risky comment (hidden
  // until a moderator restores it).
  const risk = scoreContent(visible);
  if (risk.action === "block")
    return { ok: false, error: blockMessage(risk) };

  const storedBody = await sanitizeMentions(supabase, userId, text);
  // Mention tokens expand the stored body (mig 0095 widened the CHECK to 4000);
  // guard here so an extreme mention count returns a friendly message instead of
  // a raw constraint error.
  if (storedBody.length > 4000)
    return { ok: false, error: "Too many mentions in one comment." };

  const { error } = await supabase.from("post_comments").insert({
    post_id: postId,
    author_id: userId,
    body: storedBody,
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

/**
 * Delete one of the caller's own comments or replies. RLS ("authors delete their
 * own comments") is the real guard; we scope by author_id too so a mistargeted
 * id can never touch someone else's row. Replies cascade (parent_id FK), likes
 * cascade, and the count trigger keeps the post's comment_count accurate.
 */
export async function deleteComment(
  commentId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("post_comments")
    .delete()
    .eq("id", commentId)
    .eq("author_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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

/**
 * Stamp profiles.tour_seen_at so the first-run guided tour never re-appears
 * for this ACCOUNT (any device). Called when the tour is finished or skipped.
 * Best-effort: on failure the tour simply offers itself again next visit.
 */
export async function markTourSeen(): Promise<void> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return;
  await supabase
    .from("profiles")
    .update({ tour_seen_at: new Date().toISOString() })
    .eq("id", userId);
}
