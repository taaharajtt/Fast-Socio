"use client";

import { useEffect, useState } from "react";
import { GlassSheet } from "@/components/ui";
import { CommentThread, type Comment } from "@/components/feed/comment-thread";
import { AddComment } from "@/components/feed/add-comment";
import { fetchComments } from "@/app/(student)/home/actions";

type Authors = Record<string, { full_name: string | null; avatar_url: string | null }>;

/**
 * Half-screen, scrollable comment sheet (UAT-004) styled to match Instagram:
 * slides up from the bottom over everything, stops around mid-screen, with a
 * centered "Comments" header, an edge-to-edge scrollable thread, a quick-emoji
 * reaction strip, and an avatar + pill composer pinned to the bottom. Opens in
 * place over the feed instead of navigating to /post/[id].
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
    <GlassSheet
      open={open}
      onClose={onClose}
      label="Comments"
      className="flex h-[75vh] flex-col"
    >
      {open && <CommentsSheetContent postId={postId} />}
    </GlassSheet>
  );
}

function CommentsSheetContent({ postId }: { postId: string }) {
  const [data, setData] = useState<{
    comments: Comment[];
    authors: Authors;
    viewerAvatar: string | null;
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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Centered header with a full-width hairline (IG comment sheet). */}
      <h2 className="-mx-5 shrink-0 border-b border-glass-border px-5 pb-3 text-center text-base font-bold text-fg">
        Comments
      </h2>

      {/* Scrollable thread — edge to edge, scrolls independently of the sheet. */}
      <div className="-mx-5 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {data === null ? (
          <p className="py-6 text-center text-sm text-fg-muted">Loading comments…</p>
        ) : data.comments.length === 0 ? (
          <p className="py-10 text-center text-sm text-fg-muted">
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

      {/* Composer pinned to the bottom, above a full-width divider. */}
      <div className="-mx-5 shrink-0 border-t border-glass-border px-5">
        <AddComment
          postId={postId}
          avatarUrl={data?.viewerAvatar ?? null}
          showQuickEmojis
        />
      </div>
    </div>
  );
}
