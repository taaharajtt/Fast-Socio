"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Send, Smile, X } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import {
  addComment,
  fetchMentionRoster,
  type MentionTarget,
} from "@/app/(student)/home/actions";
import { activeMentionQuery, serializeMentions } from "@/lib/mentions";
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

  // @-mention autocomplete. `mentions` maps a confirmed lowercased username to
  // its user id; only these become links when the comment is serialised. The
  // roster (the viewer's matches) is fetched once, on first "@", then filtered
  // client-side as they type. `mq` is the "@query" the caret currently sits in.
  const [mentions, setMentions] = useState<Record<string, string>>({});
  const [roster, setRoster] = useState<MentionTarget[] | null>(null);
  const [mq, setMq] = useState<{ start: number; query: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus the field when a reply is started so the user can type immediately.
  useEffect(() => {
    if (replyingTo) inputRef.current?.focus();
  }, [replyingTo]);

  // Lazily load the mention roster the first time a mention is being typed.
  useEffect(() => {
    if (mq && roster === null) fetchMentionRoster().then(setRoster);
  }, [mq, roster]);

  const suggestions = useMemo(() => {
    if (!mq || !roster) return [];
    const q = mq.query.toLowerCase();
    const list = roster.filter((p) => {
      if (!p.username) return false;
      if (!q) return true;
      return (
        (p.full_name ?? "").toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q)
      );
    });
    return list.slice(0, 6);
  }, [mq, roster]);

  const showMenu = mq !== null && (roster === null || suggestions.length > 0);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setBody(value);
    const caret = e.target.selectionStart ?? value.length;
    setMq(activeMentionQuery(value, caret));
    setActiveIdx(0);
  }

  function pickMention(t: MentionTarget) {
    if (!mq || !t.username) return;
    const before = body.slice(0, mq.start);
    const after = body.slice(mq.start + 1 + mq.query.length);
    const insert = `@${t.username} `;
    setBody(before + insert + after);
    setMentions((prev) => ({ ...prev, [t.username!.toLowerCase()]: t.id }));
    setMq(null);
    const pos = (before + insert).length;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showMenu || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickMention(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMq(null);
    }
  }

  function insertEmoji(emoji: string) {
    setBody((prev) => prev + emoji);
    setMq(null);
    inputRef.current?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setError(null);
    const parentId = replyingTo?.parentId ?? null;
    const serialized = serializeMentions(text, mentions);
    start(async () => {
      const res = await addComment(postId, serialized, parentId);
      if (!res.ok) setError(res.error);
      else {
        setBody("");
        setMentions({});
        setMq(null);
        setShowEmoji(false);
        onSubmitted?.(parentId);
      }
    });
  }

  return (
    <div className="relative pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
      {/* @-mention suggestions, floating above the composer. */}
      {showMenu && (
        <div className="glass-strong absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-[var(--radius-sm)] border border-glass-border">
          {roster === null ? (
            <p className="px-3 py-2.5 text-sm text-fg-muted">Loading matches…</p>
          ) : (
            suggestions.map((t, i) => (
              <button
                key={t.id}
                type="button"
                // Keep the input focused so the tap registers before blur.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickMention(t)}
                onMouseEnter={() => setActiveIdx(i)}
                className={
                  "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors " +
                  (i === activeIdx ? "bg-glass" : "hover:bg-glass")
                }
              >
                <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-card">
                  {t.avatar_url && (
                    <AppImage src={t.avatar_url} alt="" sizes="32px" />
                  )}
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-fg">
                    {t.full_name ?? "Student"}
                  </span>
                  <span className="block truncate text-[12px] text-fg-muted">
                    @{t.username}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}

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
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Delay so a suggestion tap still fires before the menu closes.
            blurTimer.current = setTimeout(() => setMq(null), 120);
          }}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
          }}
          placeholder="Add a comment…"
          disabled={pending}
          className="glass h-11 flex-1 rounded-[var(--radius-pill)] px-4 text-base text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
        />
        <GlassButton
          type="submit"
          size="icon"
          className="h-11 w-11 shrink-0"
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
