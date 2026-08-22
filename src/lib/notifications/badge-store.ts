"use client";

import { useSyncExternalStore } from "react";

/**
 * Client-side store for the Activity unread count, mirroring
 * `lib/chat/badge-store.ts` exactly.
 *
 * The bell is rendered by a server component inside a Suspense boundary in the
 * /home header, so before this it could only change when something re-rendered
 * that segment — and layout/header segments are reused by the Client Cache
 * across navigations ("shared layouts won't automatically be refetched on every
 * navigation", 01-app/.../staleTimes.md). A like or a comment arriving while
 * the student sat on the feed was therefore invisible until a reload.
 *
 * `notifications` has been in the supabase_realtime publication since migration
 * 0121; nothing had ever subscribed to it. <NotificationsRealtime/> does now,
 * and writes the recount here.
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
const getServerSnapshot = () => null;

export function setActivityBadge(next: number) {
  if (count === next) return;
  count = next;
  for (const listener of listeners) listener();
}

/** The freshest known Activity count: realtime's, else the server's. */
export function useActivityBadge(serverValue: number) {
  const live = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return live ?? serverValue;
}
