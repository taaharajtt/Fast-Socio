"use client";

import { useState, useTransition } from "react";
import { CalendarCheck } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { rsvp, cancelRsvp } from "@/app/(student)/events/actions";

export function RsvpButton({
  eventId,
  attending: initialAttending,
  count: initialCount,
  ended = false,
}: {
  eventId: string;
  attending: boolean;
  count: number;
  ended?: boolean;
}) {
  const [attending, setAttending] = useState(initialAttending);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (ended) {
    return (
      <div className="flex items-center gap-2">
        <span className="glass flex items-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium text-fg-muted">
          <CalendarCheck className="h-4 w-4" aria-hidden />
          Event ended
        </span>
        <span className="text-sm text-fg-muted">{count} attended</span>
      </div>
    );
  }

  function toggle() {
    setError(null);
    const wasAttending = attending;
    // Optimistic update.
    setAttending(!wasAttending);
    setCount((c) => c + (wasAttending ? -1 : 1));
    start(async () => {
      const res = wasAttending ? await cancelRsvp(eventId) : await rsvp(eventId);
      if (!res.ok) {
        // Revert on failure.
        setAttending(wasAttending);
        setCount((c) => c + (wasAttending ? 1 : -1));
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <GlassButton
          variant={attending ? "glass" : "primary"}
          size="md"
          disabled={pending}
          onClick={toggle}
        >
          {attending ? "Going ✓" : "Attend"}
        </GlassButton>
        <span className="text-sm text-fg-muted">{count} going</span>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
