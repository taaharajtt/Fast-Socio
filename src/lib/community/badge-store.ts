"use client";

import { useSyncExternalStore } from "react";

/**
 * Client-side store for the dock's Community badge, mirroring
 * `lib/chat/badge-store.ts` so both dock numbers behave the same way.
 *
 * The server computes the badge in the student layout; this store lets the
 * realtime island override it without a `router.refresh()`, which would refetch
 * the whole RSC tree of whatever screen the student is on just to change one
 * number.
 *
 * Only ever set from an AUTHORITATIVE count returned by the server — never
 * incremented or decremented from an event. A blind `+1` on an insert and `-1`
 * on a read cannot stay correct here: an update can stop counting because
 * someone else approved the join request, because the reader lost an officer
 * role, or because its subject was deleted, and none of those produce an event
 * this client can count. Reconciling on the real number is the only version
 * that converges.
 */

let count: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => count;
/** Server render (and the first client render) has nothing newer than the
 *  server-computed value, so it falls through to the caller's fallback. */
const getServerSnapshot = () => null;

export function setCommunityBadge(next: number) {
  // Defend the dock from a bad number one last time: the store is what the UI
  // reads, so nothing negative or non-finite may enter it.
  const safe = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0;
  if (count === safe) return;
  count = safe;
  for (const listener of listeners) listener();
}

/** Drop any value left by a previous session in this tab. */
export function clearCommunityBadge() {
  count = null;
  for (const listener of listeners) listener();
}

/** The freshest known Community badge: realtime's value if we have one, else
 *  the count the server rendered with. */
export function useCommunityBadge(serverValue: number) {
  const live = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return live ?? serverValue;
}
