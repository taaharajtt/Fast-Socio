"use client";

import { useEffect, useState } from "react";
import {
  EVENT_STATE_LABEL,
  EVENT_TIMEZONE_LABEL,
  eventTimeState,
  nextBoundary,
  type EventTimeState,
  type EventTimes,
} from "@/lib/events/time-state";

/**
 * The live/upcoming/ended badge, which changes state on its own (UAT-10).
 *
 * A server-rendered state is correct only at the instant it was rendered. An
 * event page opened five minutes before the start used to keep saying
 * "Upcoming" indefinitely — through the start, through the whole event —
 * because nothing ever re-evaluated it without a manual reload.
 *
 * This schedules ONE timer at the exact next boundary (`nextBoundary`), not a
 * polling interval: an upcoming event wakes once at its start, a live one once
 * at its end, and an ended one never. It also re-checks on focus and on
 * visibility change, because a backgrounded tab's timers are throttled or
 * coalesced by every mobile browser and a PWA resumed after an hour must not
 * trust that its timer fired on time.
 *
 * `setTimeout` is capped at a 32-bit millisecond delay (~24.8 days); a longer
 * wait is clamped and re-scheduled on the next tick, so an event three months
 * out does not fire immediately from integer overflow.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

export function EventStateBadge({
  event,
  className,
}: {
  event: EventTimes;
  className?: string;
}) {
  const state = useEventTimeState(event);
  return (
    <span
      className={className}
      // The state is announced when it flips, so someone who is not watching
      // the badge still learns the event has started.
      role="status"
    >
      {EVENT_STATE_LABEL[state]}
    </span>
  );
}

/**
 * The event's state right now, re-evaluated exactly when it changes.
 *
 * The first render deliberately uses the SERVER's answer via a lazy initial
 * state computed from the same helper — so hydration matches — and the effect
 * corrects it immediately if the boundary was crossed in between.
 */
export function useEventTimeState(event: EventTimes): EventTimeState {
  const startsAt = event.startsAt;
  const endsAt = event.endsAt ?? null;
  const [state, setState] = useState<EventTimeState>(() =>
    eventTimeState({ startsAt, endsAt }, Date.now())
  );

  useEffect(() => {
    // Depend on the two TIMESTAMPS, not on the object. A caller almost always
    // passes an object literal, whose identity changes on every render — an
    // `event`-keyed effect would therefore tear down and re-arm the timer
    // continuously and never actually reach a boundary.
    const times = { startsAt, endsAt };
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sync = () => {
      const now = Date.now();
      setState(eventTimeState(times, now));
      const next = nextBoundary(times, now);
      if (timer) clearTimeout(timer);
      if (next === null) return;
      // +1s so the timer fires just AFTER the boundary; firing exactly on it
      // can re-evaluate to the same state on a slow clock and schedule a
      // zero-delay loop.
      const delay = Math.min(Math.max(next - now + 1000, 0), MAX_TIMEOUT_MS);
      timer = setTimeout(sync, delay);
    };

    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [startsAt, endsAt]);

  return state;
}

/** "Sat 4 Oct, 18:00 PKT" — the zone the number is in, said out loud. */
export function EventTimeCaption({ formatted }: { formatted: string }) {
  return (
    <>
      {formatted} {EVENT_TIMEZONE_LABEL}
    </>
  );
}
