"use client";

import { memo, useRef, useState } from "react";
import Link from "next/link";
import {
  Heart,
  MessageCircle,
  Flag,
  VenetianMask,
  Share2,
  Bookmark,
  MoreHorizontal,
} from "lucide-react";
import { GlassSheet } from "@/components/ui";
import { cn } from "@/lib/utils";
import { toggleLike, reportPost } from "@/app/(student)/home/actions";
import { ShareSheet } from "@/components/feed/share-sheet";
import { timeAgo, absoluteTime } from "@/lib/time";
import { AppImage } from "@/components/ui/app-image";
import type { FeedPost } from "@/lib/feed/types";

const REPORT_REASONS = [
  "Harassment or hate",
  "Inappropriate content",
  "Spam or scam",
  "Misinformation",
  "Other",
];

function PostCardImpl({ post }: { post: FeedPost }) {
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likes, setLikes] = useState(post.like_count);
  const [reporting, setReporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [saved, setSaved] = useState(false);
  // Heart-burst overlay: bumping the key remounts the <Heart> and replays the
  // animation, so rapid double-taps each get their own burst.
  const [burstKey, setBurstKey] = useState(0);
  const lastTap = useRef(0);
  const anon = post.is_anonymous && !post.author_name;

  async function onLike() {
    const wasLiked = liked;
    const next = !wasLiked;
    // Optimistic update…
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    // …rolled back if the like didn't actually persist (P6-02).
    const res = await toggleLike(post.id, wasLiked);
    if (!res.ok) {
      setLiked(wasLiked);
      setLikes((n) => n + (next ? -1 : 1));
    }
  }

  /** Double-tap the post to like it (Instagram-style, UAT-003). Only ever likes
   *  — never unlikes — and always plays the heart burst, even if already liked. */
  async function likeOnly() {
    setBurstKey((k) => k + 1);
    if (liked) return; // already liked: animate only, don't toggle off
    setLiked(true);
    setLikes((n) => n + 1);
    const res = await toggleLike(post.id, false);
    if (!res.ok) {
      setLiked(false);
      setLikes((n) => n - 1);
    }
  }

  /**
   * Double-tap anywhere on the card (except interactive controls) to like it.
   * Taps that land on a link or button — the avatar/name, the like/comment/share
   * controls, the options menu — are left alone so they behave normally (e.g.
   * the avatar still opens the profile). A detected double-tap has its default
   * suppressed so it can never trigger navigation.
   */
  function onCardTap(e: React.MouseEvent) {
    const el = e.target as HTMLElement;
    if (el.closest("a, button, [role='button'], input, textarea, label")) {
      lastTap.current = 0;
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      e.preventDefault();
      likeOnly();
    } else {
      lastTap.current = now;
    }
  }

  return (
    <article
      onClick={onCardTap}
      className="relative touch-manipulation select-none border-b border-glass-border px-4 py-3.5"
    >
      <div className="flex items-center gap-2.5">
        {(() => {
          const inner = (
            <>
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card">
                {anon ? (
                  <VenetianMask className="h-5 w-5 text-fg-muted" aria-hidden />
                ) : post.author_avatar ? (
                  <AppImage
                    src={post.author_avatar}
                    alt={post.author_name ?? ""}
                    sizes="44px"
                  />
                ) : null}
              </div>
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-fg">
                  {anon ? "Anonymous" : (post.author_name ?? "Student")}
                </span>
                <span className="block text-[13px] text-fg-muted">
                  {!anon && post.author_department
                    ? `${post.author_department} · `
                    : ""}
                  <time
                    dateTime={post.created_at}
                    title={absoluteTime(post.created_at)}
                  >
                    {timeAgo(post.created_at)} ago
                  </time>
                </span>
              </span>
            </>
          );
          return !anon && post.author_id ? (
            <Link
              href={`/profile/${post.author_id}`}
              className="flex min-w-0 flex-1 items-center gap-2.5"
            >
              {inner}
            </Link>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2.5">{inner}</div>
          );
        })()}
        <button
          type="button"
          aria-label="Post options"
          onClick={() => setReporting(true)}
          className="shrink-0 text-fg-muted hover:text-fg"
        >
          <MoreHorizontal className="h-6 w-6" aria-hidden />
        </button>
      </div>

      {post.body && (
        <p className="mt-2.5 whitespace-pre-wrap text-[15px] leading-[22px] text-fg">
          {post.body}
        </p>
      )}
      {post.image_url && (
        <div className="relative mt-2.5 aspect-square w-full overflow-hidden rounded-xl">
          <AppImage
            src={post.image_url}
            alt="Post image"
            sizes="(max-width: 448px) 100vw, 448px"
            draggable={false}
          />
        </div>
      )}

      {/* Double-tap heart burst, centered over the card (UAT-003). */}
      {burstKey > 0 && (
        <span
          key={burstKey}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        >
          <Heart className="animate-like-burst h-24 w-24 fill-white text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]" />
        </span>
      )}

      <div className="mt-3 flex items-center gap-5 text-sm text-fg-muted">
        <button
          type="button"
          onClick={onLike}
          className={cn(
            "flex items-center gap-1.5 transition-all active:scale-90",
            liked ? "text-error" : "hover:text-fg"
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
          className="flex items-center gap-1.5 transition-all hover:text-fg active:scale-90"
        >
          <Share2 className="h-5 w-5" aria-hidden />
          Share
        </button>
        <button
          type="button"
          onClick={() => setSaved((s) => !s)}
          aria-label={saved ? "Remove bookmark" : "Bookmark post"}
          aria-pressed={saved}
          className={cn(
            "ml-auto transition-all active:scale-90",
            saved ? "text-accent" : "hover:text-fg"
          )}
        >
          <Bookmark className={cn("h-5 w-5", saved && "fill-current")} aria-hidden />
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
    </article>
  );
}

/**
 * Memoized so appending a feed page (P4-05) doesn't re-render already-mounted
 * cards: FeedList preserves each post object's identity across pages, so shallow
 * prop equality skips every existing PostCard on load-more.
 */
export const PostCard = memo(PostCardImpl);
