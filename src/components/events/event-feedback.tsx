"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { submitEventFeedback } from "@/app/(student)/events/actions";

/**
 * Post-event rating + comment (Refactor Phase 6). Only rendered for attendees of
 * an event that has ended. Pre-fills with any existing feedback (editable).
 */
export function EventFeedback({
  eventId,
  initialRating,
  initialComment,
}: {
  eventId: string;
  initialRating: number | null;
  initialComment: string | null;
}) {
  const [rating, setRating] = useState(initialRating ?? 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(initialComment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(initialRating != null);

  async function submit() {
    if (rating < 1 || busy) return;
    setBusy(true);
    setError(null);
    const res = await submitEventFeedback(eventId, rating, comment);
    setBusy(false);
    if (res.ok) setSaved(true);
    else setError(res.error);
  }

  return (
    <div className="rounded-[var(--radius-card)] bg-card p-5">
      <p className="text-sm font-semibold text-fg">
        {saved ? "Your feedback" : "How was it?"}
      </p>
      <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (hover || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => {
                setRating(n);
                setSaved(false);
              }}
              className="transition-transform active:scale-90"
            >
              <Star
                className={cn(
                  "h-8 w-8",
                  active ? "fill-gold text-gold" : "text-fg-disabled"
                )}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
      <textarea
        value={comment}
        onChange={(e) => {
          setComment(e.target.value.slice(0, 500));
          setSaved(false);
        }}
        rows={3}
        placeholder="Share a few words (optional)…"
        className="mt-3 w-full resize-none rounded-[var(--radius-md)] bg-input-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
      />
      <div className="mt-3 flex items-center gap-3">
        <GlassButton
          size="sm"
          onClick={submit}
          disabled={rating < 1 || busy}
        >
          {busy ? "Saving…" : saved ? "Update" : "Submit"}
        </GlassButton>
        {saved && !busy && (
          <span className="text-xs text-success">Thanks for the feedback!</span>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
