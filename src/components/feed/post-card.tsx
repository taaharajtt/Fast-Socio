"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, MessageCircle, Flag, VenetianMask, Share2 } from "lucide-react";
import { GlassCard, GlassSheet } from "@/components/ui";
import { cn } from "@/lib/utils";
import { toggleLike, reportPost } from "@/app/(student)/home/actions";
import { ShareSheet } from "@/components/feed/share-sheet";
import type { FeedPost } from "@/lib/feed/types";

const REPORT_REASONS = [
  "Harassment or hate",
  "Inappropriate content",
  "Spam or scam",
  "Misinformation",
  "Other",
];

export function PostCard({ post }: { post: FeedPost }) {
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likes, setLikes] = useState(post.like_count);
  const [reporting, setReporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const anon = post.is_anonymous && !post.author_name;

  function onLike() {
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    toggleLike(post.id, liked); // fire-and-forget; RLS enforces ownership
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-3">
        {(() => {
          const inner = (
            <>
              <div className="glass flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full">
                {anon ? (
                  <VenetianMask className="h-5 w-5 text-fg-muted" aria-hidden />
                ) : post.author_avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.author_avatar}
                    alt={post.author_name ?? ""}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <span className="truncate font-semibold">
                {anon ? "Anonymous" : (post.author_name ?? "Student")}
              </span>
            </>
          );
          return !anon && post.author_id ? (
            <Link
              href={`/profile/${post.author_id}`}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              {inner}
            </Link>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-3">{inner}</div>
          );
        })()}
        <button
          type="button"
          aria-label="Report post"
          onClick={() => setReporting(true)}
          className="text-fg-muted hover:text-fg"
        >
          <Flag className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {post.body && <p className="mt-3 whitespace-pre-wrap text-[15px]">{post.body}</p>}
      {post.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.image_url}
          alt="Post image"
          className="mt-3 max-h-96 w-full rounded-2xl object-cover"
        />
      )}

      <div className="mt-4 flex items-center gap-5 text-sm text-fg-muted">
        <button
          type="button"
          onClick={onLike}
          className={cn(
            "flex items-center gap-1.5 transition-colors",
            liked ? "text-aura" : "hover:text-fg"
          )}
          aria-pressed={liked}
        >
          <Heart
            className={cn("h-5 w-5", liked && "fill-current")}
            aria-hidden
          />
          {likes}
        </button>
        <Link
          href={`/post/${post.id}`}
          className="flex items-center gap-1.5 hover:text-fg"
        >
          <MessageCircle className="h-5 w-5" aria-hidden />
          {post.comment_count}
        </Link>
        <button
          type="button"
          onClick={() => setSharing(true)}
          aria-label="Share post"
          className="ml-auto flex items-center gap-1.5 hover:text-fg"
        >
          <Share2 className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <ShareSheet
        postId={post.id}
        open={sharing}
        onClose={() => setSharing(false)}
      />

      <GlassSheet open={reporting} onClose={() => setReporting(false)}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-error" aria-hidden />
            <h3 className="text-lg font-bold">Report post</h3>
          </div>
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={async () => {
                await reportPost(post.id, r);
                setReporting(false);
              }}
              className="glass flex w-full items-center rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-fg"
            >
              {r}
            </button>
          ))}
        </div>
      </GlassSheet>
    </GlassCard>
  );
}
