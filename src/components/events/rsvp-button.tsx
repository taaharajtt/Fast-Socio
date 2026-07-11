"use client";

import { useState, useTransition } from "react";
import { CalendarCheck, Clock } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { rsvp, cancelRsvp } from "@/app/(student)/events/actions";

export type RsvpState = "going" | "waitlisted" | "none";

/**
 * Register / waitlist / cancel control (Refactor Phase 6). When an event is at
 * capacity a tap joins the waitlist instead of the attendee list; the existing
 * "Attend / Going" behaviour is preserved for uncapped or open events.
 */
export function RsvpButton({
  eventId,
  initialState,
  count: initialCount,
  capacity,
  ended = false,
}: {
  eventId: string;
  initialState: RsvpState;
  count: number;
  capacity: number | null;
  ended?: boolean;
}) {
  const [state, setState] = useState<RsvpState>(initialState);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const seatsLeft =
    capacity != null ? Math.max(0, capacity - count) : null;

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

  function register() {
    setError(null);
    start(async () => {
      const res = await rsvp(eventId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      switch (res.state) {
        case "going":
          setState("going");
          setCount((c) => c + 1);
          break;
        case "already_going":
          setState("going");
          break;
        case "waitlisted":
        case "already_waitlisted":
          setState("waitlisted");
          break;
        case "closed":
          setError("This event isn't open for registration.");
          break;
        case "ended":
          setError("This event has already ended.");
          break;
      }
    });
  }

  function leave() {
    setError(null);
    const wasGoing = state === "going";
    setState("none");
    if (wasGoing) setCount((c) => Math.max(0, c - 1));
    start(async () => {
      const res = await cancelRsvp(eventId);
      if (!res.ok) {
        setState(wasGoing ? "going" : "waitlisted");
        if (wasGoing) setCount((c) => c + 1);
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {state === "going" ? (
          <GlassButton variant="glass" size="md" disabled={pending} onClick={leave}>
            Going ✓
          </GlassButton>
        ) : state === "waitlisted" ? (
          <GlassButton variant="glass" size="md" disabled={pending} onClick={leave}>
            <Clock className="mr-1.5 h-4 w-4" aria-hidden />
            On waitlist
          </GlassButton>
        ) : (
          <GlassButton
            variant="primary"
            size="md"
            disabled={pending}
            onClick={register}
          >
            {seatsLeft === 0 ? "Join waitlist" : "Attend"}
          </GlassButton>
        )}

        <span className="text-sm text-fg-muted">
          {count} going
          {seatsLeft != null &&
            (seatsLeft > 0
              ? ` · ${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left`
              : " · full")}
        </span>
      </div>
      {state === "waitlisted" && (
        <p className="text-xs text-fg-muted">
          You&apos;ll be added automatically when a seat opens up.
        </p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
