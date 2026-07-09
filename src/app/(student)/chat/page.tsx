import Link from "next/link";
import { Search, Edit3, ChevronLeft } from "lucide-react";
import { RequestRow, type IncomingRequest } from "@/components/chat/request-row";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { ChatCommunityTabs } from "@/components/chat/chat-community-tabs";
import { createClient } from "@/lib/supabase/server";
import { AppImage } from "@/components/ui/app-image";
import { timeAgo } from "@/lib/time";

type ProfileLite = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  department: string | null;
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showRequests = view === "requests";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

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
      .select("conversation_id, body, sender_id, created_at")
      .in("conversation_id", convIds)
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(300);
    for (const m of msgs ?? []) {
      if (lastMsg.has(m.conversation_id)) continue;
      const prefix = m.sender_id === me ? "You: " : "";
      lastMsg.set(m.conversation_id, `${prefix}${m.body ?? "Sent an attachment"}`);
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
      .select("id, full_name, avatar_url, department")
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

  // ── Requests sub-view ────────────────────────────────────────────────────
  if (showRequests) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-6">
        <header className="mb-4 flex items-center gap-3">
          <Link
            href="/chat"
            aria-label="Back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </Link>
          <h1 className="text-[22px] font-bold tracking-tight">Requests</h1>
        </header>
        {incoming.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg-muted">
            No pending requests.
          </p>
        ) : (
          <div className="space-y-3">
            {incoming.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </div>
        )}
      </main>
    );
  }

  // ── Messages view ────────────────────────────────────────────────────────
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-bold tracking-tight">Messages</h1>
        <div className="flex items-center gap-2.5">
          <Link
            href="/chat?view=requests"
            className="flex items-center gap-1 rounded-full bg-card px-3 py-1.5 text-[13px] text-fg-muted"
          >
            Requests
            {incoming.length > 0 && (
              <span className="font-semibold text-accent">{incoming.length}</span>
            )}
          </Link>
          <Link
            href="/discover"
            aria-label="Search people"
            className="flex h-9 w-9 items-center justify-center text-fg"
          >
            <Search className="h-5 w-5" aria-hidden />
          </Link>
          <Link
            href="/discover"
            aria-label="New message"
            className="flex h-9 w-9 items-center justify-center text-fg"
          >
            <Edit3 className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      </div>

      <ChatCommunityTabs active="messages" />

      <div className="mt-5 space-y-1">
        {conversations.length === 0 && newMatches.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg-muted">
            No conversations yet. Match in Discover to start chatting.
          </p>
        ) : (
          <>
            {conversations.map((c) => {
              const otherId = c.user_low === me ? c.user_high : c.user_low;
              const p = profiles.get(otherId);
              const preview = lastMsg.get(c.id);
              return (
                <Link
                  key={c.id}
                  href={`/chat/${c.id}`}
                  className="flex items-center gap-3 rounded-[12px] px-3 py-3 transition-colors hover:bg-card"
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-card">
                    {p?.avatar_url && (
                      <AppImage
                        src={p.avatar_url}
                        alt={p.full_name ?? "Match"}
                        sizes="44px"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-fg">
                      {p?.full_name ?? "Student"}
                    </p>
                    <p className="truncate text-sm text-fg-muted">
                      {preview ?? "Say hi 👋"}
                    </p>
                  </div>
                  {c.last_message_at && (
                    <span className="shrink-0 self-start text-xs text-fg-muted">
                      {timeAgo(c.last_message_at)}
                    </span>
                  )}
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
    </main>
  );
}
