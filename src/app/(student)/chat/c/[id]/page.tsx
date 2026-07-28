import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CommunityThread } from "@/components/chat/community-thread";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { AppImage } from "@/components/ui/app-image";
import { GlassChip } from "@/components/ui";
import { communityIcon } from "@/lib/communities/icon";
import { discoverGroupLabel } from "@/lib/discover/group-label";
import { getCommunityRelationship } from "@/lib/communities/relationship";
import { fetchPollResults, type PollOptionResult } from "@/app/(student)/communities/actions";
import type { CommunityMessage } from "@/components/communities/community-chat";

const CHAT_PAGE_SIZE = 100;

/** The identity block: a link to the space's profile, unless there isn't one. */
function HeaderShell({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  const className = "flex min-w-0 flex-1 items-center gap-3";
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

/**
 * A community's conversation — the same screen as a DM (/chat/[id]): the same
 * fixed full-height shell, the same header shape, the same back arrow to the
 * inbox. Only two things differ, and both are real: the header identifies a
 * space rather than a person (so it carries the "Community" capsule the inbox
 * row carries, and links to the space's profile), and the composer offers
 * anonymity.
 */
export default async function CommunityConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip; RLS is authoritative.
  const me = (await getAuthUserId())!;

  const { data: community } = await supabase
    .from("communities")
    .select(
      "id, name, avatar_url, cover_url, member_count, owner_id, is_society, status, is_discover_group, discover_mode, discover_title"
    )
    .eq("id", id)
    .single();
  if (!community || community.status !== "approved") notFound();

  const rel = await getCommunityRelationship(id, me, community.owner_id);

  // A Discover team room is private and un-joinable (mig 0129 narrows the
  // self-join policy), so a non-member has no gate to pass — the room simply
  // doesn't exist for them.
  if (community.is_discover_group && !rel.isMember) notFound();

  // Only a joined member can read the room, so the fetch is skipped entirely
  // for a follower — they get the join gate below instead of an empty thread.
  const { data: chatRows } = rel.isMember
    ? await supabase
        .from("community_chat_view")
        .select(
          "id, sender_id, sender_name, sender_avatar, sender_gender, body, poll_id, is_anonymous, created_at"
        )
        .eq("community_id", id)
        .order("created_at", { ascending: true })
        .limit(CHAT_PAGE_SIZE)
    : { data: [] as CommunityMessage[] };

  const messages = (chatRows as CommunityMessage[] | null) ?? [];
  const polls: Record<string, PollOptionResult[]> = await fetchPollResults([
    ...new Set(messages.map((m) => m.poll_id).filter(Boolean) as string[]),
  ]);

  const image = community.avatar_url ?? community.cover_url;
  const isDiscoverGroup = Boolean(community.is_discover_group);
  // A Discover room has no public profile page to open, so its header is inert
  // rather than a link to a 404.
  const profileHref = isDiscoverGroup
    ? null
    : community.is_society
      ? `/societies/${id}`
      : `/communities/${id}`;

  // The shell height shrinks by --kb when the iOS keyboard overlays the
  // viewport (see use-keyboard-inset.ts); 0 elsewhere. Identical to the DM
  // screen so the two conversations feel like one surface.
  return (
    <div className="fixed inset-0 z-40 mx-auto flex h-[calc(100dvh-var(--kb,0px))] max-w-md flex-col overflow-hidden bg-bg px-4">
      <header className="flex shrink-0 items-center gap-3 border-b border-glass-border py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/chat"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        {/* Tapping the avatar/name opens the space's profile — the counterpart
            of tapping a person's avatar in a DM. */}
        <HeaderShell href={profileHref}>
          <span className="glass relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
            {image ? (
              <AppImage src={image} alt="" sizes="36px" priority />
            ) : (
              <span className="text-base" aria-hidden>
                {communityIcon(community.name)}
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-semibold">{community.name}</span>
              {isDiscoverGroup ? (
                <span className="gradient-brand shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white">
                  {discoverGroupLabel(community.discover_mode)}
                </span>
              ) : (
                <GlassChip>Community</GlassChip>
              )}
            </span>
            <span className="block truncate text-[11px] text-fg-muted">
              {community.member_count.toLocaleString()} member
              {community.member_count === 1 ? "" : "s"}
              {/* The post this team formed around, so the room keeps its origin. */}
              {isDiscoverGroup && community.discover_title
                ? ` · ${community.discover_title}`
                : ""}
            </span>
          </span>
        </HeaderShell>
      </header>

      <CommunityThread
        communityId={id}
        meId={me}
        isMember={rel.isMember}
        joinStatus={rel.joinStatus}
        initialMessages={messages}
        initialPolls={polls}
      />
    </div>
  );
}
