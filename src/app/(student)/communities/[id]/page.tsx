import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, MessageCircle, Pencil } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { communityIcon } from "@/lib/communities/icon";
import { JoinButton } from "@/components/communities/join-button";
import { PostComposer } from "@/components/feed/post-composer";
import { PostCard } from "@/components/feed/post-card";
import { ReviewPostRow, type PendingPost } from "@/components/communities/review-post-row";
import { RegisterSocietyButton } from "@/components/societies/register-society-button";
import { RouteTabs, type RouteTab } from "@/components/ui/route-tabs";
import { SkeletonCards } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import type { FeedPost } from "@/lib/feed/types";

type CommunityTab = "posts" | "review";

export default async function CommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const { data: community } = await supabase
    .from("communities")
    .select("id, name, description, avatar_url, cover_url, member_count, status, owner_id, is_society")
    .eq("id", id)
    .single();
  if (!community) notFound();

  const { data: membership } = await supabase
    .from("community_members")
    .select("role")
    .eq("community_id", id)
    .eq("user_id", me)
    .maybeSingle();

  const isMember = Boolean(membership);
  const role = membership?.role ?? null;
  const isOwner = community.owner_id === me;
  const isMod = role === "owner" || role === "moderator";
  const pending = community.status !== "approved";

  // UAT-007: the Chat tab moved out to the Messages list (a full-screen room at
  // /communities/[id]/chat). Only Main (the broadcast feed) and the mod Review
  // queue remain here.
  const active: CommunityTab =
    tab === "review" && isMod ? "review" : "posts";

  // Load only what the active tab needs.
  let posts: FeedPost[] = [];
  let pendingPosts: PendingPost[] = [];
  let pendingCount = 0;

  if (isMod) {
    const { count } = await supabase
      .from("community_review_posts")
      .select("id", { count: "exact", head: true })
      .eq("community_id", id);
    pendingCount = count ?? 0;
  }

  if (!pending && active === "posts") {
    const { data: postRows } = await supabase
      .from("feed_posts")
      .select("*")
      .eq("community_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    posts = (postRows as FeedPost[]) ?? [];
  } else if (!pending && active === "review" && isMod) {
    const { data: rows } = await supabase
      .from("community_review_posts")
      .select("*")
      .eq("community_id", id)
      .order("created_at", { ascending: true });
    pendingPosts = (rows as PendingPost[]) ?? [];
  }

  const tabHref = (t: CommunityTab) =>
    t === "posts" ? `/communities/${id}` : `/communities/${id}?tab=${t}`;

  const tabs: RouteTab[] = [
    { key: "posts", href: tabHref("posts"), label: "Main" },
    ...(isMod
      ? [
          {
            key: "review",
            href: tabHref("review"),
            label: "Review",
            badge: pendingCount,
          },
        ]
      : []),
  ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
      {/* Banner hero (UISpec V3 Screen 12): 200px cover, back arrow, and the
          community identity + Join button overlaid on a bottom gradient. */}
      <div className="relative h-[200px] w-full overflow-hidden">
        {community.cover_url || community.avatar_url ? (
          <AppImage
            src={community.cover_url ?? community.avatar_url}
            alt=""
            sizes="(max-width: 448px) 100vw, 448px"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{ background: "linear-gradient(135deg, #4c1d95, #7c3aed)" }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <Link
          href="/communities"
          aria-label="Back"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        {isOwner && (
          <Link
            href={`/communities/${community.id}/edit`}
            aria-label="Edit community"
            className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Link>
        )}
        <div className="absolute inset-x-4 bottom-3 flex items-end gap-3">
          <span className="text-3xl leading-none" aria-hidden>
            {communityIcon(community.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[17px] font-bold text-white">
                {community.name}
              </h1>
              {pending && <GlassChip tone="warning">pending</GlassChip>}
            </div>
            <p className="text-[13px] text-white/70">
              {community.member_count.toLocaleString()} member
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
      </div>

      <div className="flex flex-1 flex-col px-4 py-4">
      {community.description && (
        <p className="text-[15px] text-fg-muted">{community.description}</p>
      )}

      {/* Society/Event OS entry point: an approved community can become a
          society (public page + officer roles + announcements + events). */}
      {community.is_society ? (
        <Link
          href={`/societies/${community.id}`}
          className="mt-4 flex items-center gap-3 rounded-[var(--radius-md)] bg-card px-4 py-3"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <ChevronRight className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-fg">
              Society page
            </span>
            <span className="block text-xs text-fg-muted">
              Public profile, officers, announcements & events
            </span>
          </span>
        </Link>
      ) : (
        isOwner &&
        !pending && (
          <div className="mt-4">
            <RegisterSocietyButton communityId={community.id} />
          </div>
        )
      )}

      {pending ? (
        <p className="mt-6 text-center text-sm text-fg-muted">
          This community is awaiting admin approval.
        </p>
      ) : (
        <RouteTabs
          tabs={tabs}
          activeKey={active}
          className="mt-4"
          // UAT-006: the pill lights on tap and the panel shimmers until the
          // next tab's server render lands.
          skeletons={{
            posts: <SkeletonCards />,
            review: <SkeletonCards count={2} />,
          }}
        >
          {active === "posts" && (
            <>
              {/* UAT-007: the live chat room now lives in Messages. Members get a
                  quick way in from here too. */}
              {isMember && (
                <Link
                  href={`/communities/${community.id}/chat`}
                  className="mt-4 flex items-center gap-3 rounded-[var(--radius-md)] bg-card px-4 py-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <MessageCircle className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg">
                      Community chat room
                    </span>
                    <span className="block text-xs text-fg-muted">
                      Chat live with members — opens in Messages
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
                </Link>
              )}
              {isMember && (
                <div className="mt-4">
                  <PostComposer
                    communityId={community.id}
                    placeholder={`Post to ${community.name}…`}
                    reviewNotice={
                      isMod
                        ? undefined
                        : "Post submitted for review. It appears once a moderator approves it."
                    }
                  />
                </div>
              )}
              <div className="mt-4 space-y-4">
                {posts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-fg-muted">
                    {isMember
                      ? "No approved posts yet — start the conversation."
                      : "Join to see and share posts."}
                  </p>
                ) : (
                  posts.map((p) => <PostCard key={p.id} post={p} />)
                )}
              </div>
            </>
          )}

          {active === "review" && isMod && (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-fg-muted">
                Member posts awaiting your approval.
              </p>
              {pendingPosts.length === 0 ? (
                <GlassCard className="p-5">
                  <p className="text-sm text-fg-muted">
                    Nothing to review right now. 🎉
                  </p>
                </GlassCard>
              ) : (
                pendingPosts.map((p) => <ReviewPostRow key={p.id} post={p} />)
              )}
            </div>
          )}
        </RouteTabs>
      )}
      </div>
    </main>
  );
}
