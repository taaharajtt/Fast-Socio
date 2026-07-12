"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Heart, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import {
  fetchReplies,
  toggleCommentLike,
  type CommentAuthor,
  type FeedComment,
} from "@/app/(student)/home/actions";

export type Comment = FeedComment;
export type Author = CommentAuthor;

/** Reply target the composer is currently addressed to. */
export type ReplyTarget = { parentId: string; name: string };

/** Imperative handle so the composer can expand a thread after posting a reply. */
export type CommentThreadHandle = { expandReplies: (parentId: string) => void };

type ReplyState = {
  open: boolean;
  loading: boolean;
  loaded: boolean;
  items: FeedComment[];
};

/**
 * Instagram-style comment thread. Seeds from server-rendered TOP-LEVEL comments,
 * then subscribes to post_comments INSERTs for this post_id. Incoming rows are
 * routed by parent_id: top-level rows append to the list; replies bump their
 * parent's reply_count and, when that thread is expanded, append to it. Replies
 * are otherwise collapsed under a "View replies" toggle and lazy-loaded. Each
 * comment/reply carries its own like button with optimistic count updates.
 */
export const CommentThread = forwardRef<
  CommentThreadHandle,
  {
    postId: string;
    initialComments: FeedComment[];
    initialAuthors: Record<string, Author>;
    /** Start a reply — bubbled up so the shared composer can address it. */
    onReply: (target: ReplyTarget) => void;
  }
