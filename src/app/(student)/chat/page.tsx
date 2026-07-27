import Link from "next/link";
import { RequestRow, type IncomingRequest } from "@/components/chat/request-row";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { ChatCommunityTabs } from "@/components/chat/chat-community-tabs";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { AppImage } from "@/components/ui/app-image";
import { GlassChip } from "@/components/ui";
import { OnlineDot } from "@/components/ui/badges";
import { communityIcon } from "@/lib/communities/icon";
import { cn } from "@/lib/utils";
import { isOnline, timeAgo } from "@/lib/time";

type ProfileLite = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  department: string | null;
  last_seen_at: string | null;
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showRequests = view === "requests";

  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip; RLS is authoritative.
  const me = (await getAuthUserId())!;

  const [
    { data: convRows },
    { data: reqRows },
    { data: matchRows },
    { data: outgoingReqRows },
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, user_low, user_high, last_message_at")
      .or(`user_low.eq.${me},user_high.eq.${me}`)
      .order("last_message_at", { ascending: false }),
    supabase
      .from("message_requests")
      .select("id, message, sender_id, created_at")
      .eq("recipient_id", me)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("matches")
      .select("id, user_low, user_high, created_at")
      .or(`user_low.eq.${me},user_high.eq.${me}`)
      .order("created_at", { ascending: false }),
    // Requests WE sent (UAT-018): once we've initiated a conversation with a
    // match, they should drop out of the "new matches" list.
    supabase
      .from("message_requests")
      .select("recipient_id")
      .eq("sender_id", me),
  ]);

  // Community rooms you've been approved into are conversations too, so they
  // belong in this inbox rather than behind the Community tab. Owned spaces are
  // unioned in because an owner participates without necessarily holding a
  // community_members row.
  const [{ data: joinedRows }, { data: ownedRows }] = await Promise.all([
    supabase
      .from("community_members")
      .select(
        "community:communities(id, name, avatar_url, cover_url, is_society, status)"
      )
      .eq("user_id", me),
    supabase
      .from("communities")
      .select("id, name, avatar_url, cover_url, is_society, status")
      .eq("owner_id", me),
  ]);

  type SpaceLite = {
    id: string;
    name: string;
    avatar_url: string | null;
    cover_url: string | null;
    is_society: boolean;
    status: string;
  };
  const spaces = new Map<string, SpaceLite>();
  for (const r of (joinedRows ?? []) as unknown as { community: SpaceLite | null }[]) {
    if (r.community?.status === "approved") spaces.set(r.community.id, r.community);
  }
  for (const c of ((ownedRows ?? []) as unknown as SpaceLite[])) {
    if (c.status === "approved") spaces.set(c.id, c);
  }
  const spaceIds = [...spaces.keys()];

  // Newest message per room, for the row preview and the recency sort. Read
  // through community_chat_view so an anonymous sender stays masked here too.
  const spacePreview = new Map<string, { text: string; ts: string }>();
  if (spaceIds.length > 0) {
    const { data: roomMsgs } = await supabase
      .from("community_chat_view")
      .select("community_id, sender_id, sender_name, body, is_anonymous, created_at")
      .in("community_id", spaceIds)
      .order("created_at", { ascending: false })
      .limit(400);
    for (const m of roomMsgs ?? []) {
      if (spacePreview.has(m.community_id)) continue;
      const who = m.is_anonymous
        ? m.sender_id === me
          ? "You (anonymous)"
          : "Anonymous"
        : m.sender_id === me
          ? "You"
          : (m.sender_name ?? "Member");
      spacePreview.set(m.community_id, {
        text: `${who}: ${m.body || "Shared a poll"}`,
        ts: m.created_at,
      });
    }
  }

  const conversations = convRows ?? [];
  const requests = reqRows ?? [];
  const matches = matchRows ?? [];

  // Latest message per conversation → row preview text.
  const convIds = conversations.map((c) => c.id);
  const lastMsg = new Map<string, string>();
  if (convIds.length > 0) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("conversation_id, body, sender_id, created_at, deleted_at")
      .in("conversation_id", convIds)
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(300);
    for (const m of msgs ?? []) {
      if (lastMsg.has(m.conversation_id)) continue;
      const prefix = m.sender_id === me ? "You: " : "";
      // A deleted message keeps its row (read receipts reference it) but its
      // body is blanked, so it must not preview as an empty line (UAT-009).
      const text = m.deleted_at
        ? "Message deleted"
        : (m.body || "Sent an attachment");
      lastMsg.set(m.conversation_id, `${prefix}${text}`);
    }
  }

  // Unread count per conversation: incoming messages the viewer hasn't read.
  // Queried separately (not from the 300-row preview page) so the count is exact
  // even in a very busy thread.
  const unread = new Map<string, number>();
  if (convIds.length > 0) {
    const { data: unreadRows } = await supabase
      .from("messages")
      .select("conversation_id")
      .in("conversation_id", convIds)
      .neq("sender_id", me)
      .is("read_at", null)
      .eq("hidden", false);
    for (const m of unreadRows ?? []) {
      unread.set(
        m.conversation_id,
        (unread.get(m.conversation_id) ?? 0) + 1
      );
    }
  }

  // Resolve referenced profiles in one query.
  const otherIds = new Set<string>();
  conversations.forEach((c) =>
    otherIds.add(c.user_low === me ? c.user_high : c.user_low)
  );
  requests.forEach((r) => otherIds.add(r.sender_id));
  matches.forEach((m) =>
    otherIds.add(m.user_low === me ? m.user_high : m.user_low)
  );

  const profiles = new Map<string, ProfileLite>();
  if (otherIds.size > 0) {
    const ids = [...otherIds];
    // Presence lives in profile_presence (mig 0092) and is RLS-gated on the
    // owner's show_online, so this returns rows only for people who publish it.
    // Anyone who has it switched off is simply absent → last_seen_at null →
    // rendered offline. The list used to read profiles.last_seen_at and show an
    // online dot regardless of the setting.
    const [{ data: profRows }, { data: presRows }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, avatar_url, department")
        .in("id", ids),
      supabase.from("profile_presence").select("id, last_seen_at").in("id", ids),
    ]);
    const seen = new Map(
      (presRows ?? []).map((r) => [r.id as string, r.last_seen_at as string | null])
    );
    (profRows ?? []).forEach((p) =>
      profiles.set(p.id, { ...p, last_seen_at: seen.get(p.id) ?? null })
    );
  }

  const incoming: IncomingRequest[] = requests.map((r) => {
    const p = profiles.get(r.sender_id);
    return {
      id: r.id,
      message: r.message,
      senderName: p?.full_name ?? "Student",
      senderAvatar: p?.avatar_url ?? null,
      senderDept: p?.department ?? null,
    };
  });

  // One recency-sorted inbox holding both kinds of conversation. Community
  // rooms sit inline with direct messages — same row shape, distinguished by a
  // small capsule — because Chat now owns every live conversation in the app.
  const EPOCH = "1970-01-01T00:00:00Z";
  type Thread =
    | { kind: "dm"; ts: string; convId: string; otherId: string }
    | { kind: "space"; ts: string; space: SpaceLite; preview: string | null };

  const threads: Thread[] = [
    ...conversations.map(
      (c): Thread => ({
        kind: "dm",
        ts: c.last_message_at ?? EPOCH,
        convId: c.id,
        otherId: c.user_low === me ? c.user_high : c.user_low,
      })
    ),
    ...[...spaces.values()].map((space): Thread => {
      const p = spacePreview.get(space.id);
      return {
        kind: "space",
        ts: p?.ts ?? EPOCH,
        space,
        preview: p?.text ?? null,
      };
    }),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  // Matches that don't yet have a conversation AND that we haven't already
  // reached out to — surfaced so a chat can start. A match we've messaged
  // (open conversation or a pending outgoing request) is removed here (UAT-018).
  const convOtherIds = new Set(
    conversations.map((c) => (c.user_low === me ? c.user_high : c.user_low))
  );
  const initiatedIds = new Set(
    (outgoingReqRows ?? []).map((r) => r.recipient_id as string)
  );
  const newMatches = matches
    .map((m) => (m.user_low === me ? m.user_high : m.user_low))
    .filter((id) => !convOtherIds.has(id) && !initiatedIds.has(id));

  // Messages and Requests are two panels of one screen (UAT-006): the tab bar
  // swaps them without a full-page header change.
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-[22px] font-bold tracking-tight">Messages</h1>

      <ChatCommunityTabs
        active={showRequests ? "requests" : "messages"}
        requestCount={incoming.length}
      >
        {showRequests ? (
          <div className="mt-5 space-y-3">
            {incoming.length === 0 ? (
              <p className="py-16 text-center text-sm text-fg-muted">
                No pending requests.
              </p>
            ) : (
              incoming.map((r) => <RequestRow key={r.id} request={r} />)
            )}
          </div>
        ) : (
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
              const p = profiles.get(otherId);
              return (
                <div
                  key={`nm:${otherId}`}
                  className="flex items-center gap-3 py-3.5"
                >
                  <Link
                    href={`/profile/${otherId}`}
                    className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-card"
                  >
                    {p?.avatar_url && (
                      <AppImage
                        src={p.avatar_url}
                        alt={p.full_name ?? "Match"}
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

              const p = profiles.get(t.otherId);
              const preview = lastMsg.get(t.convId);
              const unreadCount = unread.get(t.convId) ?? 0;
              const hasUnread = unreadCount > 0;
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
                      {preview ?? "Say hi 👋"}
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
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
        )}
      </ChatCommunityTabs>
    </main>
  );
}
