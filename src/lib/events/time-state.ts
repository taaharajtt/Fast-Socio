/**
 * Event time state — one helper, one definition, an injected clock (UAT-10).
 *
 * WHAT WAS WRONG. "Has this event ended?" was a local function in the event
 * detail page reading `Date.now()` directly, and nothing else in the app agreed
 * with it: the events list, the society events tab and the community strip each
 * decided "upcoming" their own way. Reading the clock inside the function also
 * made the boundary untestable — you cannot ask "what does this show one second
 * before the start?" of a function that insists on the real current time.
 *
 * THE MODEL. Instants are stored as `timestamptz` and therefore carry no
 * timezone of their own; a UTC instant is a point in time, and comparing two of
 * them is timezone-free. Every comparison here is millisecond arithmetic on
 * epoch values, so it produces the same answer in Karachi, London or a test
 * runner pinned to UTC-11. Timezone only enters at DISPLAY, where the campus
 * policy is Asia/Karachi (see `lib/events/format`), and the UI says so.
 *
 * WHAT THIS FIXES BY EXISTING:
 *  * SSR/client disagreement. A server render at 17:59:59 and a hydration at
 *    18:00:01 previously produced different states with no way to reconcile;
 *    `nextBoundary` lets the client schedule a re-render at the exact instant
 *    instead of waiting for a manual reload.
 *  * Open-ended events. An event with no `ends_at` is LIVE from its start (it
 *    is happening), not instantly ended — the old `hasEnded` treated the start
 *    as the end for those, so an open-ended event read as over the moment it
 *    began.
 */

export type EventTimeState = "upcoming" | "live" | "ended";

export type EventTimes = {
  startsAt: string;
  endsAt?: string | null;
};

/**
 * How long an open-ended event stays "live" after it starts.
 *
 * `ends_at` is nullable, so for those events there is no instant at which the
 * database says it is over. Two hours is the campus default session length and
 * keeps such an event from sitting "live" forever on the events list.
 */
export const OPEN_ENDED_DURATION_MS = 2 * 60 * 60 * 1000;

/** The instant an event is considered over, whether or not it names one. */
export function effectiveEnd(event: EventTimes): number {
  const start = new Date(event.startsAt).getTime();
  if (event.endsAt) {
    const end = new Date(event.endsAt).getTime();
    // A malformed or inverted range must never make an event end before it
    // starts — the DB CHECK forbids it, but this reads rows, not constraints.
    return Number.isFinite(end) && end >= start ? end : start + OPEN_ENDED_DURATION_MS;
  }
  return start + OPEN_ENDED_DURATION_MS;
}

/**
 * The state of an event at a given instant.
 *
 * `now` is a parameter, not a default read of the system clock, so a caller
 * that must be deterministic (a server render, a test) can pin it. Boundaries
 * are inclusive of the start and exclusive of the end: exactly at `startsAt` an
 * event is live, and exactly at its end it is over.
 */
export function eventTimeState(event: EventTimes, now: number): EventTimeState {
  const start = new Date(event.startsAt).getTime();
  if (!Number.isFinite(start)) return "upcoming";
  if (now < start) return "upcoming";
  return now < effectiveEnd(event) ? "live" : "ended";
}

/** Convenience for the many call sites that only care whether it is over. */
export function hasEnded(event: EventTimes, now: number): boolean {
  return eventTimeState(event, now) === "ended";
}

/**
 * The next instant at which this event's state changes, or null when it never
 * will again.
 *
 * This is what a client uses to schedule a single timer instead of polling: an
 * upcoming event needs one wake-up at its start, a live one at its end, and an
 * ended one needs none at all.
 */
export function nextBoundary(event: EventTimes, now: number): number | null {
  const start = new Date(event.startsAt).getTime();
  if (!Number.isFinite(start)) return null;
  if (now < start) return start;
  const end = effectiveEnd(event);
  return now < end ? end : null;
}

/**
 * The state right now, for a SERVER render.
 *
 * The clock read lives here rather than at the call site so a server component
 * stays free of impure calls in its render body, and — more importantly — so
 * there is one place that decides what "now" means for the server. Client code
 * must not use this: it needs `useEventTimeState`, which re-evaluates at the
 * boundary instead of freezing the answer at mount.
 */
export function eventTimeStateNow(event: EventTimes): EventTimeState {
  return eventTimeState(event, Date.now());
}

/** `hasEnded` for a server render. See `eventTimeStateNow`. */
export function hasEndedNow(event: EventTimes): boolean {
  return eventTimeStateNow(event) === "ended";
}

/** Short label for the state, for a badge. */
export const EVENT_STATE_LABEL: Record<EventTimeState, string> = {
  upcoming: "Upcoming",
  live: "Live now",
  ended: "Ended",
};

/**
 * The timezone every event time in the product is displayed in.
 *
 * Stated in the UI rather than assumed. A student reading "Sat 4 Oct, 18:00"
 * cannot tell whether that is their device's time or the campus's, and the two
 * differ for anyone travelling — which is exactly the ambiguity UAT-10 asks to
 * remove. Formatting is pinned to this zone in `lib/events/format`, so the label
 * and the number always come from the same rule.
 */
export const EVENT_TIMEZONE = "Asia/Karachi";
export const EVENT_TIMEZONE_LABEL = "PKT";
