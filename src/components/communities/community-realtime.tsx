"use client";

import { useCallback, useEffect, useRef } from "react";
import { refreshCommunityBadge } from "@/app/(student)/communities/updates/actions";
import {
  clearCommunityBadge,
  setCommunityBadge,
} from "@/lib/community/badge-store";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime-channel";
import { reportRealtimeIssue } from "@/lib/realtime/telemetry";
import { usePushSignal } from "@/lib/push/use-push-signal";

/**
 * Keeps the dock's Community badge live, from the student shell, on every
 * screen.
 *
 * ONE subscription, on ONE table. Not one per update type, not one per
 * community, not one per row: every Community update is a `notifications` row,
 * so a single `event: "*"` handler covers an announcement arriving, a join
 * request being decided by someone else, a read from another device, and a
 * subject being deleted. Migration 0183 puts `notifications` back in the
 * realtime publication for exactly this listener and documents the cost.
 *
 * NO FILTER, and none is needed: `postgres_changes` evaluates RLS per
 * subscriber, and the policy on `notifications` is `user_id = auth.uid()`, so
 * this socket only ever receives this student's own rows. A `filter:` would
 * duplicate that check without adding a boundary.
 *
 * IT NEVER COUNTS THE EVENT. Every wake-up ends in one call to
 * `refreshCommunityBadge()`, which returns `community_badge_count()` — the same
 * function the server rendered with. Patching the number from the payload would
 * be wrong in both directions: an INSERT may be for a type that is not a
 * Community update at all (a like, a DM), and an update can STOP counting
 * without any row changing here — another manager resolves the join request,
 * the reader loses an officer role, the subject is deleted. None of those emit
 * an event this client could subtract from. Reconciling on the authoritative
 * count is the only version that converges, and it costs one debounced round
 * trip per burst.
 *
 * WHY IT IS NOT FOLDED INTO <ChatRealtime/>: that listener's whole job is to
 * read the inbox and derive the chat badge from it. This one shares no data,
 * no debounce window and no failure mode with it, and merging them would mean
 * every inbound DM recomputed the Community badge and every announcement
 * refetched the inbox. Two islands, one subscription each.
 */

/** Coalescing window for a burst of related events. */
const DEBOUNCE_MS = 350;

export function CommunityRealtime({
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

  // The store is module state and outlives any single render, so re-seed it
  // whenever the server hands us a freshly computed count — otherwise a stale
  // value from an earlier session would keep overriding the server's.
  useEffect(() => {
    if (initialBadge !== undefined) setCommunityBadge(initialBadge);
  }, [initialBadge]);

  /**
   * Read the authoritative count once. Guarded against overlap so two reads in
   * flight cannot race to write the store with the loser being the newer one; a
   * request arriving mid-read is replayed exactly once afterwards.
   *
   * A failed read leaves the last good number on screen and is reported
   * (statuses only, never rows or ids). Every recovery trigger the channel has
   * — resubscribe, focus, online, poll — tries again.
   */
  const readBadge = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        queued.current = false;
        try {
          setCommunityBadge(await refreshCommunityBadge());
        } catch {
          reportRealtimeIssue({
            label: "community badge",
            status: "REFRESH_FAILED",
          });
          break;
        }
      } while (queued.current);
    } finally {
      inFlight.current = false;
    }
  }, []);

  const scheduleRead = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void readBadge(), DEBOUNCE_MS);
  }, [readBadge]);

  useRealtimeChannel({
    name: `community:${userId}`,
    label: "community",
    // Fires on first subscribe, on every recovery, on focus/visibility resume,
    // on `online`, and from the polling fallback — the moments where events may
    // have been missed and the badge could be stale.
    onCatchUp: () => void readBadge(),
    build: (channel) =>
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        scheduleRead
      ),
  });

  // A push arriving means the app was very likely backgrounded, so the socket
  // was not there to receive the INSERT.
  usePushSignal(() => void readBadge());

  // The store belongs to ONE account: clear it on sign-out or a viewer change
  // so a previous session's number cannot render for the next one.
  useEffect(() => {
    return () => clearCommunityBadge();
  }, [userId]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return null;
}
