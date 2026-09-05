// ===========================================================================
// A faithful model of the comment-Aura ledger rules.
//
// `public.award_comment_aura()` / `public.reconcile_comment_aura()` and the
// BEFORE DELETE trigger on `posts` (migrations 0181 + 0187) are AUTHORITATIVE —
// the invariant is enforced in the database, not here. This is the same state machine expressed as a pure function so the
// rules ("+2 once per distinct commenter per post, reversed when that
// commenter's last comment on the post goes") can be tested without a database,
// the way `createBurstWindow` mirrors the SQL limiter. Keep the two in step.
// ===========================================================================

export const COMMENT_AURA_DELTA = 2;

export type CommentRef = {
  id: string;
  postId: string;
  commenterId: string;
};

export type AuraEntry = {
  userId: string;
  delta: number;
  reason: "comment_received";
  postId: string;
  commenterId: string;
  reversal?: true;
};

export type CommentAuraLedger = {
  /** AFTER INSERT on post_comments. Idempotent per (post, commenter). */
  addComment(comment: CommentRef): AuraEntry[];
  /** AFTER DELETE on post_comments. Safe to call twice for the same id. */
  deleteComment(commentId: string): AuraEntry[];
  /**
   * DELETE of a post. Every still-active comment reward it generated is
   * reversed — the author does not keep Aura for comments that no longer
   * exist. 0181 got this wrong (its reconcile saw the post already gone and
   * deliberately did nothing); 0187's BEFORE DELETE trigger on `posts` reverses
   * each pair while the comments are still readable.
   */
  deletePost(postId: string): AuraEntry[];
  /** Net Aura currently held by `userId` from comment rewards. */
  balance(userId: string): number;
  /** Every ledger entry written so far, in order. */
  entries(): readonly AuraEntry[];
  /** Grant records outstanding — the (post, commenter) idempotency keys. */
  grantCount(): number;
};

/**
 * `postAuthors` maps postId → author id, mirroring `posts.author_id`.
 */
export function createCommentAuraLedger(
  postAuthors: Readonly<Record<string, string>>
): CommentAuraLedger {
  const comments = new Map<string, CommentRef>();
  /** `${postId} ${commenterId}` → author paid. Mirrors the table's PK. */
  const grants = new Map<string, string>();
  const ledger: AuraEntry[] = [];

  const key = (postId: string, commenterId: string) =>
    `${postId} ${commenterId}`;

  function write(entry: AuraEntry): AuraEntry {
    ledger.push(entry);
    return entry;
  }

  return {
    addComment(comment) {
      const author = postAuthors[comment.postId];
      // A comment on a missing post, or on your own post, earns nothing.
      if (!author || author === comment.commenterId) {
        comments.set(comment.id, comment);
        return [];
      }
      comments.set(comment.id, comment);

      const k = key(comment.postId, comment.commenterId);
      // The PK conflict: a second comment (or a concurrent duplicate insert)
      // finds the grant already there and pays nothing.
      if (grants.has(k)) return [];
      grants.set(k, author);

      return [
        write({
          userId: author,
          delta: COMMENT_AURA_DELTA,
          reason: "comment_received",
          postId: comment.postId,
          commenterId: comment.commenterId,
        }),
      ];
    },

    deleteComment(commentId) {
      const comment = comments.get(commentId);
      // Repeated / retried delete: the row is already gone, nothing to do.
      if (!comment) return [];
      comments.delete(commentId);

      // Another comment by the same person on the same post still stands.
      for (const c of comments.values()) {
        if (c.postId === comment.postId && c.commenterId === comment.commenterId)
          return [];
      }

      const k = key(comment.postId, comment.commenterId);
      const author = grants.get(k);
      if (author === undefined) return [];
      grants.delete(k);

      return [
        write({
          userId: author,
          delta: -COMMENT_AURA_DELTA,
          reason: "comment_received",
          postId: comment.postId,
          commenterId: comment.commenterId,
          reversal: true,
        }),
      ];
    },

    deletePost(postId) {
      const written: AuraEntry[] = [];
      // Reverse BEFORE dropping the comments, mirroring the trigger's timing:
      // the pairs to debit are read from the comments that still exist.
      for (const k of [...grants.keys()]) {
        if (!k.startsWith(`${postId} `)) continue;
        const author = grants.get(k)!;
        const commenterId = k.slice(postId.length + 1);
        grants.delete(k);
        written.push(
          write({
            userId: author,
            delta: -COMMENT_AURA_DELTA,
            reason: "comment_received",
            postId,
            commenterId,
            reversal: true,
          })
        );
      }
      for (const [id, c] of [...comments]) {
        if (c.postId === postId) comments.delete(id);
      }
      return written;
    },

    balance(userId) {
      return ledger
        .filter((e) => e.userId === userId)
        .reduce((sum, e) => sum + e.delta, 0);
    },

    entries() {
      return ledger;
    },

    grantCount() {
      return grants.size;
    },
  };
}
