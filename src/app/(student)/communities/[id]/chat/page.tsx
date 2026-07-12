import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { communityIcon } from "@/lib/communities/icon";
import {
  CommunityChat,
  type CommunityMessage,
} from "@/components/communities/community-chat";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import {
  fetchPollResults,
  type PollOptionResult,
} from "@/app/(student)/communities/actions";

/**
 * Full-screen community chat room (UAT-007). The room used to be a tab inside
 * the community page; it now lives here and is reached from the Messages list,
 * exactly like an Instagram group chat. Same immersive shell as a 1:1 thread
 * (fixed viewport, dock hidden), with the community identity + a (Community)
 * badge in the header.
 */
export default async function CommunityChatPage({
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
    .select("id, name, avatar_url, cover_url, status")
    .eq("id", id)
    .single();
  if (!community) notFound();

  const { data: membership } = await supabase
    .from("community_members")
    .select("user_id")
    .eq("community_id", id)
    .eq("user_id", me)
    .maybeSingle();
  // Only members can see the room; bounce everyone else to the community page.
  if (!membership || community.status !== "approved") redirect(`/communities/${id}`);

  const { data: rows } = await supabase
    .from("community_chat_view")
    .select(
      "id, sender_id, sender_name, sender_avatar, body, poll_id, is_anonymous, created_at"
    )
    .eq("community_id", id)
    .order("created_at", { ascending: true })
    .limit(100);
  const chatMessages = (rows as CommunityMessage[]) ?? [];
  const polls: Record<string, PollOptionResult[]> = await fetchPollResults(
    [...new Set(chatMessages.map((m) => m.poll_id).filter(Boolean) as string[])]
  );

  // The shell height shrinks by --kb when the iOS keyboard overlays the
  // viewport (Phase 2 keyboard fix — see use-keyboard-inset.ts); 0 elsewhere.
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
        <Link
          href={`/communities/${id}`}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <div className="glass relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
            {community.cover_url || community.avatar_url ? (
              <AppImage
                src={community.cover_url ?? community.avatar_url}
                alt=""
                sizes="36px"
              />
            ) : (
              <span className="text-lg" aria-hidden>
                {communityIcon(community.name)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5">
              <span className="truncate font-semibold">{community.name}</span>
              <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                Community
              </span>
            </p>
            <p className="truncate text-[11px] text-fg-muted">Community chat room</p>
          </div>
        </Link>
      </header>

      <CommunityChat
        communityId={id}
        meId={me}
        initialMessages={chatMessages}
        initialPolls={polls}
      />
    </div>
  );
}
