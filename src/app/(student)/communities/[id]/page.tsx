import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { JoinButton } from "@/components/communities/join-button";
import { PostComposer } from "@/components/feed/post-composer";
import { PostCard } from "@/components/feed/post-card";
import { CommunityChat, type CommunityMessage } from "@/components/communities/community-chat";
import { ReviewPostRow, type PendingPost } from "@/components/communities/review-post-row";
import { createClient } from "@/lib/supabase/server";
import type { FeedPost } from "@/lib/feed/types";

type CommunityTab = "posts" | "chat" | "review";

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
    .select("id, name, description, member_count, status, owner_id")
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

  const active: CommunityTab =
    tab === "chat" || (tab === "review" && isMod) ? (tab as CommunityTab) : "posts";

  // Load only what the active tab needs.
  let posts: FeedPost[] = [];
  let pendingPosts: PendingPost[] = [];
  let pendingCount = 0;
  let chatMessages: CommunityMessage[] = [];
  const chatSenders: Record<string, { name: string | null; avatar: string | null }> = {};

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
  } else if (!pending && active === "chat" && isMember) {
    const { data: rows } = await supabase
      .from("community_chat_messages")
      .select("id, sender_id, body, created_at")
      .eq("community_id", id)
      .order("created_at", { ascending: true })
      .limit(100);
    chatMessages = (rows as CommunityMessage[]) ?? [];
    const senderIds = [...new Set(chatMessages.map((m) => m.sender_id))];
    if (senderIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", senderIds);
      (profs ?? []).forEach((p) => {
        chatSenders[p.id] = { name: p.full_name, avatar: p.avatar_url };
      });
    }
  }

  const tabHref = (t: CommunityTab) =>
    t === "posts" ? `/communities/${id}` : `/communities/${id}?tab=${t}`;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-6">
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
          {/* Zone tabs: Posts (approval feed) · Chat (open room) · Review (mods) */}
          <div className="glass mt-4 flex gap-1 rounded-[var(--radius-pill)] p-1">
            <TabLink href={tabHref("posts")} active={active === "posts"} label="Posts" />
            <TabLink href={tabHref("chat")} active={active === "chat"} label="Chat" />
            {isMod && (
              <TabLink
                href={tabHref("review")}
                active={active === "review"}
                label="Review"
                badge={pendingCount}
              />
            )}
          </div>

          {active === "posts" && (
            <>
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

          {active === "chat" &&
            (isMember ? (
              <div className="mt-4 flex flex-1 flex-col">
                <CommunityChat
                  communityId={community.id}
                  meId={me}
                  initialMessages={chatMessages}
                  initialSenders={chatSenders}
                />
              </div>
            ) : (
              <p className="mt-8 text-center text-sm text-fg-muted">
                Join this community to access the chat room.
              </p>
            ))}

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
        </>
      )}
    </main>
  );
}

function TabLink({
  href,
  active,
  label,
  badge,
}: {
  href: string;
  active: boolean;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] py-2 text-center text-sm font-medium ${
        active ? "bg-aura text-white" : "text-fg-muted"
      }`}
    >
      {label}
      {badge ? (
        <span className="rounded-full bg-white/25 px-1.5 text-xs">{badge}</span>
      ) : null}
    </Link>
  );
}
