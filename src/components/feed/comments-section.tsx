"use client";

import { useRef, useState } from "react";
import {
  CommentThread,
  type Author,
  type CommentThreadHandle,
  type ReplyTarget,
} from "@/components/feed/comment-thread";
import { AddComment } from "@/components/feed/add-comment";
import type { FeedComment } from "@/app/(student)/home/actions";

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
  onCommentAdded,
}: {
  postId: string;
  initialComments: FeedComment[];
  initialAuthors: Record<string, Author>;
  viewerAvatar?: string | null;
  /** Signed-in viewer's id — a comment's own author gets a delete option. */
  viewerId?: string | null;
  variant: "sheet" | "page";
  /** Fired after any comment or reply posts — lets the card bump its count. */
  onCommentAdded?: () => void;
}) {
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const threadRef = useRef<CommentThreadHandle>(null);
  const isSheet = variant === "sheet";

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
        <AddComment
          postId={postId}
          avatarUrl={isSheet ? (viewerAvatar ?? null) : undefined}
          showQuickEmojis={isSheet}
          replyingTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSubmitted={(parentId) => {
            setReplyTo(null);
            if (parentId) threadRef.current?.expandReplies(parentId);
            onCommentAdded?.();
          }}
        />
      </div>
    </div>
  );
}
