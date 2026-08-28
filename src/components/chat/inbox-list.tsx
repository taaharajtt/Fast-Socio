"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { RequestRow } from "@/components/chat/request-row";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import { OnlineDot, UnreadBadge } from "@/components/ui/badges";
import { discoverGroupLabel } from "@/lib/discover/group-label";
import { DiscoverGroupAvatar } from "@/components/discover/discover-group-avatar";
import { createClient } from "@/lib/supabase/client";
import { refreshInbox, openConversation } from "@/app/(student)/chat/actions";
import { EPOCH, type InboxData, type InboxProfile } from "@/lib/chat/inbox-types";
import { cn } from "@/lib/utils";
import { isOnline, timeAgo } from "@/lib/time";

/**
 * The inbox itself. Two panels, and the split between them is about whether a
 * conversation EXISTS:
 *
 *  - Messages holds started direct conversations, plus Discover team rooms —
 *    the one group conversation with no room page of its own to live on.
 *    Community chat rooms and verified communities are gone from here; their
 *    chat lives inside the room.
 *  - Requests holds everything waiting to become a conversation: pending
 *    incoming message requests, and matches nobody has written to yet.
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
        // Kept BROAD rather than filtered to this viewer's Discover rooms.
        // postgres_changes filters are a single `column=eq.value`, so scoping
        // would mean one `.on()` per room and re-subscribing the channel every
        // time the room set changed — and it would go deaf to being ADDED to a
        // new room, which is exactly when the inbox must update. RLS already
        // limits delivery to rooms this user is a member of, and a message in a
        // community room the inbox no longer lists costs one wasted re-read
        // that recomputes to the same list.
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
    // Everything that is not yet a conversation. Pending message requests need
    // a decision, so they come first; new matches sit under them as plain
    // tappable rows.
    if (incoming.length === 0 && newMatches.length === 0) {
      return (
        <p className="py-16 text-center text-sm text-fg-muted">
          No pending requests.
        </p>
      );
    }
    return (
      <div className="mt-5">
        {incoming.length > 0 && (
          <div className="space-y-3">
            {incoming.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </div>
        )}
        {newMatches.length > 0 && (
          <div className={incoming.length > 0 ? "mt-5" : undefined}>
            {newMatches.map((otherId) => (
              <NewMatchRow
                key={`nm:${otherId}`}
                otherId={otherId}
                profile={profiles[otherId]}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-5">
      {threads.length === 0 ? (
        <p className="py-16 text-center text-sm text-fg-muted">
          No conversations yet. Match in Discover to start chatting.
        </p>
      ) : (
        <div>
          {threads.map((t) => {
            if (t.kind === "space") {
              const image = t.space.avatar_url ?? t.space.cover_url;
              return (
                <Link
                  key={`sp:${t.space.id}`}
                  href={`/chat/c/${t.space.id}`}
                  prefetch={false}
                  className="pressable-subtle focus-ring -mx-2 flex items-center gap-3.5 rounded-[10px] px-2 py-3.5"
                >
                  <div className="relative h-12 w-12 shrink-0 rounded-full">
                    {/* The brand gradient is what separates a Discover team
                        room from a person at a glance — it sits on the AVATAR,
                        not on a coloured capsule. */}
                    <div className="glass relative flex h-full w-full items-center justify-center overflow-hidden rounded-full">
                      <DiscoverGroupAvatar sizes="48px" />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1.5">
                      {/* `name` is the title the author chose when the team
                          formed (mig 0129 falls back to the post's title).
                          The capsule always sits to its right, pinned and
                          non-shrinking, so a long name truncates first. */}
                      <span className="type-headline min-w-0 flex-1 truncate text-fg">
                        {t.space.name}
                      </span>
                      {/* A type label, not a state: it says what KIND of thread
                          this is, which never changes. Deliberately neutral —
                          filled purple made every room in the list look
                          permanently notable. */}
                      <span className="type-footnote shrink-0 rounded-full bg-fill px-2 py-0.5 font-semibold text-fg-muted">
                        {discoverGroupLabel(t.space.discover_mode)}
                      </span>
                    </p>
                    <p className="type-callout truncate text-fg-muted">
                      {t.preview ?? "No messages yet"}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1 self-start">
                    {t.ts !== EPOCH && (
                      <span className="type-caption text-fg-muted">{timeAgo(t.ts)}</span>
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
                prefetch={false}
                className={cn(
                  "pressable-subtle focus-ring -mx-2 flex items-center gap-3.5",
                  "rounded-[10px] px-2 py-3.5"
                  // Unread is NOT a tinted row. A purple wash across a whole
                  // conversation coloured the person, not the state, and on a
                  // busy inbox it turned the list into stripes. The bold
                  // preview text and the small count badge below already say
                  // it, and both survive the grayscale test.
                )}
              >
                <div className="relative h-12 w-12 shrink-0 rounded-full">
                  <div className="relative h-full w-full overflow-hidden rounded-full bg-card">
                    {resolveAvatarUrl(p?.avatar_url, p?.gender) && (
                      <AppImage
                        src={resolveAvatarUrl(p?.avatar_url, p?.gender)!}
                        alt={p?.full_name ?? "Match"}
                        sizes="48px"
                      />
                    )}
                  </div>
                  {isOnline(p?.last_seen_at) && <OnlineDot />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="type-headline truncate text-fg">
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
                      "type-caption",
                      hasUnread ? "font-semibold text-fg" : "text-fg-subtle"
                    )}
                  >
                    {timeAgo(t.ts)}
                  </span>
                  {/* The shared badge, not a local copy of it — the row stays
                      neutral and the count is the only purple thing on it. */}
                  <UnreadBadge count={t.unread} />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A fresh match with no conversation yet — a Requests row. The row itself opens
 * (or creates) the conversation — there is no separate "Message" button, so the person and
 * their name are the only things competing for attention, matching every
 * other row in this list (a DM row is likewise one big tap target).
 *
 * This has to be a `<button>`, not a `<Link>`: opening a match's first
 * conversation calls a server action that creates the row before redirecting,
 * so there is no URL to point a plain link at. The avatar is a bare `<span>`
 * rather than its own nested link, since a link inside a button is invalid
 * HTML and would give the row two competing tap targets.
 */
function NewMatchRow({
  otherId,
  profile,
}: {
  otherId: string;
  profile: InboxProfile | undefined;
}) {
  const [pending, start] = useTransition();
  const avatarSrc = resolveAvatarUrl(profile?.avatar_url, profile?.gender);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await openConversation(otherId);
        })
      }
      className="pressable-subtle focus-ring -mx-2 flex w-full items-center gap-3.5 rounded-[10px] px-2 py-3.5 text-left disabled:opacity-60"
    >
      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-card">
        {avatarSrc && (
          <AppImage src={avatarSrc} alt={profile?.full_name ?? "Match"} sizes="48px" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="type-headline block truncate text-fg">
          {profile?.full_name ?? "Student"}
        </span>
        <span className="type-callout block truncate text-fg-muted">
          {pending ? "Opening…" : "New match"}
        </span>
      </span>
    </button>
  );
}
