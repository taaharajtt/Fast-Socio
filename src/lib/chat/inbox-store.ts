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
 * back then made it worse rather than better — Next 16's Client Cache replays
 * the RSC payload from the previous render on a back/forward navigation, so the
 * list remounted holding the same `initial` it had before.
 *
 * Moving the snapshot here fixes both halves at once: <ChatRealtime/> lives in
 * the student layout and keeps listening from anywhere in the app (including
 * inside /chat/[id]), and whatever it last wrote renders immediately on the
 * next mount of the list — cached page payload or not.
 *
 * USER SCOPING. The snapshot is stored alongside the id of the account it was
 * read for, and `setInboxSnapshot` refuses to publish a payload whose `me` does
 * not match the owner the store was claimed for. Module state survives a
 * sign-out in the same tab; without this, an in-flight read from the previous
 * session could land after the new one signed in.
 */

let snapshot: InboxData | null = null;
/** Which account the current snapshot belongs to. */
let owner: string | null = null;
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

/**
 * Claim the store for a viewer. Called by <ChatRealtime/> when it mounts for a
 * user id. If the store currently holds someone else's inbox it is dropped
 * first, so no frame can ever render the previous account's threads.
 */
export function claimInboxStore(userId: string) {
  if (owner === userId) return;
  owner = userId;
  if (snapshot !== null) {
    snapshot = null;
    emit();
  }
}

/**
 * Publish a freshly-read inbox. Ignored unless it belongs to the account the
 * store is currently claimed for — a read that was already in flight when the
 * user switched accounts must not resurrect the old session's data.
 */
export function setInboxSnapshot(data: InboxData) {
  if (owner !== null && data.me !== owner) return;
  snapshot = data;
  emit();
}

/** Drop the snapshot — a different signed-in user, or a sign-out. */
export function clearInboxSnapshot() {
  owner = null;
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
