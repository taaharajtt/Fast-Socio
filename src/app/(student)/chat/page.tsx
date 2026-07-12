import Link from "next/link";
import { RequestRow, type IncomingRequest } from "@/components/chat/request-row";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { ChatCommunityTabs } from "@/components/chat/chat-community-tabs";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { AppImage } from "@/components/ui/app-image";
import { OnlineDot } from "@/components/ui/badges";
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
    const { data: profRows } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, department, last_seen_at")
      .in("id", [...otherIds]);
    (profRows ?? []).forEach((p) => profiles.set(p.id, p));
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

  // UAT-007: the communities you're in appear in Messages like IG group chats.
  const { data: memberRows } = await supabase
    .from("community_members")
    .select("community:communities(id, name, avatar_url, cover_url, status)")
    .eq("user_id", me);
  type CommunityLite = {
    id: string;
    name: string;
    avatar_url: string | null;
    cover_url: string | null;
    status: string;
  };
  const myCommunities = ((memberRows ?? [])
    .map((r) => r.community as unknown as CommunityLite | null)
    .filter((c): c is CommunityLite => Boolean(c) && c!.status === "approved"));

  // Latest chat line per community for the preview + ordering.
  const communityThreads: {
    id: string;
    name: string;
    avatar: string | null;
    preview: string;
    ts: string;
  }[] = [];
  if (myCommunities.length > 0) {
    const { data: cmsgs } = await supabase
      .from("community_chat_view")
      .select("community_id, body, sender_name, is_anonymous, created_at")
      .in(
        "community_id",
        myCommunities.map((c) => c.id)
      )
      .order("created_at", { ascending: false })
      .limit(200);
    const latest = new Map<string, { preview: string; ts: string }>();
    for (const m of cmsgs ?? []) {
      if (latest.has(m.community_id)) continue;
      const who = m.is_anonymous ? "Anonymous" : (m.sender_name ?? "Member");
      latest.set(m.community_id, {
        preview: `${who}: ${m.body}`,
        ts: m.created_at,
      });
    }
    for (const c of myCommunities) {
      const l = latest.get(c.id);
      communityThreads.push({
        id: c.id,
        name: c.name,
        avatar: c.cover_url ?? c.avatar_url,
        preview: l?.preview ?? "No messages yet — say hello 👋",
        ts: l?.ts ?? "1970-01-01T00:00:00Z",
      });
    }
  }

  // A unified, recency-sorted inbox of DM conversations + community rooms.
  type Thread =
    | { kind: "dm"; ts: string; convId: string; otherId: string }
    | {
        kind: "community";
        ts: string;
        id: string;
        name: string;
        avatar: string | null;
        preview: string;
      };
  const threads: Thread[] = [
    ...conversations.map(
      (c): Thread => ({
        kind: "dm",
        ts: c.last_message_at ?? "1970-01-01T00:00:00Z",
        convId: c.id,
        otherId: c.user_low === me ? c.user_high : c.user_low,
      })
    ),
    ...communityThreads.map(
      (c): Thread => ({
        kind: "community",
        ts: c.ts,
        id: c.id,
        name: c.name,
        avatar: c.avatar,
        preview: c.preview,
      })
    ),
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
      <div className="mt-5 space-y-1">
        {threads.length === 0 && newMatches.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg-muted">
            No conversations yet. Match in Discover to start chatting.
          </p>
        ) : (
          <>
            {threads.map((t) => {
              if (t.kind === "community") {
                return (
                  <Link
                    key={`c:${t.id}`}
                    href={`/communities/${t.id}/chat`}
                    className="flex items-center gap-3 rounded-[12px] px-3 py-3 transition-colors hover:bg-card"
                  >
                    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-card">
                      {t.avatar && (
                        <AppImage src={t.avatar} alt={t.name} sizes="44px" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold text-fg">
                        <span className="truncate">{t.name}</span>
                        <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          Community
                        </span>
                      </p>
                      <p className="truncate text-sm text-fg-muted">{t.preview}</p>
                    </div>
                    <span className="shrink-0 self-start text-xs text-fg-muted">
                      {timeAgo(t.ts)}
                    </span>
                  </Link>
                );
              }
              const p = profiles.get(t.otherId);
              const preview = lastMsg.get(t.convId);
              return (
                <Link
                  key={t.convId}
                  href={`/chat/${t.convId}`}
                  className="flex items-center gap-3 rounded-[12px] px-3 py-3 transition-colors hover:bg-card"
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
                    <p className="truncate text-sm text-fg-muted">
                      {preview ?? "Say hi 👋"}
                    </p>
                  </div>
                  <span className="shrink-0 self-start text-xs text-fg-muted">
                    {timeAgo(t.ts)}
                  </span>
                </Link>
              );
            })}

            {newMatches.map((otherId) => {
              const p = profiles.get(otherId);
              return (
                <div
                  key={otherId}
                  className="flex items-center gap-3 rounded-[12px] px-3 py-3"
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
          </>
        )}
          </div>
        )}
      </ChatCommunityTabs>
    </main>
  );
}
