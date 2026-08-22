import type { InboxData } from "@/lib/chat/inbox-types";

/**
 * Deciding which of two inbox payloads to render.
 *
 * The list can be handed two candidates at once: the payload the server
 * rendered with (its `initial` prop) and whatever the layout-level realtime
 * listener last wrote into the store. Neither is automatically newer:
 *
 *  - A real navigation to /chat produces a genuinely fresh server payload,
 *    which may be newer than a store snapshot taken minutes ago.
 *  - A back/forward navigation REPLAYS the payload from the previous render
 *    (Next 16 Client Cache — see 01-app/04-glossary.md), which is exactly the
 *    stale data this whole change exists to stop showing. Object identity
 *    cannot tell those two cases apart, so identity is not used here.
 *
 * Both are pure functions of the payloads themselves, which is what makes this
 * testable without a browser and why it lives apart from the store.
 */

/** Newest activity timestamp anywhere in the payload, as epoch ms. */
export function inboxWatermark(data: InboxData): number {
  let newest = 0;
  for (const t of data.threads) {
    const ts = new Date(t.ts).getTime();
    if (Number.isFinite(ts) && ts > newest) newest = ts;
  }
  return newest;
}

/**
 * The payload a viewer should see.
 *
 * Rules, in order:
 *  1. No snapshot, or a snapshot belonging to a different account → server.
 *     (Module state outlives a sign-out; another user's inbox must never
 *     render, not even for one frame.)
 *  2. Strictly newer watermark wins.
 *  3. Tie → the snapshot. On a tie the two agree about the newest message, and
 *     the snapshot additionally carries the most recent unread counts and
 *     request rows, since it was produced by a read that happened later in
 *     wall-clock time than the server render being replayed.
 */
export function pickFreshestInbox(
  server: InboxData,
  stored: InboxData | null
): InboxData {
  if (!stored) return server;
  if (stored.me !== server.me) return server;
  return inboxWatermark(server) > inboxWatermark(stored) ? server : stored;
}
