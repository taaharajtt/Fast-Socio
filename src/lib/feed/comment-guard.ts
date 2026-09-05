// ===========================================================================
// Comment anti-spam guards — the pure half.
//
// The DB owns Aura correctness (mig 0181: one +2 per (post, commenter), fully
// reversed when that commenter's last comment on the post goes). This module
// owns the cheaper, user-facing half: stopping the flood before it is written.
//
// Server-only wiring lives in `addComment` (src/app/(student)/home/actions.ts);
// everything here is pure so the policy itself is testable without a database,
// exactly like `rate-limit-policy.ts`.
// ===========================================================================

import type { RateLimitPolicy } from "@/lib/rate-limit-policy";

/**
 * Per-POST comment limits. THE DATABASE IS AUTHORITATIVE — every number here
 * mirrors `enforce_comment_spam_limits()` (migration 0193), which runs BEFORE
 * INSERT on `post_comments` and therefore also binds a client that skips this
 * action and talks to PostgREST directly.
 *
 * These exist so the user gets a fast, friendly rejection instead of a database
 * error, and so the composer can be disabled before they type. If the two ever
 * disagree the database wins and the person sees the mapped message; a test
 * asserts the numbers match the migration.
 *
 * The previous version of this file had four mutually inconsistent numbers (15s
 * cooldown, 5 per 10 minutes, 60/hour in the action, 80/hour in the DB) and a
 * per-post cap deliberately switched off. There is now one set.
 */
export const COMMENT_LIMITS = {
  /** Rolling window: at most 5 comments by one user on one post per HOUR. */
  perPostWindow: { action: "commentPost", max: 5, windowSeconds: 3600 },
  /** Cooldown: one comment per user per post every 30 seconds. */
  perPostCooldown: { action: "commentCooldown", max: 1, windowSeconds: 30 },
  /** Duplicate normalized text by the same user on the same post is rejected. */
  duplicateWindowHours: 24,
  /** At most 10 currently-existing comments by one user on one post. */
  perUserPostCap: 10,
  /** At most 30 currently-existing comments on a post, across all users. */
  perPostCap: 30 as number | null,
} as const;

/** Bucket key for a per-post limiter. Post-scoped so buckets never collide. */
export function postScopedAction(
  policy: Pick<RateLimitPolicy, "action">,
  postId: string
): string {
  return `${policy.action}:${postId}`;
}

/**
 * Normalize comment text for duplicate detection.
 *
 * Aggressive on purpose — the spammer's cheapest evasion is punctuation, case
 * and whitespace noise ("nice!!", "NICE", "n i c e" is left alone; "Nice ! !"
 * is not). Mention tokens should already be flattened to plain text by the
 * caller so the same mention written two ways still collides.
 */
export function normalizeCommentText(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export type RecentComment = { body: string; createdAt: string | Date };

/**
 * Has this user already posted the same normalized text on this post inside the
 * duplicate window? `recent` is the caller's own recent comments on the post.
 */
export function isDuplicateComment(
  candidate: string,
  recent: readonly RecentComment[],
  now: Date = new Date(),
  windowHours: number = COMMENT_LIMITS.duplicateWindowHours
): boolean {
  const target = normalizeCommentText(candidate);
  if (!target) return false;
  const cutoff = now.getTime() - windowHours * 60 * 60 * 1000;
  return recent.some((c) => {
    const at = new Date(c.createdAt).getTime();
    if (!Number.isFinite(at) || at < cutoff) return false;
    return normalizeCommentText(c.body) === target;
  });
}

/**
 * Flood signal fed into the moderation rule engine's `isFlooding` context —
 * previously an input nothing ever set. True once the user is at or past half
 * their per-post window allowance, so a burst raises the risk score of the
 * content itself even when it stays under the hard limit.
 */
export function isFloodingComments(recentInWindow: number): boolean {
  return recentInWindow >= Math.ceil(COMMENT_LIMITS.perPostWindow.max / 2);
}

/**
 * Is this post closed to new comments?
 *
 * A shared cap IS a resource one bad actor can spend on everyone's behalf, and
 * that objection was why it stayed off. What makes it safe to switch on is the
 * company it now keeps: one person can reach at most 10 of the 30 (and only 5
 * of them within an hour), so no single account can close a thread by itself.
 *
 * `>=` on purpose, so a post that already holds more than 30 from before
 * migration 0193 reads as full rather than wrapping around. Nothing is deleted
 * to bring it down; it simply takes no new comments.
 */
export function postCapExceeded(totalComments: number): boolean {
  const cap = COMMENT_LIMITS.perPostCap;
  return cap !== null && totalComments >= cap;
}

/** Has this user used up their allowance of existing comments on this post? */
export function userPostCapExceeded(ownComments: number): boolean {
  return ownComments >= COMMENT_LIMITS.perUserPostCap;
}

// ---------------------------------------------------------------------------
// Database error mapping
// ---------------------------------------------------------------------------

/**
 * The tokens `enforce_comment_spam_limits()` raises, and what a person is told.
 *
 * The database raises a short, stable token rather than prose so the wording
 * lives in one place — here — and a raw PostgreSQL error can never reach a
 * student. Anything unrecognised falls back to a generic line rather than
 * leaking a message we did not write.
 */
export const COMMENT_LIMIT_MESSAGES: Record<string, string> = {
  comment_cooldown:
    "Please wait 30 seconds before commenting on this post again.",
  comment_hourly_limit:
    "You can only post 5 comments per hour on the same post.",
  comment_user_post_limit:
    "You've reached your limit of 10 comments on this post.",
  comment_post_full: "This post has reached its limit of 30 comments.",
  comment_author_mismatch: "Couldn't post that comment. Try again.",
};

export const GENERIC_COMMENT_ERROR = "Couldn't post that comment. Try again.";

/**
 * Map a database error message onto user-facing copy.
 *
 * Matches on the token appearing anywhere in the message because PostgREST
 * wraps it ("new row violates…", or the bare token depending on the path), and
 * the token is distinctive enough that a substring test is safe.
 */
export function commentLimitMessage(dbMessage: string | null | undefined): string {
  const haystack = (dbMessage ?? "").toLowerCase();
  for (const [token, message] of Object.entries(COMMENT_LIMIT_MESSAGES)) {
    if (haystack.includes(token)) return message;
  }
  return GENERIC_COMMENT_ERROR;
}

/** User-facing copy for the duplicate rejection. */
export const DUPLICATE_COMMENT_MESSAGE =
  "You've already posted that comment here.";
