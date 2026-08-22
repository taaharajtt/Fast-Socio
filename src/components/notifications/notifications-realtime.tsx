"use client";

import { useCallback, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchActivityUnread } from "@/lib/notifications/count";
import { setActivityBadge } from "@/lib/notifications/badge-store";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime-channel";
import { usePushSignal } from "@/lib/push/use-push-signal";

/**
 * Keeps the Activity bell live on every student screen.
 *
 * Two independent signals feed it, because neither alone is sufficient on a
 * phone:
 *
 *  1. REALTIME. `notifications` INSERT/UPDATE filtered to this viewer. Works
 *     whenever the app is in the foreground with a live socket.
 *  2. PUSH. When the app is backgrounded (or on iOS, where the socket is
 *     killed outright) the only thing that still runs is the service worker.
 *     push-sw.js now `postMessage`s every open client on receipt, so bringing
 *     the app back to the foreground finds a badge that already agrees with the
 *     notification the user just tapped through from — instead of the OS tray
 *     saying "3 new" over a UI that still shows none.
 *
 * The UPDATE subscription matters as much as INSERT: `markActivityRead()` sets
 * `read_at` on the whole batch, and without it the bell would keep its dot
 * until a navigation re-rendered the header.
 */
export function NotificationsRealtime({ userId }: { userId: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recount = useCallback(async () => {
    const supabase = createClient();
    try {
      setActivityBadge(await fetchActivityUnread(supabase, userId));
    } catch {
      // Leave the last known value: a badge is decoration and must never take
      // down the shell it renders inside.
    }
  }, [userId]);

  // A batch mark-read arrives as many UPDATEs at once; coalesce them.
  const scheduleRecount = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void recount(), 350);
  }, [recount]);

  useRealtimeChannel({
    name: `notifications:${userId}`,
    label: "notifications",
    onCatchUp: () => void recount(),
    build: (channel) =>
      channel
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          scheduleRecount
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          scheduleRecount
        ),
  });

  // Service-worker push → in-app recount (signal 2 above).
  usePushSignal(() => void recount());

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return null;
}
