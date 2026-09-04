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
 * Per-POST comment limits.
 *
 * Both buckets are keyed by post, not just by user: a person may comment freely
 * across the feed, they just cannot bury ONE post. The existing global
 * `comment` bucket (60/hour) is unchanged and still applies on top.
 *
 * `perPostCap` is the seat left empty on purpose. A global "max 25 comments on
 * this post, from anyone" cap is NOT enforced yet — see the note in
 * `postCapExceeded` for why the per-commenter reward limit is the safer control
 * to ship first. When the product does want a cap, set a number here and the
 * single call site in `addComment` starts enforcing it.
 */
export const COMMENT_LIMITS = {
  /** Rolling window: at most 5 comments by one user on one post per 10 min. */
  perPostWindow: { action: "commentPost", max: 5, windowSeconds: 600 },
  /** Cooldown: one comment per user per post every 15 seconds. */
  perPostCooldown: { action: "commentCooldown", max: 1, windowSeconds: 15 },
  /** Duplicate normalized text by the same user on the same post is rejected. */
  duplicateWindowHours: 24,
  /** Not enforced yet. `null` = no global per-post cap. */
  perPostCap: null as number | null,
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
 * Global per-post cap check. Always false today (`perPostCap` is null).
 *
 * WHY IT IS NOT ON. A shared cap is a resource one bad actor can spend on
 * everybody's behalf: 25 junk comments from the first spammer and the thread is
 * closed to every legitimate reply. The per-commenter reward limit removes the
 * *incentive* instead — the 26th comment simply earns nothing — so abuse costs
 * the abuser and never costs the discussion.
 */
export function postCapExceeded(totalComments: number): boolean {
  const cap = COMMENT_LIMITS.perPostCap;
  return cap !== null && totalComments >= cap;
}

/** User-facing copy for the duplicate rejection. */
export const DUPLICATE_COMMENT_MESSAGE =
  "You've already posted that comment here.";
