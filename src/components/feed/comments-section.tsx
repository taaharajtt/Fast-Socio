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
  variant,
}: {
  postId: string;
  initialComments: FeedComment[];
  initialAuthors: Record<string, Author>;
  viewerAvatar?: string | null;
  variant: "sheet" | "page";
}) {
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const threadRef = useRef<CommentThreadHandle>(null);
  const isSheet = variant === "sheet";

  return (
    <div className={isSheet ? "flex min-h-0 flex-1 flex-col" : "flex flex-1 flex-col"}>
      <div
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
          }}
        />
      </div>
    </div>
  );
}
