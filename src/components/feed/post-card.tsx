"use client";

import { memo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Heart,
  MessageCircle,
  Flag,
  VenetianMask,
  Share2,
  Trash2,
  Pencil,
  MoreHorizontal,
} from "lucide-react";
import { GlassSheet, VerifiedBadge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { renderLinkifiedText } from "@/lib/linkify";
import {
  toggleLike,
  reportPost,
  deletePost,
  editPost,
} from "@/app/(student)/home/actions";
import { ShareSheet } from "@/components/feed/share-sheet";
import { CommentsSheet } from "@/components/feed/comments-sheet";
import { PostPoll } from "@/components/feed/post-poll";
import { timeAgo, absoluteTime } from "@/lib/time";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import { ASPECT_RATIOS, nearestAspectRatio } from "@/lib/crop";
import type { FeedPost } from "@/lib/feed/types";

const REPORT_REASONS = [
  "Harassment or hate",
  "Inappropriate content",
  "Spam or scam",
  "Misinformation",
  "Other",
];

function PostCardImpl({
  post,
  currentUserId,
  onDeleted,
  priority = false,
}: {
  post: FeedPost;
  /** Viewer's id — used to decide whether the options menu offers Delete (UAT-003). */
  currentUserId?: string | null;
  /** Called after the post is deleted so a list can drop it without a full reload. */
  onDeleted?: (postId: string) => void;
  /** Above-the-fold placement (perf pass) — the very first card in a feed. */
  priority?: boolean;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likes, setLikes] = useState(post.like_count);
  const [comments, setComments] = useState(post.comment_count);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [editingOpen, setEditingOpen] = useState(false);
  const [editDraft, setEditDraft] = useState(post.body ?? "");
  const [body, setBody] = useState(post.body);
  const [editedAt, setEditedAt] = useState(post.edited_at ?? null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Heart-burst overlay: bumping the key remounts the <Heart> and replays the
  // animation, so rapid double-taps each get their own burst.
  const [burstKey, setBurstKey] = useState(0);
  // Cropping always exports exactly one of the 3 standard ratios; snap the
  // measured natural size to the nearest so a rounding pixel can't wobble it.
  const [imageAspect, setImageAspect] = useState<number>(ASPECT_RATIOS.square);
  const lastTap = useRef(0);
  // UAT-001: an anonymous post reads as Anonymous for everyone — including its
  // own author — so a poster never sees their own name/avatar on it.
  const anon = post.is_anonymous;
  const isMine = !!currentUserId && post.author_id === currentUserId;

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

  /** Double-tap the post to like it (Instagram-style). Only ever likes — never
   *  unlikes — and always plays the heart burst, even if already liked. */
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

  async function onDelete() {
    setDeleting(true);
    const res = await deletePost(post.id);
    if (!res.ok) {
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }
    setOptionsOpen(false);
    setDeleted(true);
    if (onDeleted) onDeleted(post.id);
    else router.refresh();
  }

  async function onSaveEdit() {
    const next = editDraft.trim();
    const prevBody = body;
    const prevEditedAt = editedAt;
    setSaving(true);
    setEditError(null);
    // Optimistic: the card reflects the edit right away, reverted on failure.
    setBody(next);
    setEditedAt(new Date().toISOString());
    const res = await editPost(post.id, next);
    setSaving(false);
    if (!res.ok) {
      setBody(prevBody);
      setEditedAt(prevEditedAt);
      setEditError(res.error);
      return;
    }
    setEditingOpen(false);
  }

  function onCancelEdit() {
    setEditDraft(body ?? "");
    setEditError(null);
    setEditingOpen(false);
  }

  // Once deleted, collapse the card in place for immediate feedback.
  if (deleted) return null;

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
                ) : resolveAvatarUrl(post.author_avatar, post.author_gender) ? (
                  <AppImage
                    src={resolveAvatarUrl(post.author_avatar, post.author_gender)!}
                    alt={post.author_name ?? ""}
                    sizes="44px"
                    priority={priority}
                  />
                ) : null}
              </div>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-base font-semibold text-fg">
                  <span className="truncate">
                    {anon ? "Anonymous" : (post.author_name ?? "Student")}
                  </span>
                  {!anon && post.author_verified && <VerifiedBadge />}
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
          onClick={() => {
            setConfirmDelete(false);
            setOptionsOpen(true);
          }}
          className="-m-2 shrink-0 p-2 text-fg-muted hover:text-fg"
        >
          <MoreHorizontal className="h-6 w-6" aria-hidden />
        </button>
      </div>

      {body && (
        <p className="mt-2.5 whitespace-pre-wrap text-[15px] leading-[22px] text-fg">
          {renderLinkifiedText(body)}
        </p>
      )}
      {post.image_url && (
        <div
          className="relative mt-2.5 w-full overflow-hidden rounded-xl"
          style={{ aspectRatio: imageAspect }}
        >
          <AppImage
            src={post.image_url}
            alt="Post image"
            sizes="(max-width: 448px) 100vw, 448px"
            draggable={false}
            priority={priority}
            onNaturalSize={(size) =>
              setImageAspect(nearestAspectRatio(size.width / size.height))
            }
          />
        </div>
      )}
      {post.poll_id && <PostPoll pollId={post.poll_id} />}

      {/* Double-tap heart burst, centered over the card. */}
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
        {/* -m-2 p-2 grows each hit area to ~44px without moving a pixel. */}
        <button
          type="button"
          onClick={onLike}
          className={cn(
            "-m-2 flex items-center gap-1.5 p-2 transition-all active:scale-90",
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
        {/* UAT-004: open the half-screen comment sheet instead of navigating. */}
        <button
          type="button"
          onClick={() => setCommenting(true)}
          aria-label="Comments"
          className="-m-2 flex items-center gap-1.5 p-2 transition-all hover:text-fg active:scale-90"
        >
          <MessageCircle className="h-5 w-5" aria-hidden />
          {comments}
        </button>
        <button
          type="button"
          onClick={() => setSharing(true)}
          aria-label="Share post"
          className="-m-2 flex items-center gap-1.5 p-2 transition-all hover:text-fg active:scale-90"
        >
          <Share2 className="h-5 w-5" aria-hidden />
          Share
        </button>
        {editedAt && (
          <span className="ml-auto inline-flex shrink-0 items-center rounded-full bg-fg-muted/10 px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">
            edited
          </span>
        )}
      </div>

      <ShareSheet
        postId={post.id}
        open={sharing}
        onClose={() => setSharing(false)}
      />

      <CommentsSheet
        postId={post.id}
        open={commenting}
        onClose={() => setCommenting(false)}
        // Bump the visible count in place. The old close handler called
        // router.refresh(), which re-ran the entire layout + page on the server
        // (seconds of work) without even updating this card's frozen count.
        onCommentAdded={() => setComments((c) => c + 1)}
      />

      <GlassSheet
        open={editingOpen}
        onClose={onCancelEdit}
        label="Edit post"
      >
        <div className="space-y-3">
          <h3 className="text-lg font-bold">Edit post</h3>
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={5}
            maxLength={2000}
            autoFocus
            className="glass w-full resize-none rounded-[var(--radius-sm)] px-4 py-3 text-[15px] text-fg outline-none"
            placeholder="Write something…"
          />
          {editError && <p className="text-sm text-error">{editError}</p>}
          <button
            type="button"
            disabled={saving}
            onClick={onSaveEdit}
            className="w-full rounded-[var(--radius-sm)] bg-aura px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onCancelEdit}
            className="glass w-full rounded-[var(--radius-sm)] px-4 py-3 text-sm text-fg"
          >
            Cancel
          </button>
        </div>
      </GlassSheet>

      <GlassSheet
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        label="Post options"
      >
        <div className="space-y-3">
          {isMine ? (
            confirmDelete ? (
              <>
                <div className="flex items-center gap-2">
                  <Trash2 className="h-5 w-5 text-error" aria-hidden />
                  <h3 className="text-lg font-bold">Delete this post?</h3>
                </div>
                <p className="text-sm text-fg-muted">
                  This can&rsquo;t be undone. Likes and comments will be removed too.
                </p>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={onDelete}
                  className="w-full rounded-[var(--radius-sm)] bg-error px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {deleting ? "Deleting…" : "Delete post"}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                  className="glass w-full rounded-[var(--radius-sm)] px-4 py-3 text-sm text-fg"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold">Post options</h3>
                {!post.poll_id && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditDraft(body ?? "");
                      setEditError(null);
                      setOptionsOpen(false);
                      setEditingOpen(true);
                    }}
                    className="glass flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm font-medium text-fg"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    Edit post
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="glass flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm font-medium text-error"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete post
                </button>
              </>
            )
          ) : (
            <>
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
                    setOptionsOpen(false);
                  }}
                  className="glass flex w-full items-center rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-fg"
                >
                  {r}
                </button>
              ))}
            </>
          )}
        </div>
      </GlassSheet>
    </article>
  );
}

/**
 * Memoized so appending a feed page doesn't re-render already-mounted cards.
 */
export const PostCard = memo(PostCardImpl);
