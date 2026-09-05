"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveAnonymity } from "@/lib/feed/composer-state";
import { getAuthUserId } from "@/lib/auth/user";
import {
  checkRateLimit,
  checkRateLimitResult,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  COMMENT_LIMITS,
  COMMENT_LIMIT_MESSAGES,
  DUPLICATE_COMMENT_MESSAGE,
  commentLimitMessage,
  isDuplicateComment,
  isFloodingComments,
  postCapExceeded,
  postScopedAction,
  userPostCapExceeded,
} from "@/lib/feed/comment-guard";
import { isAppStorageUrl } from "@/lib/url-safety";
import { FEED_COLUMNS, FEED_PAGE_SIZE, type FeedPost } from "@/lib/feed/types";
import {
  DEFAULT_CAROUSEL_LAYOUT,
  validatePostMedia,
  type PostMediaInput,
} from "@/lib/feed/media";
import { postMediaPaths } from "@/lib/post-media";
import { deleteObjects } from "@/lib/s3/sign";
import { resolveAvatarUrl } from "@/lib/avatar";
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
    .select(FEED_COLUMNS)
    .is("community_id", null)
    .order("created_at", { ascending: false })
    .limit(FEED_PAGE_SIZE);
  if (cursor) query = query.lt("created_at", cursor);
  const { data } = await query;
  return (data as FeedPost[]) ?? [];
}

/**
 * Edit your own post's text (fix-009). Body only — media, anonymity, community
 * and moderation status are untouchable here. Ownership and the same content
 * rules as the create path are enforced inside `edit_post` (mig 0134), which is
 * SECURITY DEFINER precisely so `body`/`edited_at` are the only columns any
 * client can move — the same reason `delete_post` exists.
 */
export async function editPost(
  postId: string,
  body: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const text = body.trim();
  if (text.length > 2000)
    return { ok: false, error: "Posts are limited to 2000 characters." };

  const { error } = await supabase.rpc("edit_post", {
    p_post_id: postId,
    p_body: text,
  });
  if (error) {
    if (error.message.includes("not authorized"))
      return { ok: false, error: "You can only edit your own posts." };
    if (error.message.includes("write something"))
      return { ok: false, error: "Write something." };
    if (error.message.includes("poll questions are limited"))
      return { ok: false, error: "Poll questions are limited to 300 characters." };
    return { ok: false, error: error.message };
  }

  revalidatePath("/home");
  revalidatePath(`/post/${postId}`);
  return { ok: true };
}

/**
 * Turn a `create_post_with_media` exception into something a person can act on.
 *
 * The RPC's messages are deliberately terse and stable (they are the contract);
 * these are the sentences the composer shows. Anything unrecognised falls
 * through unchanged rather than being swallowed into a generic apology.
 */
function friendlyPostError(message: string): string {
  if (message.includes("at most 5 photos"))
    return "A post can have at most 5 photos.";
  if (message.includes("poll cannot carry photos"))
    return "A poll can't also carry photos.";
  if (message.includes("not a member of that community"))
    return "You need to join this community before posting in it.";
  if (message.includes("invalid media")) return "Those photos couldn't be attached.";
  if (message.includes("invalid layout")) return "Unsupported photo layout.";
  if (message.includes("write something"))
    return "Write something or add an image.";
  if (message.includes("not signed in")) return "Not signed in.";
  return message;
}

/**
 * Create a post: text, 1–5 images, or a poll — optionally anonymous and/or in a
 * community.
 *
 * MEDIA IS ORDERED AND ATOMIC. `media` arrives in slide order and its array
 * order IS the stored position, so a client never names a position and cannot
 * invent a duplicate or a gap. The post row and its media rows are written by
 * one SECURITY DEFINER function (mig 0180) precisely so a half-written carousel
 * can never be visible in the feed.
 *
 * `imageUrl` is still accepted for the single legacy shape (a post with one
 * image and no measured dimensions); it is ignored whenever `media` is present,
 * where slide 1 becomes the stored cover.
 */
