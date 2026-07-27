"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps /chat live without a reload. The inbox itself (page.tsx) is a server
 * component reading conversations/messages/requests/community rooms in one
 * shot for RLS-correctness and simplicity — rather than duplicate that fan-out
 * of queries on the client, this just listens for the tables that feed it and
 * asks the router to refetch the server payload when something changes.
 * Renders nothing.
 */
export function InboxRealtime({ userId }: { userId: string }) {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  useEffect(() => {
    const supabase = createClient();
    // Coalesce a burst of events (e.g. a message insert alongside the
    // conversations.last_message_at trigger update) into one refresh.
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 350);
    };

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) supabase.realtime.setAuth(session.access_token);

      const channel = supabase
        .channel(`chat-inbox:${userId}`)
        // RLS on postgres_changes already scopes delivery to rows this user
        // can select (their own conversations/messages/requests), so no
        // per-row filter is needed here.
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages" },
          scheduleRefresh
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "conversations" },
          scheduleRefresh
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "message_requests" },
          scheduleRefresh
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "community_chat_messages" },
          scheduleRefresh
        )
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || err) {
            console.error("[chat] inbox realtime subscription failed", status, err);
          }
        });

      channelRef.current = channel;
    })();

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [userId, router]);

  return null;
}
