"use client";

import { useRef, useState, useTransition } from "react";
import { Send, Smile } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { addComment } from "@/app/(student)/home/actions";

const EMOJIS = [
  "😂", "❤️", "🔥", "👍", "🙌", "😅", "😍", "🥲",
  "😭", "💀", "✨", "🎉", "👀", "🤝", "🙏", "💯",
  "😎", "🤔", "😳", "🥳", "☕", "⚡", "🎮", "📚",
];

export function AddComment({ postId }: { postId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function insertEmoji(emoji: string) {
    setBody((prev) => prev + emoji);
    setShowEmoji(false);
    inputRef.current?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setError(null);
    start(async () => {
      const res = await addComment(postId, text);
      if (!res.ok) setError(res.error);
      else {
        setBody("");
        setShowEmoji(false);
      }
    });
  }

  return (
    <div className="sticky bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
      {showEmoji && (
        <div className="glass-strong mb-2 grid grid-cols-8 gap-1 rounded-[var(--radius-sm)] p-2">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => insertEmoji(emoji)}
              className="flex h-9 w-full items-center justify-center rounded-lg text-xl hover:bg-glass"
              aria-label={`Insert ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Emoji"
          onClick={() => setShowEmoji((s) => !s)}
          className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg"
        >
          <Smile className="h-5 w-5" aria-hidden />
        </button>
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
