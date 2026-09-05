"use client";

import { useRef, useState } from "react";
import { MessageSquareOff } from "lucide-react";
import {
  CommentThread,
  type Author,
  type CommentThreadHandle,
  type ReplyTarget,
} from "@/components/feed/comment-thread";
import { AddComment } from "@/components/feed/add-comment";
import type { FeedComment } from "@/app/(student)/home/actions";
import { useHashTarget } from "@/lib/use-hash-target";
import { COMMENT_LIMITS, postCapExceeded } from "@/lib/feed/comment-guard";

/**
 * Owns the reply target shared between the thread and the composer, so tapping
 * "Reply" on any comment addresses the single bottom composer (Instagram model).
 * After a reply posts, it asks the thread to expand that comment so the new
 * reply is visible. Two layouts:
 *   - "sheet": edge-to-edge scroll area + a pinned composer with avatar and the
 *     quick-reaction strip (the in-feed comment sheet).
 *   - "page": a plain flowing thread + a simple composer (the /post/[id] page).
 */
export function CommentsSection({
  postId,
  initialComments,
  initialAuthors,
  viewerAvatar,
  viewerId,
  variant,
  totalComments,
  onCommentAdded,
}: {
  postId: string;
  initialComments: FeedComment[];
  initialAuthors: Record<string, Author>;
  viewerAvatar?: string | null;
  /** Signed-in viewer's id — a comment's own author gets a delete option. */
  viewerId?: string | null;
  variant: "sheet" | "page";
  /** Every comment row on the post, replies included. See fetchComments. */
  totalComments?: number;
  /** Fired after any comment or reply posts — lets the card bump its count. */
  onCommentAdded?: () => void;
}) {
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const threadRef = useRef<CommentThreadHandle>(null);
  const isSheet = variant === "sheet";

  // Live total INCLUDING replies — the same unit the post's comment_count uses
  // and the same unit the 30-comment cap counts.
  const [total, setTotal] = useState(totalComments ?? initialComments.length);
  // Set when the database rejects an insert because the post filled up while
  // this page was open. Sticky: once we know it is full, do not offer the
  // composer again until the page is reloaded with fresh data.
  const [full, setFull] = useState(false);
  const isFull = full || postCapExceeded(total);

  // Jump-and-highlight a comment/reply linked to by notification deep links
  // ("/post/<id>#comment-<commentId>").
  useHashTarget();

  return (
    <div className={isSheet ? "flex min-h-0 flex-1 flex-col" : "flex flex-1 flex-col"}>
      <div
        // Inside the sheet this is the scroll area: it must keep vertical
        // panning even though the sheet panel claims touch-action for dragging.
        data-sheet-scroll={isSheet ? "" : undefined}
        className={
          isSheet
            ? "-mx-5 min-h-0 flex-1 overflow-y-auto px-5 py-4"
            : "flex-1 py-2"
        }
      >
        <CommentThread
          ref={threadRef}
          postId={postId}
          initialComments={initialComments}
          initialAuthors={initialAuthors}
          viewerId={viewerId}
          onReply={setReplyTo}
        />
      </div>

      <div
        className={
          isSheet ? "-mx-5 shrink-0 border-t border-glass-border px-5" : ""
        }
      >
        {isFull ? (
          // Replaces the composer entirely, which is also what stops replies:
          // there is one composer, and "Reply" only addresses it.
          <p
            role="status"
            className="flex items-center justify-center gap-2 py-4 text-center text-[13px] text-fg-muted"
          >
            <MessageSquareOff className="h-4 w-4 shrink-0" aria-hidden />
            This discussion has reached its limit of{" "}
            {COMMENT_LIMITS.perPostCap} comments.
          </p>
        ) : (
          <AddComment
            postId={postId}
            avatarUrl={isSheet ? (viewerAvatar ?? null) : undefined}
            showQuickEmojis={isSheet}
            replyingTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onPostFull={() => setFull(true)}
            onSubmitted={(parentId) => {
              setReplyTo(null);
              setTotal((n) => n + 1);
              if (parentId) threadRef.current?.expandReplies(parentId);
              onCommentAdded?.();
            }}
          />
        )}
      </div>
    </div>
  );
}
