import Link from "next/link";
import { Plus, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { ChatCommunityTabs } from "@/components/chat/chat-community-tabs";
import {
  CommunityBrowser,
  type CommunityVM,
} from "@/components/communities/community-browser";

type Community = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  member_count: number;
  status: string;
  owner_id: string;
};

export default async function CommunitiesPage() {
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip (layout already
  // gated this route; RLS scopes every query below).
  const me = (await getAuthUserId())!;

  const [{ data: rows }, { data: memberRows }, { count: pendingRequests }] =
    await Promise.all([
      supabase
        .from("communities")
        .select("id, name, description, avatar_url, cover_url, member_count, status, owner_id")
        .order("member_count", { ascending: false }),
      supabase.from("community_members").select("community_id").eq("user_id", me),
      // Keeps the Requests pill badge consistent across all three tab panels.
      supabase
        .from("message_requests")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", me)
        .eq("status", "pending"),
    ]);
  const communities = (rows ?? []) as Community[];
  const myMemberships = new Set(
    (memberRows ?? []).map((m) => m.community_id as string)
  );

  const approved = communities.filter((c) => c.status === "approved");
  const myPending = communities.filter(
    (c) => c.status === "pending" && c.owner_id === me
  );

  const vms: CommunityVM[] = approved.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    avatar_url: c.avatar_url,
    cover_url: c.cover_url,
    member_count: c.member_count,
    isMember: myMemberships.has(c.id) || c.owner_id === me,
    isOwner: c.owner_id === me,
  }));

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-bold tracking-tight">Community</h1>
        <Link
          href="/communities/new"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-fg-muted hover:text-fg"
          aria-label="Create community"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </Link>
      </div>

      <ChatCommunityTabs active="community" requestCount={pendingRequests ?? 0}>
        {myPending.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-2 text-sm font-medium text-fg-muted">
              Awaiting approval
            </h2>
            <div className="space-y-2">
              {myPending.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-[14px] bg-card p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="text-xs text-fg-muted">Pending admin review</p>
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
                    <Clock className="h-3 w-3" aria-hidden /> pending
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <CommunityBrowser communities={vms} />
      </ChatCommunityTabs>
    </main>
  );
}
