import Link from "next/link";
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

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  // Existing conversations + incoming pending requests + matches.
  const [{ data: convRows }, { data: reqRows }, { data: matchRows }] =
    await Promise.all([
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
    ]);

  const conversations = convRows ?? [];
  const requests = reqRows ?? [];
  const matches = matchRows ?? [];

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

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Messages</h1>

      {conversations.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-fg-muted">
            Conversations
          </h2>
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
        </section>
      )}

      <section className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-medium text-fg-muted">Requests</h2>
          {incoming.length > 0 && (
            <GlassChip tone="aura">{incoming.length}</GlassChip>
          )}
        </div>
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

      <section className="mt-6">
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
                <GlassCard key={m.id} className="flex items-center gap-3 p-4">
                  <div className="glass h-12 w-12 shrink-0 overflow-hidden rounded-full">
                    {p?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.avatar_url}
                        alt={p.full_name ?? "Match"}
                        className="h-full w-full object-cover"
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
                  <OpenChatButton otherId={otherId} />
                </GlassCard>
              );
            })}
          </div>
        )}
      </section>

    </main>
  );
}
