"use client";

import { useCallback, useEffect, useRef } from "react";
import { refreshInbox } from "@/app/(student)/chat/actions";
import { setInboxSnapshot, clearInboxSnapshot } from "@/lib/chat/inbox-store";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime-channel";
import { usePushSignal } from "@/lib/push/use-push-signal";

/**
 * The DM inbox's realtime listener, hoisted out of <InboxList/> and mounted
 * from the student layout so it stays alive on EVERY screen — crucially,
 * including inside /chat/[id].
 *
 * That relocation is the whole fix. Previously the subscription lived on the
 * /chat page, so the moment a student tapped a conversation the channel was
 * removed; a message that arrived while they were reading was never delivered
 * to anything, and `postgres_changes` cannot replay it afterwards. Coming back
 * to Messages then rendered whatever the Client Cache had (Next 16 reuses page
 * segments on back/forward navigation), which is why the list kept showing the
 * preview from the last full reload.
 *
 * Now the events land here, the re-read goes into the shared store, and
 * <InboxList/> renders that store the instant it mounts.
 *
 * Cost control: the handler does not fetch per event. A burst — a message
 * INSERT plus the `conversations.last_message_at` trigger UPDATE plus a read
 * receipt — is coalesced into a single `refreshInbox()`, which is one targeted
 * server action, not a `router.refresh()` of the whole RSC tree.
 */

/** Coalescing window for a burst of related events. */
const DEBOUNCE_MS = 350;

export function InboxRealtime({ userId }: { userId: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const queued = useRef(false);

  /**
   * Read the inbox and publish it. Guarded against overlap: a second read
   * launched while the first is still out would race to write the store, and
   * the loser could be the newer one. Instead the request is remembered and
   * replayed once, which also collapses a long burst into two reads total.
   */
  const readInbox = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      // Loop rather than recurse: one more pass covers every event that arrived
      // while the previous read was out, and a long burst still costs two reads
      // in total.
      do {
        queued.current = false;
        try {
          setInboxSnapshot(await refreshInbox());
        } catch {
          // A failed read leaves the last good snapshot in place; the next
          // event, focus or resubscribe tries again. An inbox one message
          // behind beats an inbox that renders an error.
          break;
        }
      } while (queued.current);
    } finally {
      inFlight.current = false;
    }
  }, []);

  const scheduleRead = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void readInbox(), DEBOUNCE_MS);
  }, [readInbox]);

  useRealtimeChannel({
    name: `chat-inbox:${userId}`,
    label: "chat inbox",
    // Catch-up fires on first subscribe, on every recovery from
    // CHANNEL_ERROR/TIMED_OUT, and on focus/visibility resume — the three
    // moments where events may have been missed. Immediate, not debounced:
    // there is no burst to coalesce, just a gap to close.
    onCatchUp: () => void readInbox(),
    build: (channel) =>
      channel
        // RLS on postgres_changes already scopes delivery to rows this user can
        // select (their own conversations/messages/requests), so no per-row
        // filter is needed here. Kept broad for `community_chat_messages` too:
        // a filter would be one `.on()` per room and would go deaf to being
        // ADDED to a room, which is exactly when the inbox must update.
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages" },
          scheduleRead
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "conversations" },
          scheduleRead
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "message_requests" },
          scheduleRead
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "community_chat_messages" },
          scheduleRead
        ),
  });

  // A message push that arrives with the app backgrounded means the socket was
  // almost certainly not there to receive the INSERT — re-read on the way back
  // rather than waiting for the next event.
  usePushSignal(() => void readInbox());

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // A snapshot belongs to the account that produced it. If this island is ever
  // remounted for a different viewer (sign out, sign in as someone else in the
  // same tab), drop the old one rather than letting it shadow the new server
  // render for a frame.
  useEffect(() => {
    return () => clearInboxSnapshot();
  }, [userId]);

  return null;
}
