"use client";

import { useRouter } from "next/navigation";
import { useVisibilityRefresh } from "@/lib/realtime/use-realtime-channel";

/**
 * Re-renders the current route's server components when the app is resumed
 * after being away — and ONLY then.
 *
 * This is the deliberate exception to "never use router.refresh() for
 * freshness". It is the right tool for screens whose data is a fan-out of a
 * dozen server queries with no client fetch path of their own (the community
 * list, a community detail page: member counts, join/follow state, pending join
 * requests, room previews). Building a bespoke server action per screen to
 * re-read all of that would be a large refactor for data nobody watches change
 * live.
 *
 * What makes it acceptable here is the trigger. It is NOT wired to realtime
 * events — that was the old anti-pattern, one full RSC round trip per message.
 * It fires when the tab becomes visible again, at most once every `minGapMs`,
 * which is the moment a student's own expectation of freshness resets. On a
 * screen the user is actively looking at, nothing fires at all.
 *
 * Deliberately not on: /chat (its inbox has a targeted server action and a
 * store), /home (the feed re-reads page 1 by itself), or any chat thread.
 */
export function RefreshOnResume({
  /** Minimum gap between refreshes. 30s: long enough that app-switching can't
   *  turn into an RSC storm, short enough to feel current on return. */
  minGapMs = 30_000,
}: {
  minGapMs?: number;
}) {
  const router = useRouter();
  useVisibilityRefresh(() => router.refresh(), {
    throttleMs: minGapMs,
    // Mounting is a navigation, and a navigation to a dynamic route has already
    // fetched fresh data. Refreshing again here would double every page load.
    onMount: false,
  });
  return null;
}
