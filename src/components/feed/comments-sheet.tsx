"use client";

import { useEffect, useState } from "react";
import { GlassSheet } from "@/components/ui";
import { CommentThread, type Comment } from "@/components/feed/comment-thread";
import { AddComment } from "@/components/feed/add-comment";
import { fetchComments } from "@/app/(student)/home/actions";

type Authors = Record<string, { full_name: string | null; avatar_url: string | null }>;

/**
 * Half-screen, scrollable comment sheet (UAT-004). Opens in place over the feed
 * instead of navigating to /post/[id]. Loads the thread on open, then hands off
 * to the same realtime CommentThread + AddComment used on the full post page.
 */
export function CommentsSheet({
  postId,
  open,
  onClose,
}: {
  postId: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <GlassSheet open={open} onClose={onClose} label="Comments" className="h-[75vh]">
      {open && <CommentsSheetContent postId={postId} />}
    </GlassSheet>
  );
}

function CommentsSheetContent({ postId }: { postId: string }) {
  const [data, setData] = useState<{
    comments: Comment[];
    authors: Authors;
  } | null>(null);

  useEffect(() => {
    let active = true;
    fetchComments(postId).then((res) => {
      if (active) setData(res);
    });
    return () => {
      active = false;
    };
  }, [postId]);

  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-2 text-lg font-bold">Comments</h2>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
        {data === null ? (
          <p className="py-6 text-center text-sm text-fg-muted">Loading comments…</p>
        ) : data.comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">
            No comments yet. Be the first.
          </p>
        ) : (
          <CommentThread
            postId={postId}
            initialComments={data.comments}
            initialAuthors={data.authors}
          />
        )}
      </div>
      <div className="shrink-0 border-t border-glass-border">
        <AddComment postId={postId} />
      </div>
    </div>
  );
}