export async function createPost(input: {
  body: string;
  imageUrl?: string | null;
  isAnonymous: boolean;
  communityId?: string | null;
  /** 2–6 option labels. Present ⇒ this is a poll post (body is the question). */
  pollOptions?: string[] | null;
  /** Ordered 1–5 images. Array order is the slide order. */
  media?: PostMediaInput[] | null;
  /** "uniform" (default) or "mixed" — the post-level carousel layout. */
  carouselLayout?: string | null;
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

  // Independent re-validation of everything the client claims about its media:
  // the count ceiling, the ratio vocabulary, positive dimensions, duplicate
  // URLs, media-on-a-poll, the layout mode, and that every URL is one we host
  // (P2-04). A server action is a public POST endpoint; the composer's copy of
  // these rules is a courtesy and this one is the guarantee.
  const mediaCheck = validatePostMedia({
    media: input.media ?? [],
    layout: input.carouselLayout ?? DEFAULT_CAROUSEL_LAYOUT,
    hasPoll: isPoll,
    isAllowedUrl: (url) => isAppStorageUrl(url),
  });
  if (!mediaCheck.ok) return { ok: false, error: mediaCheck.error };
  const { media, layout } = mediaCheck;

  if (isPoll) {
    if (!body) return { ok: false, error: "Ask a poll question." };
    if (pollOptions.length < 2 || pollOptions.length > 6)
      return { ok: false, error: "A poll needs 2–6 options." };
    if (pollOptions.some((o) => o.length > 80))
      return { ok: false, error: "Poll options are limited to 80 characters." };
  } else if (!body && media.length === 0 && !input.imageUrl) {
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

  // UAT-005 / UAT-13: community Main-panel posts are always attributed —
  // anonymity moved to the community chat room. The composer hides the toggle,
  // but the flag is client-supplied, so it is enforced here rather than trusted.
  //
  // `resolveAnonymity` also insists on a LITERAL `true`. A server action's
  // argument is whatever the caller serialised, and every falsy-looking string
  // ("false", "0") is truthy in JavaScript — so a post must never become
  // anonymous because a value was merely present.
  const isAnonymous = resolveAnonymity(input.isAnonymous, input.communityId);

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

  // The post and every slide in one transaction (mig 0180). The RPC re-derives
  // the author from auth.uid() — a client-supplied author id is never trusted —
  // and re-checks community membership, which SECURITY DEFINER would otherwise
  // bypass. Slide 1's URL is written to posts.image_url as the cover, so every
  // reader that predates carousels keeps working.
  const { error } = await supabase.rpc("create_post_with_media", {
    p_body: body || null,
    p_is_anonymous: isAnonymous,
    p_community_id: input.communityId ?? null,
    p_poll_id: pollId,
    p_risk_score: risk.score,
    p_media: media,
    p_layout: layout,
    // Legacy single-image shape: no measured dimensions, so it becomes the
    // cover and nothing else, rather than a post_media row with an invented
    // ratio. Ignored by the RPC whenever `media` is non-empty.
    p_image_url: isPoll ? null : (input.imageUrl ?? null),
  });
  if (error) return { ok: false, error: friendlyPostError(error.message) };

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

  // Returns every media URL the post referenced — its cover AND every carousel
  // slide — collected before the cascade takes the rows away (mig 0180). Object
  // storage has no cascade, so this is the only moment those keys exist.
  const { data, error } = await supabase.rpc("delete_post", { p_post_id: postId });
  if (error) return { ok: false, error: error.message };

  // Best effort: the post IS deleted, which is what the caller asked for. A
  // failed purge leaves orphaned bytes — a cleanup task, not a failed delete —
  // so it is logged with its keys rather than surfaced as an error.
  const paths = postMediaPaths((data as string[] | null) ?? []);
  if (paths.length > 0) {
    try {
      await deleteObjects("post-media", paths);
    } catch (e) {
      console.error("[deletePost] orphaned objects after post delete", {
        postId,
        paths,
        error: e,
      });
    }
  }

  revalidatePath("/home");
  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Purge photos the composer uploaded for a post that was never created.
 *
 * Each cropped photo uploads as soon as it is confirmed, so publishing is
 * instant — which means an abandoned draft, a removed slide, or a create that
 * failed after some uploads succeeded all leave objects nothing points at. The
 * composer knows those URLs and hands them back here.
 *
 * `unreferenced_post_media` (mig 0180) is what makes this safe: it returns a
 * URL only when NO post and NO media row references it, so a published photo
 * can never be deleted through this path, whoever asks. Best-effort and silent
 * by design — cleanup must never interrupt what the user was actually doing.
 */
export async function discardPostMedia(urls: string[]): Promise<void> {
  if (!Array.isArray(urls) || urls.length === 0) return;
  const userId = await getAuthUserId();
  if (!userId) return;
  // Bound the work a single call can ask for: two full drafts' worth.
  const candidates = urls
    .filter((u) => typeof u === "string" && isAppStorageUrl(u))
    .slice(0, 2 * 5);
  if (candidates.length === 0) return;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unreferenced_post_media", {
    p_urls: candidates,
  });
  if (error) return;

  const paths = postMediaPaths((data as string[] | null) ?? []);
  if (paths.length === 0) return;
  try {
    await deleteObjects("post-media", paths);
  } catch (e) {
    console.error("[discardPostMedia] purge failed", { paths, error: e });
  }
}

export type CommentAuthor = {
  full_name: string | null;
  avatar_url: string | null;
  gender: string | null;
};

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
      .select("id, full_name, avatar_url, gender")
      .in("id", authorIds);
    (profs ?? []).forEach((p: { id: string } & CommentAuthor) => {
      authors[p.id] = {
        full_name: p.full_name,
        avatar_url: p.avatar_url,
        gender: p.gender,
      };
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
  /**
   * EVERY comment row on the post, replies included — the unit the 30-comment
   * cap counts and the unit `posts.comment_count` stores. `comments.length`
   * cannot stand in for it: that array is top-level only, because replies load
   * lazily, so using it would let a post with 25 top-level comments and 10
   * replies keep offering a composer the database will refuse.
   */
  total: number;
}> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  const viewerId = userId;

  const [{ data: rows }, { count: total }] = await Promise.all([
    supabase
      .from("post_comments")
      .select("id, author_id, body, created_at, parent_id, like_count, reply_count")
      .eq("post_id", postId)
      .is("parent_id", null)
      .eq("hidden", false)
      .order("created_at", { ascending: true }),
    // Unfiltered by `hidden` and by `parent_id`: the cap counts ROWS, which is
    // what the database trigger counts too.
    supabase
      .from("post_comments")
      .select("id", { count: "exact", head: true })
      .eq("post_id", postId),
  ]);

  const { comments, authors } = await hydrateComments(
    supabase,
    (rows as Omit<FeedComment, "liked_by_me">[]) ?? [],
    viewerId
  );

  let viewerAvatar: string | null = null;
  if (userId) {
    const { data: me } = await supabase
      .from("profiles")
      .select("avatar_url, gender")
      .eq("id", userId)
      .single();
    viewerAvatar = resolveAvatarUrl(me?.avatar_url, me?.gender);
  }

  return { comments, authors, viewerAvatar, viewerId, total: total ?? 0 };
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
  gender: string | null;
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
    .select("id, username, full_name, avatar_url, gender")
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

  // Global backstop across ALL posts, unchanged. The per-post rules below are
  // stricter wherever they overlap; this only bounds feed-wide flooding.
  const allowed = await checkRateLimit("comment", 60, 60 * 60);
  if (!allowed) return { ok: false, error: "You're commenting too fast." };

  // Per-POST guards (anti-farming). Global limits stop a user burying the whole
  // feed; these stop them burying ONE post — which is what made comment Aura
  // farmable. Cooldown first: it is the cheapest rejection and, being checked
  // before the window bucket, a throttled user does not burn window slots too.
  const cooldown = await checkRateLimitResult(
    postScopedAction(COMMENT_LIMITS.perPostCooldown, postId),
    COMMENT_LIMITS.perPostCooldown.max,
    COMMENT_LIMITS.perPostCooldown.windowSeconds
  );
  if (cooldown.status === "limited")
    return {
      ok: false,
      error: COMMENT_LIMIT_MESSAGES.comment_cooldown,
    };
  if (cooldown.status === "error")
    return { ok: false, error: "Couldn't post that comment. Try again." };

  const postWindow = await checkRateLimitResult(
    postScopedAction(COMMENT_LIMITS.perPostWindow, postId),
    COMMENT_LIMITS.perPostWindow.max,
    COMMENT_LIMITS.perPostWindow.windowSeconds
  );
  if (postWindow.status === "limited")
    return {
      ok: false,
      error: COMMENT_LIMIT_MESSAGES.comment_hourly_limit,
    };
  if (postWindow.status === "error")
    return { ok: false, error: "Couldn't post that comment. Try again." };

  const restricted = await postingBlockReason();
  if (restricted) return { ok: false, error: restricted };

  // Duplicate + flood signals. `scoreContent` has always accepted these, but
  // nothing set them: they need DB context, so they are gathered here.
  const dupSince = new Date(
    Date.now() - COMMENT_LIMITS.duplicateWindowHours * 60 * 60 * 1000
  ).toISOString();
  const { data: recentOwn } = await supabase
    .from("post_comments")
    .select("body, created_at")
    .eq("post_id", postId)
    .eq("author_id", userId)
    .gte("created_at", dupSince)
    .order("created_at", { ascending: false })
    .limit(50);
  const recent = (recentOwn ?? []).map(
    (c: { body: string; created_at: string }) => ({
      body: mentionsToPlainText(c.body),
      createdAt: c.created_at,
    })
  );
  if (isDuplicateComment(visible, recent))
    return { ok: false, error: DUPLICATE_COMMENT_MESSAGE };

  const floodCutoff =
    Date.now() - COMMENT_LIMITS.perPostWindow.windowSeconds * 1000;
  const inWindow = recent.filter(
    (c) => new Date(c.createdAt).getTime() >= floodCutoff
  ).length;

  // Rule engine (Phase 9): block severe content; hold a risky comment (hidden
  // until a moderator restores it).
  const risk = scoreContent(visible, {
    isFlooding: isFloodingComments(inWindow),
  });
  if (risk.action === "block")
    return { ok: false, error: blockMessage(risk) };

  const storedBody = await sanitizeMentions(supabase, userId, text);
  // Mention tokens expand the stored body (mig 0095 widened the CHECK to 4000);
  // guard here so an extreme mention count returns a friendly message instead of
  // a raw constraint error.
  if (storedBody.length > 4000)
    return { ok: false, error: "Too many mentions in one comment." };

  // The two count-based caps, checked here for a friendly message. These are
  // ADVISORY: `enforce_comment_spam_limits()` (mig 0193) re-checks both under a
  // post-scoped advisory lock, so the answer below being stale — someone else
  // taking the last slot between this read and the insert — is caught by the
  // database and mapped to the same copy at the bottom of this function.
  const [{ count: totalComments }, { count: ownComments }] = await Promise.all([
    supabase
      .from("post_comments")
      .select("id", { count: "exact", head: true })
      .eq("post_id", postId),
    supabase
      .from("post_comments")
      .select("id", { count: "exact", head: true })
      .eq("post_id", postId)
      .eq("author_id", userId),
  ]);
  if (postCapExceeded(totalComments ?? 0))
    return { ok: false, error: COMMENT_LIMIT_MESSAGES.comment_post_full };
  if (userPostCapExceeded(ownComments ?? 0))
    return { ok: false, error: COMMENT_LIMIT_MESSAGES.comment_user_post_limit };

  const { error } = await supabase.from("post_comments").insert({
    post_id: postId,
    author_id: userId,
    body: storedBody,
    parent_id: parentId ?? null,
    risk_score: risk.score,
    hidden: risk.action === "hold",
  });
  // Never surface a raw PostgreSQL error: the database raises a stable token
  // and `commentLimitMessage` owns the wording.
  if (error) return { ok: false, error: commentLimitMessage(error.message) };

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
 *
 * Aura is NOT reconciled here: `reconcile_comment_aura()` (mig 0181) does it in
 * the same transaction as the delete, so the -2 lands exactly when this was the
 * commenter's last comment on the post — and never twice, however often this
 * action is retried or run concurrently.
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
