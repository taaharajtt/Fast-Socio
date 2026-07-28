"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RequestRow } from "@/components/chat/request-row";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import { GlassChip } from "@/components/ui";
import { OnlineDot } from "@/components/ui/badges";
import { communityIcon } from "@/lib/communities/icon";
import { createClient } from "@/lib/supabase/client";
import { refreshInbox } from "@/app/(student)/chat/actions";
import { EPOCH, type InboxData } from "@/lib/chat/inbox-types";
import { cn } from "@/lib/utils";
import { isOnline, timeAgo } from "@/lib/time";

/**
 * The inbox itself: new matches, then one recency-sorted list of direct threads
 * and community rooms — plus the pending-requests panel.
 *
 * It owns its data. The page hands it a server-rendered snapshot; from then on
 * realtime events cause it to re-read JUST the inbox (the `refreshInbox` server
 * action) and swap this component's state. Previously an `InboxRealtime` island
 * called `router.refresh()` on every message, conversation, request and room
 * event, which re-rendered the whole server tree — layout, dock, badges and
 * page — to change one preview line, and did so repeatedly while a conversation
 * was active.
 */
export function InboxList({
  initial,
  showRequests,
}: {
  initial: InboxData;
  /** Which panel of the Messages · Requests pair is showing. */
  showRequests: boolean;
}) {
  const [data, setData] = useState(initial);
  const [lastServerData, setLastServerData] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  // A fresh server render (navigating back to /chat) is newer than whatever we
  // last fetched, so it wins. Applied during render rather than in an effect,
  // so the new rows are in the first commit instead of a second one.
  if (lastServerData !== initial) {
    setLastServerData(initial);
    setData(initial);
  }

  const { me, threads, newMatches, profiles, incoming } = data;

  useEffect(() => {
    const supabase = createClient();

    // Coalesce a burst of events (a message insert alongside the
    // conversations.last_message_at trigger update, say) into one re-read.
    const scheduleRefresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        refreshInbox().then(setData, () => {});
      }, 350);
    };

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) supabase.realtime.setAuth(session.access_token);

      const channel = supabase
        .channel(`chat-inbox:${me}`)
        // RLS on postgres_changes already scopes delivery to rows this user can
        // select (their own conversations/messages/requests), so no per-row
        // filter is needed here.
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
      if (timer.current) clearTimeout(timer.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [me]);

  if (showRequests) {
    return (
      <div className="mt-5 space-y-3">
        {incoming.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg-muted">
            No pending requests.
          </p>
        ) : (
          incoming.map((r) => <RequestRow key={r.id} request={r} />)
        )}
      </div>
    );
  }

  return (
    <div className="mt-5">
      {threads.length === 0 && newMatches.length === 0 ? (
        <p className="py-16 text-center text-sm text-fg-muted">
          No conversations yet. Match in Discover to start chatting.
        </p>
      ) : (
        // Flat rows separated by a thin hairline (chat refresh).
        <div className="divide-y divide-white/[0.05]">
          {/* Fresh matches (no conversation yet) sit at the TOP so a new match
              is the first thing seen, not buried under older threads. */}
          {newMatches.map((otherId) => {
            const p = profiles[otherId];
            return (
              <div key={`nm:${otherId}`} className="flex items-center gap-3 py-3.5">
                <Link
                  href={`/profile/${otherId}`}
                  className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-card"
                >
                  {resolveAvatarUrl(p?.avatar_url, p?.gender) && (
                    <AppImage
                      src={resolveAvatarUrl(p?.avatar_url, p?.gender)!}
                      alt={p?.full_name ?? "Match"}
                      sizes="44px"
                    />
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-fg">
                    {p?.full_name ?? "Student"}
                  </p>
                  <p className="truncate text-sm text-accent">New match ✨</p>
                </div>
                <OpenChatButton otherId={otherId} />
              </div>
            );
          })}

          {threads.map((t) => {
            if (t.kind === "space") {
              const image = t.space.avatar_url ?? t.space.cover_url;
              return (
                <Link
                  key={`sp:${t.space.id}`}
                  href={`/chat/c/${t.space.id}`}
                  className="flex items-center gap-3 py-3.5 transition-transform active:scale-[0.99]"
                >
                  <div className="relative h-11 w-11 shrink-0 rounded-full">
                    <div className="glass relative flex h-full w-full items-center justify-center overflow-hidden rounded-full">
                      {image ? (
                        <AppImage src={image} alt="" sizes="44px" />
                      ) : (
                        <span className="text-lg" aria-hidden>
                          {communityIcon(t.space.name)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5">
                      {/* The capsule is what separates a room from a person;
                          everything else about the row is identical. */}
                      <GlassChip className="shrink-0 px-2 py-0.5 text-[10px]">
                        Community
                      </GlassChip>
                      <span className="truncate text-[15px] font-semibold text-fg">
                        {t.space.name}
                      </span>
                    </p>
                    <p className="truncate text-sm text-fg-muted">
                      {t.preview ?? "No messages yet"}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1 self-start">
                    {t.ts !== EPOCH && (
                      <span className="text-xs text-fg-muted">{timeAgo(t.ts)}</span>
                    )}
                  </span>
                </Link>
              );
            }

            const p = profiles[t.otherId];
            const hasUnread = t.unread > 0;
            return (
              <Link
                key={t.convId}
                href={`/chat/${t.convId}`}
                className={cn(
                  "flex items-center gap-3 py-3.5 transition-transform active:scale-[0.99]",
                  // A thread with unread messages gets a faint tint (plus the
                  // bold preview + count badge below) so it reads apart from
                  // already-seen conversations at a glance.
                  hasUnread && "-mx-2 rounded-[12px] bg-accent/[0.06] px-2"
                )}
              >
                <div className="relative h-11 w-11 shrink-0 rounded-full">
                  <div className="relative h-full w-full overflow-hidden rounded-full bg-card">
                    {p?.avatar_url && (
                      <AppImage
                        src={p.avatar_url}
                        alt={p.full_name ?? "Match"}
                        sizes="44px"
                      />
                    )}
                  </div>
                  {isOnline(p?.last_seen_at) && <OnlineDot />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-fg">
                    {p?.full_name ?? "Student"}
                  </p>
                  <p
                    className={cn(
                      "truncate text-sm",
                      hasUnread ? "font-semibold text-fg" : "text-fg-muted"
                    )}
                  >
                    {t.preview ?? "Say hi 👋"}
                  </p>
                </div>
                <span className="flex shrink-0 flex-col items-end gap-1 self-start">
                  <span
                    className={cn(
                      "text-xs",
                      hasUnread ? "font-semibold text-accent" : "text-fg-muted"
                    )}
                  >
                    {timeAgo(t.ts)}
                  </span>
                  {hasUnread && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">
                      {t.unread > 99 ? "99+" : t.unread}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
