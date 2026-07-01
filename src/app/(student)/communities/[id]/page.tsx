import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { JoinButton } from "@/components/communities/join-button";
import { PostComposer } from "@/components/feed/post-composer";
import { PostCard } from "@/components/feed/post-card";
import { createClient } from "@/lib/supabase/server";
import type { FeedPost } from "@/lib/feed/types";

export default async function CommunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const { data: community } = await supabase
    .from("communities")
    .select("id, name, description, member_count, status, owner_id")
    .eq("id", id)
    .single();
  if (!community) notFound();

  const [{ data: membership }, { data: postRows }] = await Promise.all([
    supabase
      .from("community_members")
      .select("role")
      .eq("community_id", id)
      .eq("user_id", me)
      .maybeSingle(),
    supabase
      .from("feed_posts")
      .select("*")
      .eq("community_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const isMember = Boolean(membership);
  const isOwner = community.owner_id === me;
  const posts = (postRows as FeedPost[]) ?? [];
  const pending = community.status !== "approved";

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/communities"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="truncate text-lg font-bold">{community.name}</h1>
      </div>

      <GlassCard className="p-5">
        <div className="flex items-start gap-3">
          <div className="glass flex h-14 w-14 shrink-0 items-center justify-center rounded-full">
            <Users className="h-6 w-6 text-fg-muted" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-bold">{community.name}</h2>
              {pending && <GlassChip tone="warning">pending</GlassChip>}
            </div>
            <p className="text-sm text-fg-muted">
              {community.member_count} member
              {community.member_count === 1 ? "" : "s"}
            </p>
          </div>
          {!pending && (
            <JoinButton
              communityId={community.id}
              isMember={isMember}
              isOwner={isOwner}
            />
          )}
        </div>
        {community.description && (
          <p className="mt-3 text-[15px]">{community.description}</p>
        )}
      </GlassCard>

      {pending ? (
        <p className="mt-6 text-center text-sm text-fg-muted">
          This community is awaiting admin approval.
        </p>
      ) : (
        <>
          {isMember && (
            <div className="mt-4">
              <PostComposer
                communityId={community.id}
                placeholder={`Post to ${community.name}…`}
              />
            </div>
          )}
          <div className="mt-4 space-y-4">
            {posts.length === 0 ? (
              <p className="py-8 text-center text-sm text-fg-muted">
                {isMember
                  ? "No posts yet — start the conversation."
                  : "Join to see and share posts."}
              </p>
            ) : (
              posts.map((p) => <PostCard key={p.id} post={p} />)
            )}
          </div>
        </>
      )}
    </main>
  );
}
