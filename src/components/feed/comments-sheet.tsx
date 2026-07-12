"use client";

import { useEffect, useState } from "react";
import { GlassSheet } from "@/components/ui";
import { CommentsSection } from "@/components/feed/comments-section";
import type { Author } from "@/components/feed/comment-thread";
import { fetchComments, type FeedComment } from "@/app/(student)/home/actions";

/**
 * Half-screen, scrollable comment sheet (UAT-004) styled to match Instagram:
 * slides up from the bottom over everything, stops around mid-screen, with a
 * centered "Comments" header, an edge-to-edge scrollable thread (with one-level
 * replies + per-comment likes), a quick-emoji reaction strip, and an avatar +
 * pill composer pinned to the bottom. Opens in place over the feed instead of
 * navigating to /post/[id].
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
    comments: FeedComment[];
    authors: Record<string, Author>;
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

      {data === null ? (
        <div className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="py-6 text-center text-sm text-fg-muted">
            Loading comments…
          </p>
        </div>
      ) : (
        <CommentsSection
          variant="sheet"
          postId={postId}
          initialComments={data.comments}
          initialAuthors={data.authors}
          viewerAvatar={data.viewerAvatar}
        />
      )}
    </div>
  );
}
