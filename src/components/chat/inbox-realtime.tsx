"use client";

import { useCallback, useEffect, useRef } from "react";
import { refreshInbox } from "@/app/(student)/chat/actions";
import {
  claimInboxStore,
  clearInboxSnapshot,
  setInboxSnapshot,
} from "@/lib/chat/inbox-store";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime-channel";
import { reportRealtimeIssue } from "@/lib/realtime/telemetry";
import { usePushSignal } from "@/lib/push/use-push-signal";

/**
 * The DM inbox's realtime listener, hoisted out of <InboxList/> and mounted
 * from the student layout so it stays alive on EVERY screen — crucially,
 * including inside /chat/[id].
 *
 * That relocation is the whole fix. Previously the subscription lived on the
 * /chat page, so the moment a student tapped a conversation the channel was
 * removed; a message that arrived while they were reading was delivered to
 * nothing, and `postgres_changes` cannot replay it afterwards. Coming back to
 * Messages then rendered whatever the Client Cache had — Next 16 reuses page
 * segments on back/forward navigation — which is why the list kept showing the
 * preview from the last full reload.
 *
 * Now the events land here, the re-read goes into the shared store, and
 * <InboxList/> renders that store the instant it mounts.
 *
 * COST CONTROL. The handler does not fetch per event. A burst — a message
 * INSERT, plus the `conversations.last_message_at` trigger UPDATE, plus a read
 * receipt UPDATE — is coalesced into a single `refreshInbox()`, which is one
 * targeted server action rather than a `router.refresh()` of the whole RSC tree.
 *
 * WHY THE AUTHORITATIVE RE-READ RATHER THAN PATCHING FROM THE EVENT. Patching a
 * preview line straight from `payload.new` looks cheaper, and for a plain text
 * message it would be. It is not safe in general here: an inbox row's preview
 * depends on `deleted_at`, `hidden`, attachment type and the anonymity masking
 * in `community_chat_view`, and its unread count depends on rows this event
 * says nothing about. An event-derived patch would therefore be right most of
 * the time and quietly wrong for moderated, deleted, anonymous and attachment
 * messages. The debounced read is ~350ms slower and always correct, and
 * correctness is the thing this work is for. (The optimistic path that DOES
 * exist is in the thread itself, where the send action returns the row.)
 */

/** Coalescing window for a burst of related events. */
const DEBOUNCE_MS = 350;

export function InboxRealtime({ userId }: { userId: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const queued = useRef(false);

  /**
   * Read the inbox and publish it.
   *
   * Guarded against overlap: two reads in flight together would race to write
   * the store, and the loser could be the newer one. Instead a request arriving
   * mid-read is remembered and replayed exactly once, which also collapses a
   * long burst into two reads in total.
   *
   * A FAILED READ IS NOT SWALLOWED. The last good snapshot stays on screen —
   * an inbox one message behind beats an inbox showing an error — but the
   * failure is reported (statuses only, never rows or ids), and every recovery
   * trigger the channel has (resubscribe, focus, online, poll) tries again.
   */
  const readInbox = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      // Loop rather than recurse: one more pass covers everything that arrived
      // while the previous read was out.
      do {
        queued.current = false;
        try {
          setInboxSnapshot(await refreshInbox());
        } catch {
          reportRealtimeIssue({ label: "chat inbox", status: "REFRESH_FAILED" });
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
    // Fires on first subscribe, on every recovery from CHANNEL_ERROR/TIMED_OUT/
    // CLOSED, on focus/visibility resume, on `online`, and from the polling
    // fallback — the moments where events may have been missed. Immediate, not
    // debounced: there is no burst to coalesce, just a gap to close.
    onCatchUp: () => void readInbox(),
    build: (channel) =>
      channel
        // RLS on postgres_changes already scopes delivery to rows this user can
        // select (their own conversations/messages/requests), so no per-row
        // filter is needed. Kept broad for `community_chat_messages` too: a
        // filter would be one `.on()` per room and would go deaf to being ADDED
        // to a room, which is exactly when the inbox must update.
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

  // A push arriving means the app was very likely backgrounded, so the socket
  // was not there to receive the INSERT. Re-read on the way back rather than
  // waiting for the next event.
  usePushSignal(() => void readInbox());

  // The store belongs to ONE account. Claiming it drops any snapshot left by a
  // previous session in this tab before a single frame can render it, and the
  // teardown clears it again on sign-out or a viewer change.
  useEffect(() => {
    claimInboxStore(userId);
    return () => clearInboxSnapshot();
  }, [userId]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return null;
}
