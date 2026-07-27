"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The dock's chat badge (unread DMs + pending requests, computed in
 * DockWithBadges) lives in the student layout, so it only ever refreshed on
 * navigation. This mounts alongside the dock on every student screen and asks
 * the router to refetch when a message or request changes, so the badge count
 * updates live no matter which page the student is on.
 */
export function DockRealtime({ userId }: { userId: string }) {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  useEffect(() => {
    const supabase = createClient();
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
        .channel(`chat-dock:${userId}`)
        // RLS scopes delivery to messages/requests this user can see, so an
        // unfiltered subscription only ever carries rows relevant to them.
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages" },
          scheduleRefresh
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "message_requests" },
          scheduleRefresh
        )
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || err) {
            console.error("[chat] dock realtime subscription failed", status, err);
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
