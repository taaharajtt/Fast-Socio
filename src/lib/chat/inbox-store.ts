"use client";

import { useSyncExternalStore } from "react";
import type { InboxData } from "@/lib/chat/inbox-types";
import { pickFreshestInbox } from "@/lib/chat/inbox-freshness";

/**
 * Client-side store for the DM inbox, following the same shape as
 * `lib/chat/badge-store.ts`: module state + `useSyncExternalStore`, seeded from
 * the server render and overridden once something fresher arrives.
 *
 * WHY THIS EXISTS — the inbox used to own its own realtime channel inside
 * <InboxList/>. That component only exists while /chat is on screen, so opening
 * a conversation unmounted it and `removeChannel` tore the subscription down.
 * A message arriving while the user was reading a thread reached nobody:
 * `postgres_changes` has no replay, so the event was gone for good. Navigating
 * back then made it worse rather than better — per Next 16's Client Cache
 * (node_modules/next/dist/docs/01-app/04-glossary.md: "Pages are not cached by
 * default but are reused during browser back/forward navigation"), the back
 * gesture replays the RSC payload from the previous render, so the list
 * remounted holding the same `initial` it had before.
 *
 * Moving the snapshot here fixes both halves at once: <InboxRealtime/> lives in
 * the student layout and keeps listening from anywhere in the app (including
 * inside /chat/[id]), and whatever it last wrote is rendered immediately on the
 * next mount of the list — cached page payload or not.
 */

let snapshot: InboxData | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;
/** Nothing client-side is newer than the server's own render. */
const getServerSnapshot = (): InboxData | null => null;

function emit() {
  for (const listener of listeners) listener();
}

/** Publish a freshly-read inbox. Called by <InboxRealtime/> and by the list's
 *  own mount/focus reads. */
export function setInboxSnapshot(data: InboxData) {
  snapshot = data;
  emit();
}

/** Drop the snapshot — a different signed-in user, or a sign-out. Without this,
 *  module state would outlive the account it belongs to. */
export function clearInboxSnapshot() {
  if (snapshot === null) return;
  snapshot = null;
  emit();
}

/** The current stored snapshot, or null. For non-React callers and tests. */
export function getInboxSnapshot(): InboxData | null {
  return snapshot;
}

/**
 * The freshest inbox this tab knows about. `pickFreshestInbox` — not object
 * identity — decides, because a replayed Client Cache payload is a different
 * object holding older data.
 */
export function useInboxData(serverValue: InboxData): InboxData {
  const live = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return pickFreshestInbox(serverValue, live);
}