>(function CommentThread({ postId, initialComments, initialAuthors, onReply }, ref) {
  const [comments, setComments] = useState<FeedComment[]>(initialComments);
  const [authors, setAuthors] =
    useState<Record<string, Author>>(initialAuthors);
  const [replies, setReplies] = useState<Record<string, ReplyState>>({});
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  // Resolve an unknown commenter's profile lazily and merge it in.
  function ensureAuthor(id: string) {
    setAuthors((prev) => {
      if (prev[id]) return prev;
      createClient()
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", id)
        .single()
        .then(({ data }) => {
          if (data) setAuthors((s) => ({ ...s, [id]: data }));
        });
      return prev;
    });
  }

  // Load a comment's replies (once) and merge author profiles.
  async function loadReplies(parentId: string) {
    setReplies((prev) => ({
      ...prev,
      [parentId]: {
        open: true,
        loading: true,
        loaded: prev[parentId]?.loaded ?? false,
        items: prev[parentId]?.items ?? [],
      },
    }));
    const { replies: rows, authors: replyAuthors } = await fetchReplies(parentId);
    setAuthors((prev) => ({ ...replyAuthors, ...prev }));
    setReplies((prev) => {
      // Merge with anything realtime already delivered (dedup by id).
      const seen = new Set(rows.map((r) => r.id));
      const extra = (prev[parentId]?.items ?? []).filter((r) => !seen.has(r.id));
      return {
        ...prev,
        [parentId]: {
          open: true,
          loading: false,
          loaded: true,
          items: [...rows, ...extra].sort(
            (a, b) => +new Date(a.created_at) - +new Date(b.created_at)
          ),
        },
      };
    });
  }

  function toggleReplies(parentId: string) {
    const state = replies[parentId];
    if (state?.open) {
      setReplies((prev) => ({ ...prev, [parentId]: { ...prev[parentId], open: false } }));
    } else if (state?.loaded) {
      setReplies((prev) => ({ ...prev, [parentId]: { ...prev[parentId], open: true } }));
    } else {
      loadReplies(parentId);
    }
  }

  // Expand a thread after the viewer posts a reply into it (their row arrives
  // over realtime / the fresh load), so it becomes visible immediately.
  useImperativeHandle(ref, () => ({
    expandReplies: (parentId: string) => {
      const state = replies[parentId];
      if (state?.loaded) {
        // Re-load so the just-posted reply is included even if it landed before
        // the realtime echo.
        loadReplies(parentId);
      } else if (!state?.loading) {
        loadReplies(parentId);
      }
    },
  }));

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) supabase.realtime.setAuth(session.access_token);

      const channel = supabase
        .channel(`post-comments:${postId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "post_comments",
            filter: `post_id=eq.${postId}`,
          },
          (payload) => {
            const c = payload.new as FeedComment & { hidden?: boolean };
            if (c.hidden) return; // held-for-review rows are not shown live
            ensureAuthor(c.author_id);

            if (c.parent_id) {
              // A reply: bump the parent's count, and append if that thread is
              // already loaded (dedup by id).
              setComments((prev) =>
                prev.map((x) =>
                  x.id === c.parent_id
                    ? { ...x, reply_count: x.reply_count + 1 }
                    : x
                )
              );
              setReplies((prev) => {
                const st = prev[c.parent_id!];
                if (!st?.loaded || st.items.some((r) => r.id === c.id)) return prev;
                return {
                  ...prev,
                  [c.parent_id!]: { ...st, items: [...st.items, c] },
                };
              });
            } else {
              setComments((prev) =>
                prev.some((x) => x.id === c.id) ? prev : [...prev, c]
              );
            }
          }
        )
        .subscribe();

      channelRef.current = channel;
    })();

    return () => {
      if (channelRef.current) createClient().removeChannel(channelRef.current);
    };
  }, [postId]);

  if (comments.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-fg-muted">
        No comments yet. Be the first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {comments.map((c) => {
        const state = replies[c.id];
        return (
          <div key={c.id}>
            <CommentRow
              comment={c}
              author={authors[c.author_id]}
              onReply={() =>
                onReply({
                  parentId: c.id,
                  name: authors[c.author_id]?.full_name ?? "Student",
                })
              }
            />

            {c.reply_count > 0 && (
              <button
                type="button"
                onClick={() => toggleReplies(c.id)}
                className="ml-12 mt-1.5 flex items-center gap-2 text-[13px] font-semibold text-fg-muted transition-colors hover:text-fg"
              >
                <span className="h-px w-6 bg-glass-border" aria-hidden />
                {state?.open
                  ? "Hide replies"
                  : `View ${c.reply_count} ${c.reply_count === 1 ? "reply" : "replies"}`}
                {state?.loading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                )}
              </button>
            )}

            {state?.open && state.items.length > 0 && (
              <div className="mt-3 space-y-3 pl-12">
                {state.items.map((r) => (
                  <CommentRow
                    key={r.id}
                    comment={r}
                    author={authors[r.author_id]}
                    isReply
                    onReply={() =>
                      // A reply to a reply still attaches to the top-level
                      // parent (one level deep) but addresses that user.
                      onReply({
                        parentId: c.id,
                        name: authors[r.author_id]?.full_name ?? "Student",
                      })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

/**
 * A single comment or reply: avatar, name, time, body, a like heart with an
 * optimistic count, and a Reply affordance. Replies render at a smaller avatar.
 */
function CommentRow({
  comment,
  author,
  isReply = false,
  onReply,
}: {
  comment: FeedComment;
  author?: Author;
  isReply?: boolean;
  onReply: () => void;
}) {
  const [liked, setLiked] = useState(comment.liked_by_me);
  const [likes, setLikes] = useState(comment.like_count);

  async function onLike() {
    const wasLiked = liked;
    const next = !wasLiked;
    // Optimistic…
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    // …rolled back if it didn't persist.
    const res = await toggleCommentLike(comment.id, wasLiked);
    if (!res.ok) {
      setLiked(wasLiked);
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
    }
  }

  const avatarSize = isReply ? "h-7 w-7" : "h-9 w-9";

  return (
    <div className="flex gap-3">
      <div
        className={cn(
          "glass relative shrink-0 overflow-hidden rounded-full",
          avatarSize
        )}
      >
        {author?.avatar_url ? (
          <AppImage
            src={author.avatar_url}
            alt={author.full_name ?? ""}
            sizes={isReply ? "28px" : "36px"}
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13px]">
          <span className="font-semibold text-fg">
            {author?.full_name ?? "Student"}
          </span>
          <span className="ml-2 text-fg-muted">{timeAgo(comment.created_at)}</span>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[20px] text-fg">
          {comment.body}
        </p>
        <button
          type="button"
          onClick={onReply}
          className="mt-1 text-[12px] font-semibold text-fg-muted transition-colors hover:text-fg"
        >
          Reply
        </button>
      </div>

      {/* Like column, right-aligned like Instagram. */}
      <button
        type="button"
        onClick={onLike}
        aria-pressed={liked}
        aria-label={liked ? "Unlike comment" : "Like comment"}
        className={cn(
          "flex shrink-0 flex-col items-center gap-0.5 pt-0.5 transition-all active:scale-90",
          liked ? "text-error" : "text-fg-muted hover:text-fg"
        )}
      >
        <Heart className={cn("h-4 w-4", liked && "fill-current")} aria-hidden />
        {likes > 0 && <span className="text-[11px] leading-none">{likes}</span>}
      </button>
    </div>
  );
}
