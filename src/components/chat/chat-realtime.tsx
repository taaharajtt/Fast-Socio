"use client";

import { useCallback, useEffect, useRef } from "react";
import { refreshInbox } from "@/app/(student)/chat/actions";
import {
  claimInboxStore,
  clearInboxSnapshot,
  setInboxSnapshot,
} from "@/lib/chat/inbox-store";
import { setChatBadge } from "@/lib/chat/badge-store";
import { deriveChatBadge } from "@/lib/chat/badge-count";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime-channel";
import { reportRealtimeIssue } from "@/lib/realtime/telemetry";
import { usePushSignal } from "@/lib/push/use-push-signal";

/**
 * The signed-in student's ONE realtime listener, mounted from the student
 * layout so it stays alive on every screen — crucially, including inside
 * /chat/[id].
 *
 * That relocation (from <InboxList/>, which only exists while /chat is on
 * screen) is what fixed the original bug: tapping a conversation used to remove
 * the channel, so a message arriving while you were reading was delivered to
 * nothing, and `postgres_changes` cannot replay it afterwards.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE COMPONENT AND NOT TWO (perf audit Phase 3a)
 *
 * This replaces <DockRealtime/> and <InboxRealtime/>, which were both mounted
 * in the layout, both subscribed, and overlapped almost exactly:
 *
 *     DockRealtime    messages(*)  message_requests(*)
 *     InboxRealtime   messages(*)  message_requests(*)  conversations(*)
 *                     community_chat_messages(INSERT)
 *
 * So every signed-in student opened SIX postgres_changes subscriptions, two of
 * them exact duplicates, and every inbound message did TWO server round trips
 * per open tab — `refreshInbox()` for the list and `chat_badge_count()` for the
 * number — to render two things that are functions of the same rows.
 *
 * The merge is still worth it on its own terms — half the server round trips
 * per inbound message, and two fewer sockets per student — but the DATABASE
 * saving originally claimed for it was overstated, and the correction is worth
 * stating plainly because it is the same mistake this audit kept making.
 *
 * The claim was that `postgres_changes` evaluates RLS once per subscriber per
 * published write, so cost is `write rate x subscription count` and cutting
 * six subscriptions to four takes a third off it. The first half is true; the
 * conclusion is not. Measured afterwards, the per-subscriber term is only
 * about 5% of `realtime.apply_rls` — the rest is a fixed poll that runs with
 * nobody connected. See the Broadcast evaluation below for the numbers.
 *
 * So: fewer round trips, yes; a third off 57% of the database, no.
 *
 * ---------------------------------------------------------------------------
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
 *
 * ONE FAILURE MODE IS NEW AND IS ACCEPTED KNOWINGLY. The dock badge used to be
 * recounted by its own RPC, so it could still update when the inbox read
 * failed. Now a failed read leaves both stale. That is the right trade: the two
 * numbers can no longer disagree with each other, a stale badge is strictly
 * better than a badge that contradicts the list under it, the failure is
 * reported, and every recovery trigger the channel has — resubscribe, focus,
 * online, poll — retries it.
 */

/*
 * ---------------------------------------------------------------------------
 * WHY THIS STILL USES `postgres_changes` AND NOT PRIVATE BROADCAST
 *
 * Replacing these subscriptions with Supabase's private Broadcast (a trigger
 * calling `realtime.send()` onto a per-conversation topic) was evaluated and
 * REJECTED on measurement. Do not re-open it without new numbers.
 *
 * The case for Broadcast rests on `postgres_changes` evaluating RLS once per
 * subscriber per published write, so that cost should scale with concurrency.
 * On this database it does not, and the reason is that almost all of the cost
 * is not per-subscriber at all.
 *
 * `realtime.apply_rls` is 57% of total database time (pg_stat_statements,
 * 20-day window). Split across two windows on the same instance:
 *
 *     window            subscribers   call rate      mean cost
 *     idle              0             6,917 / hour   7.93 ms
 *     real traffic      up to 13      6,920 / hour   8.34 ms
 *
 * The CALL RATE IS FLAT — 0.04% apart with nobody connected versus thirteen
 * live subscriptions. That is a timer-driven poll of the replication slot
 * (roughly one every 520ms), and it runs whether the app has users on it or
 * not. Only the ~5% rise in mean cost is per-subscriber work.
 *
 * So Broadcast would recover about 5% of 57% — call it 3% of database CPU —
 * in exchange for the highest-risk change available here: moving authorization
 * onto channel topics, which makes a topic name a security boundary and a
 * loose policy on `realtime.messages` a cross-conversation message leak. It
 * would also need new triggers, its own dedup, and it still could not replace
 * the catch-up reads, because Broadcast has no durable replay either.
 *
 * Bad trade. The lever that WOULD move the 57% is the poll interval or the
 * instance size, and both live on Supabase's side of the boundary, not in this
 * repo.
 *
 * FOR THE SAME REASON, the subscription count here is not worth shaving. The
 * chat thread opens a separate subscription for `messages` INSERT and UPDATE,
 * and merging them into one `event: "*"` handler would remove one of the eight
 * or nine a student holds with a thread open — about 0.4% of database CPU,
 * bought by rewriting the optimistic-reconciliation path. Not worth touching
 * chat correctness for.
 *
 * Re-measure with:
 *
 *   select (select count(*) from realtime.subscription) as subs,
 *          sum(calls), sum(total_exec_time)/sum(calls) as mean_ms
 *     from pg_stat_statements where query like '%wal->>%';
 *
 * taken twice, at different concurrency, and compare the call RATE between the
 * two. If the rate ever starts tracking concurrency, this conclusion is stale.
 * ---------------------------------------------------------------------------
 */

/** Coalescing window for a burst of related events. */
const DEBOUNCE_MS = 350;

export function ChatRealtime({
  userId,
  initialBadge,
}: {
  userId: string;
  /** The count the server rendered with, so a recount that returns the same
   *  value doesn't cause a pointless re-render. */
  initialBadge?: number;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const queued = useRef(false);

  // The store outlives any single render (it is module state), so re-seed it
  // whenever the server hands us a freshly computed count. Otherwise a stale
  // realtime value from an earlier session would keep overriding the server's.
  useEffect(() => {
    if (initialBadge !== undefined) setChatBadge(initialBadge);
  }, [initialBadge]);

  /**
   * Read the inbox once and publish BOTH things that depend on it.
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
          const data = await refreshInbox();
          setInboxSnapshot(data);
          // Derived, not fetched. `deriveChatBadge` is exact rather than an
          // approximation — see the note on it for the three properties of
          // loadInbox() that make it so, and migration 0176 for why the two
          // SQL definitions of "unread" had to be reconciled first.
          //
          // Ordered AFTER the snapshot deliberately: both stores notify
          // synchronously, and publishing a badge that the list has not caught
          // up to yet is the one visibly-wrong intermediate state available.
          setChatBadge(deriveChatBadge(data).total);
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
    name: `chat:${userId}`,
    label: "chat",
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
