import Link from "next/link";
import { Users } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { RequestRow, type IncomingRequest } from "@/components/chat/request-row";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { createClient } from "@/lib/supabase/server";

type ProfileLite = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  department: string | null;
};

type ChatTab = "messages" | "requests" | "communities";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active: ChatTab =
    tab === "requests" || tab === "communities" ? tab : "messages";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  // Existing conversations + incoming pending requests + matches + my communities.
  const [
    { data: convRows },
    { data: reqRows },
    { data: matchRows },
    { data: commRows },
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
    supabase
      .from("community_members")
      .select("role, community:communities(id, name, description, member_count, status)")
      .eq("user_id", me),
  ]);

  const conversations = convRows ?? [];
  const requests = reqRows ?? [];
  const matches = matchRows ?? [];
  const myCommunities = (commRows ?? [])
    .map((r) => r.community as unknown as {
      id: string;
      name: string;
      description: string | null;
      member_count: number;
      status: string;
    } | null)
    .filter((c): c is NonNullable<typeof c> => Boolean(c) && c!.status === "approved");

  // Resolve all referenced profiles in one query.
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

  const tabs: { value: ChatTab; label: string; badge?: number }[] = [
    { value: "messages", label: "Messages" },
    { value: "requests", label: "Requests", badge: incoming.length },
    { value: "communities", label: "Communities" },
  ];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Chat</h1>

      {/* Inner tabs (CR-004): Messages · Requests · Communities */}
      <div className="glass mt-5 flex gap-1 rounded-[var(--radius-pill)] p-1">
        {tabs.map((t) => {
          const isActive = t.value === active;
          return (
            <Link
              key={t.value}
              href={t.value === "messages" ? "/chat" : `/chat?tab=${t.value}`}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] py-2 text-center text-sm font-medium ${
                isActive ? "bg-aura text-white" : "text-fg-muted"
              }`}
            >
              {t.label}
              {t.badge ? (
                <span className="rounded-full bg-white/25 px-1.5 text-xs">
                  {t.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      {active === "messages" && (
        <div className="mt-6 space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-medium text-fg-muted">
              Conversations
            </h2>
            {conversations.length === 0 ? (
              <GlassCard className="p-5">
                <p className="text-sm text-fg-muted">
                  No conversations yet. Message a match to start one.
                </p>
              </GlassCard>
            ) : (
              <div className="space-y-2">
                {conversations.map((c) => {
                  const otherId = c.user_low === me ? c.user_high : c.user_low;
                  const p = profiles.get(otherId);
                  return (
                    <Link key={c.id} href={`/chat/${c.id}`} className="block">
                      <GlassCard className="flex items-center gap-3 p-4">
                        <div className="glass h-12 w-12 shrink-0 overflow-hidden rounded-full">
                          {p?.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.avatar_url}
                              alt={p.full_name ?? "Match"}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">
                            {p?.full_name ?? "Student"}
                          </p>
                          <p className="truncate text-xs text-fg-muted">
                            {p?.department ?? ""}
                          </p>
                        </div>
                      </GlassCard>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-medium text-fg-muted">Matches</h2>
            {matches.length === 0 ? (
              <GlassCard className="p-5">
                <p className="text-sm text-fg-muted">
                  No matches yet — keep swiping in Discover.
                </p>
              </GlassCard>
            ) : (
              <div className="space-y-2">
                {matches.map((m) => {
                  const otherId = m.user_low === me ? m.user_high : m.user_low;
                  const p = profiles.get(otherId);
                  return (
                    <GlassCard
                      key={m.id}
                      className="flex items-center gap-3 p-4"
                    >
                      <Link
                        href={`/profile/${otherId}`}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        <div className="glass h-12 w-12 shrink-0 overflow-hidden rounded-full">
                          {p?.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.avatar_url}
                              alt={p.full_name ?? "Match"}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">
                            {p?.full_name ?? "Student"}
                          </p>
                          <p className="truncate text-xs text-fg-muted">
                            {p?.department ?? ""}
                          </p>
                        </div>
                      </Link>
                      <OpenChatButton otherId={otherId} />
                    </GlassCard>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {active === "requests" && (
        <section className="mt-6">
          {incoming.length === 0 ? (
            <GlassCard className="p-5">
              <p className="text-sm text-fg-muted">No pending requests.</p>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {incoming.map((r) => (
                <RequestRow key={r.id} request={r} />
              ))}
            </div>
          )}
        </section>
      )}

      {active === "communities" && (
        <section className="mt-6 space-y-4">
          <Link href="/communities" className="block">
            <GlassCard className="flex items-center gap-3 p-4">
              <div className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                <Users className="h-5 w-5 text-fg-muted" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Discover communities</p>
                <p className="text-xs text-fg-muted">
                  Browse and join campus communities
                </p>
              </div>
            </GlassCard>
          </Link>

          <div>
            <h2 className="mb-2 text-sm font-medium text-fg-muted">
              Your communities
            </h2>
            {myCommunities.length === 0 ? (
              <GlassCard className="p-5">
                <p className="text-sm text-fg-muted">
                  You haven&rsquo;t joined any communities yet.
                </p>
              </GlassCard>
            ) : (
              <div className="space-y-2">
                {myCommunities.map((c) => (
                  <Link
                    key={c.id}
                    href={`/communities/${c.id}`}
                    className="block"
                  >
                    <GlassCard className="flex items-center gap-3 p-4">
                      <div className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                        <Users className="h-5 w-5 text-fg-muted" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{c.name}</p>
                        {c.description && (
                          <p className="truncate text-xs text-fg-muted">
                            {c.description}
                          </p>
                        )}
                      </div>
                      <GlassChip>{c.member_count}</GlassChip>
                    </GlassCard>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
