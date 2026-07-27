"use client";

import { useSyncExternalStore } from "react";

/**
 * Client-side store for the dock's chat badge (unread DMs + pending requests).
 *
 * The badge is computed on the server in the student layout, so keeping it live
 * used to mean calling `router.refresh()` on every message event — which
 * refetches the ENTIRE RSC tree for whatever screen you happen to be on (feed,
 * deck, inbox, profile) just to change one number. On a busy evening that fired
 * constantly and made the whole app feel like it was chewing on something.
 *
 * Instead the realtime listener writes the new count here and only the dock
 * re-renders. The server value stays the source of truth for the first paint;
 * this store simply overrides it once realtime has something fresher.
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

export function setChatBadge(next: number) {
  if (count === next) return;
  count = next;
  for (const listener of listeners) listener();
}

/** The freshest known chat badge: realtime's value if we have one, else the
 *  count the server rendered with. */
export function useChatBadge(serverValue: number) {
  const live = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return live ?? serverValue;
}
