"use client";

import { useCallback, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { setChatBadge } from "@/lib/chat/badge-store";
import { fetchChatBadge } from "@/lib/chat/badge-count";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime-channel";
import { usePushSignal } from "@/lib/push/use-push-signal";

/**
 * Keeps the dock's chat badge (unread DMs + pending requests) live on every
 * student screen, not just after a navigation.
 *
 * This used to call `router.refresh()` on every message/request event, which
 * re-rendered the whole server tree for the current route to update one number.
 * It then re-ran two count queries itself; it now makes ONE `chat_badge_count()`
 * RPC call (migration 0166), which is driven from the caller's conversations
 * instead of scanning `messages` and letting RLS filter the result.
 *
 * The recount is scoped by `auth.uid()` inside the function, so the number can't
 * differ from what the server would have computed.
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
  // The store outlives any single render (it is module state), so re-seed it
  // whenever the server hands us a freshly computed count. Otherwise a stale
  // realtime value from an earlier session would keep overriding the server's.
  useEffect(() => {
    if (initialBadge !== undefined) setChatBadge(initialBadge);
  }, [initialBadge]);

  const recount = useCallback(async () => {
    const badge = await fetchChatBadge(createClient(), userId);
    setChatBadge(badge.total);
  }, [userId]);

  // Coalesce a burst of events (a message INSERT plus the conversations trigger
  // UPDATE plus a read receipt, say) into one recount.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRecount = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void recount(), 350);
  }, [recount]);
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useRealtimeChannel({
    name: `chat-dock:${userId}`,
    label: "chat dock",
    // On (re)subscribe, focus/visibility resume, `online`, and from the polling
    // fallback. A badge that is silently one behind is the most visible symptom
    // of a dropped event, so it recounts at every recovery point.
    onCatchUp: () => void recount(),
    build: (channel) =>
      channel
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
        ),
  });

  // A push means the app was almost certainly backgrounded, so the socket was
  // not there to receive the INSERT that should have moved this number.
  usePushSignal(() => void recount());

  return null;
}
