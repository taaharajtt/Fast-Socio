"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { addComment } from "@/app/(student)/home/actions";

export function AddComment({ postId }: { postId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setError(null);
    start(async () => {
      const res = await addComment(postId, text);
      if (!res.ok) setError(res.error);
      else setBody("");
    });
  }

  return (
    <form
      onSubmit={submit}
      className="sticky bottom-0 flex items-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
    >
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment…"
        disabled={pending}
        className="glass h-11 flex-1 rounded-[var(--radius-pill)] px-4 text-[15px] text-fg outline-none placeholder:text-fg-muted/70 focus:ring-2 focus:ring-aura/40"
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
      {error && <p className="text-sm text-error">{error}</p>}
    </form>
  );
}
