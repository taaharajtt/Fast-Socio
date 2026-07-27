"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { setChatBadge } from "@/lib/chat/badge-store";

/**
 * Keeps the dock's chat badge (unread DMs + pending requests) live on every
 * student screen, not just after a navigation.
 *
 * This used to call `router.refresh()` on every message/request event, which
 * re-rendered the whole server tree for the current route to update one number.
 * Now it re-runs just the two count queries itself and pushes the result into
 * the badge store, so a burst of messages costs two `head: true` counts and a
 * single dock re-render instead of a full RSC round trip per event.
 *
 * RLS scopes both counts to the caller exactly as it did server-side, so the
 * number can't differ from what the server would have computed.
 */
export function DockRealtime({
  userId,
  initialBadge,
}: {
  userId: string;
  /** The count the server rendered with, so a recount that returns the same
   *  value doesn't cause a pointless re-render. */
  initialBadge?: number;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  // The store outlives any single render (it is module state), so re-seed it
  // whenever the server hands us a freshly computed count. Otherwise a stale
  // realtime value from an earlier session would keep overriding the server's.
  useEffect(() => {
    if (initialBadge !== undefined) setChatBadge(initialBadge);
  }, [initialBadge]);

  useEffect(() => {
    const supabase = createClient();

    async function recount() {
      const [{ count: unread }, { count: pending }] = await Promise.all([
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .neq("sender_id", userId)
          .is("read_at", null),
        supabase
          .from("message_requests")
          .select("id", { count: "exact", head: true })
          .eq("recipient_id", userId)
          .eq("status", "pending"),
      ]);
      setChatBadge((unread ?? 0) + (pending ?? 0));
    }

    // Coalesce a burst of events (a message insert plus the conversations
    // trigger update, say) into one recount.
    const scheduleRecount = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void recount();
      }, 350);
    };

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) supabase.realtime.setAuth(session.access_token);

      const channel = supabase
        .channel(`chat-dock:${userId}`)
        // RLS scopes delivery to messages/requests this user can see, so an
        // unfiltered subscription only ever carries rows relevant to them.
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages" },
          scheduleRecount
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "message_requests" },
          scheduleRecount
        )
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || err) {
            console.error("[chat] dock realtime subscription failed", status, err);
          }
        });

      channelRef.current = channel;
    })();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [userId]);

  return null;
}
