"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Send, Smile, X } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { addComment } from "@/app/(student)/home/actions";
import type { ReplyTarget } from "@/components/feed/comment-thread";

const EMOJIS = [
  "😂", "❤️", "🔥", "👍", "🙌", "😅", "😍", "🥲",
  "😭", "💀", "✨", "🎉", "👀", "🤝", "🙏", "💯",
  "😎", "🤔", "😳", "🥳", "☕", "⚡", "🎮", "📚",
];

/** Instagram-style quick reactions shown as a single always-visible row. */
const QUICK_EMOJIS = ["❤️", "🙌", "🔥", "👏", "🥺", "😍", "😮", "😂"];

export function AddComment({
  postId,
  avatarUrl,
  showQuickEmojis = false,
  replyingTo = null,
  onCancelReply,
  onSubmitted,
}: {
  postId: string;
  /** Viewer's avatar, shown to the left of the field (IG comment sheet). */
  avatarUrl?: string | null;
  /** Render a horizontal quick-reaction emoji row above the input (IG format). */
  showQuickEmojis?: boolean;
  /** When set, the composer posts a reply to this comment and shows a banner. */
  replyingTo?: ReplyTarget | null;
  /** Dismiss the reply banner (revert to a top-level comment). */
  onCancelReply?: () => void;
  /** Fired after a successful post; parentId is set for a reply, null otherwise. */
  onSubmitted?: (parentId: string | null) => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field when a reply is started so the user can type immediately.
  useEffect(() => {
    if (replyingTo) inputRef.current?.focus();
  }, [replyingTo]);

  function insertEmoji(emoji: string) {
    setBody((prev) => prev + emoji);
    inputRef.current?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setError(null);
    const parentId = replyingTo?.parentId ?? null;
    start(async () => {
      const res = await addComment(postId, text, parentId);
      if (!res.ok) setError(res.error);
      else {
        setBody("");
        setShowEmoji(false);
        onSubmitted?.(parentId);
      }
    });
  }

  return (
    <div className="pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
      {/* "Replying to …" banner with a dismiss control. */}
      {replyingTo && (
        <div className="mb-2 flex items-center justify-between rounded-[var(--radius-sm)] bg-glass px-3 py-1.5 text-[13px] text-fg-muted">
          <span className="truncate">
            Replying to{" "}
            <span className="font-semibold text-fg">{replyingTo.name}</span>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="ml-2 shrink-0 text-fg-muted hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {/* IG quick-reaction strip. */}
      {showQuickEmojis && (
        <div className="mb-2 flex justify-between px-1">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => insertEmoji(emoji)}
              className="text-2xl leading-none transition-transform active:scale-125"
              aria-label={`React ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Full emoji grid (toggle) — used on the full post page. */}
      {!showQuickEmojis && showEmoji && (
        <div className="glass-strong mb-2 grid grid-cols-8 gap-1 rounded-[var(--radius-sm)] p-2">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                insertEmoji(emoji);
                setShowEmoji(false);
              }}
              className="flex h-9 w-full items-center justify-center rounded-lg text-xl hover:bg-glass"
              aria-label={`Insert ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex items-center gap-2">
        {avatarUrl !== undefined ? (
          <div className="glass relative h-9 w-9 shrink-0 overflow-hidden rounded-full">
            {avatarUrl ? <AppImage src={avatarUrl} alt="" sizes="36px" /> : null}
          </div>
        ) : (
          <button
            type="button"
            aria-label="Emoji"
            onClick={() => setShowEmoji((s) => !s)}
            className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg"
          >
            <Smile className="h-5 w-5" aria-hidden />
          </button>
        )}
        <input
          ref={inputRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          disabled={pending}
          className="glass h-11 flex-1 rounded-[var(--radius-pill)] px-4 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
        />
        <GlassButton
          type="submit"
          size="icon"
          className="h-11 w-11"
          aria-label="Send comment"
          disabled={pending || body.trim().length === 0}
        >
          <Send className="h-5 w-5" aria-hidden />
        </GlassButton>
      </form>
      {error && (
        <p role="alert" className="mt-1 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
