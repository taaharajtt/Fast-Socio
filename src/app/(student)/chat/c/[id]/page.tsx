import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CommunityThread } from "@/components/chat/community-thread";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { AppImage } from "@/components/ui/app-image";
import { GlassChip } from "@/components/ui";
import { communityIcon } from "@/lib/communities/icon";
import { getCommunityRelationship } from "@/lib/communities/relationship";
import { fetchPollResults, type PollOptionResult } from "@/app/(student)/communities/actions";
import type { CommunityMessage } from "@/components/communities/community-chat";

const CHAT_PAGE_SIZE = 100;

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
    .select("id, name, avatar_url, cover_url, member_count, owner_id, is_society, status")
    .eq("id", id)
    .single();
  if (!community || community.status !== "approved") notFound();

  const rel = await getCommunityRelationship(id, me, community.owner_id);

  // Only a joined member can read the room, so the fetch is skipped entirely
  // for a follower — they get the join gate below instead of an empty thread.
  const { data: chatRows } = rel.isMember
    ? await supabase
        .from("community_chat_view")
        .select(
          "id, sender_id, sender_name, sender_avatar, body, poll_id, is_anonymous, created_at"
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
  const profileHref = community.is_society
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
        <Link href={profileHref} className="flex min-w-0 flex-1 items-center gap-3">
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
              <GlassChip>Community</GlassChip>
            </span>
            <span className="block truncate text-[11px] text-fg-muted">
              {community.member_count.toLocaleString()} member
              {community.member_count === 1 ? "" : "s"}
            </span>
          </span>
        </Link>
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
