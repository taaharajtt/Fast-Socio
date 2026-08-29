import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  ChatThread,
  type ChatMessage,
  type SharedPostPreview,
} from "@/components/chat/chat-thread";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import { OnlineDot } from "@/components/ui/badges";
import { isOnline } from "@/lib/time";
import { activityLabel } from "@/lib/chat/status-labels";
import {
  chatMediaPath,
  CHAT_MEDIA_TTL_SECONDS,
  MESSAGE_PAGE_SIZE,
} from "@/lib/chat-media";
import { presignDownload } from "@/lib/s3/sign";
import { ThreadMenu } from "@/components/chat/thread-menu";
import type { ReplyPreview } from "@/app/(student)/chat/actions";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ report?: string }>;
}) {
  const { id } = await params;
  // ?report=1 is how the header menu hands "Report messages" to the thread —
  // read here and passed as a prop rather than via useSearchParams in the
  // client component, which would need its own Suspense boundary under PPR.
  const { report } = await searchParams;
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip; RLS is authoritative.
  const me = (await getAuthUserId())!;

  // RLS ensures the caller is a participant; otherwise no row is returned.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, user_low, user_high")
    .eq("id", id)
    .single();
  if (!conv) notFound();

  const otherId = conv.user_low === me ? conv.user_high : conv.user_low;
  const [{ data: other }, { data: otherPresence }, { data: msgs }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, avatar_url, gender, department, read_receipts")
      .eq("id", otherId)
      .single(),
    // Presence now comes from profile_presence (mig 0092). This header used to
    // read profiles.last_seen_at directly and never checked show_online, so a
    // user who had turned presence off still showed an online dot here. The RLS
    // policy now decides: no row means offline, with nothing to forget.
    supabase
      .from("profile_presence")
      .select("last_seen_at")
      .eq("id", otherId)
      .maybeSingle(),
    supabase
      .from("messages")
      // select * (not an explicit list) so this query keeps working before the
      // shared_post_id column exists; the preview shows shares once migrated.
      // Bound the initial load to the most recent page (P4-01) — descending here,
      // reversed to chronological below; older messages load on demand.
      .select("*")
      .eq("conversation_id", id)
      .eq("hidden", false) // moderated-away messages are not shown (P3-03)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE),
  ]);

  // Reverse the most-recent-first page back into chronological order for display.
  const messages = ((msgs as ChatMessage[]) ?? []).slice().reverse();
  const hasMore = (msgs?.length ?? 0) === MESSAGE_PAGE_SIZE;

  // chat-media is private (P5-01): resolve a short-lived presigned URL for each
  // attachment on the server-rendered first paint. The client signer
  // (lib/chat-media-sign.ts) does the same for messages that arrive later.
  //
  // No display-size transform any more. Supabase Storage could resize while
  // signing; Contabo cannot, and imgproxy is deliberately restricted to the
  // PUBLIC bucket prefixes, so it must not — and could not — fetch a private
  // chat attachment. Bubbles therefore receive the full-size object and scale
  // it in CSS. Uploads are already capped at ~1080p client-side, so this costs
  // bytes on a chat thread but keeps private media private, which matters more.
  //
  // Authorization is unchanged in substance: the caller is already established
  // as a participant of this conversation above, and the URL is short-lived.
  const signedAttachments: Record<string, string> = {};
  for (const m of messages) {
    if (!m.attachment_url) continue;
    const path = chatMediaPath(m.attachment_url);
    if (!path) continue;
    signedAttachments[m.id] = presignDownload("chat-media", path, CHAT_MEDIA_TTL_SECONDS);
  }
  const sharedIds = [
    ...new Set(
      messages.map((m) => m.shared_post_id).filter(Boolean) as string[]
    ),
  ];
  // UAT-010: enough to render a real preview card in the bubble, not just a
  // "tap to view" stub. feed_posts already masks the author of an anonymous
  // post and hides posts from blocked users, so a share can't leak either.
  // UAT-005: initial reactions for the loaded page of messages. RLS scopes rows
  // to conversation participants. Aggregated into chips client-side.
  const reactions: Record<string, { emoji: string; user_id: string }[]> = {};
  const messageIds = messages.map((m) => m.id);
  if (messageIds.length > 0) {
    const { data: reactRows } = await supabase
      .from("message_reactions")
      .select("message_id, emoji, user_id")
      .in("message_id", messageIds);
    for (const r of reactRows ?? []) {
      (reactions[r.message_id] ??= []).push({ emoji: r.emoji, user_id: r.user_id });
    }
  }

  // Quoted (replied-to) messages for this page (mig 0167). Most targets are
  // already in `messages`; only the ones that fall outside the loaded window
  // cost a query, and it is scoped to this conversation like every other read.
  const replyPreviews: Record<string, ReplyPreview> = {};
  const loadedById = new Map(messages.map((m) => [m.id, m]));
  const missingReplyIds: string[] = [];
  for (const m of messages) {
    const target = m.reply_to_id;
    if (!target || replyPreviews[target]) continue;
    const local = loadedById.get(target);
    if (local) {
      replyPreviews[target] = {
        id: local.id,
        sender_id: local.sender_id,
        body: local.body,
        attachment_type: local.attachment_type,
        shared_post_id: local.shared_post_id,
        deleted_at: local.deleted_at,
      };
    } else if (!missingReplyIds.includes(target)) {
      missingReplyIds.push(target);
    }
  }
  if (missingReplyIds.length > 0) {
    const { data: replyRows } = await supabase
      .from("messages")
      .select("id, sender_id, body, attachment_type, shared_post_id, deleted_at")
      .eq("conversation_id", id)
      .in("id", missingReplyIds);
    for (const r of (replyRows ?? []) as ReplyPreview[]) replyPreviews[r.id] = r;
  }

  const sharedPosts: Record<string, SharedPostPreview> = {};
  if (sharedIds.length > 0) {
    const { data: preRows } = await supabase
      .from("feed_posts")
      .select(
        "id, body, image_url, is_anonymous, author_name, author_avatar, author_gender, like_count, comment_count"
      )
      .in("id", sharedIds);
    (preRows ?? []).forEach((p) => {
      sharedPosts[p.id] = {
        body: p.body,
        image_url: p.image_url,
        is_anonymous: p.is_anonymous,
        author_name: p.author_name,
        author_avatar: p.author_avatar,
        author_gender: p.author_gender,
        like_count: p.like_count ?? 0,
        comment_count: p.comment_count ?? 0,
      };
    });
  }

  // The shell height shrinks by --kb when the iOS keyboard overlays the
  // viewport (Phase 2 keyboard fix — see use-keyboard-inset.ts); 0 elsewhere.
  return (
    <div className="fixed inset-0 z-40 mx-auto flex h-[calc(100dvh-var(--kb,0px))] max-w-md flex-col overflow-hidden bg-bg px-4">
      {/* Back · avatar · name · activity, and the overflow menu. No divider and
          no extra metadata — the header floats on the thread background. */}
      <header className="flex shrink-0 items-center gap-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/chat"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        {/* Tapping the avatar/name opens the other person's profile — the same
            affordance every other avatar in the app has. */}
        <Link
          href={`/profile/${otherId}`}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <div className="relative shrink-0">
            <div className="glass relative h-9 w-9 overflow-hidden rounded-full">
              {resolveAvatarUrl(other?.avatar_url, other?.gender) ? (
                <AppImage
                  src={resolveAvatarUrl(other?.avatar_url, other?.gender)!}
                  alt={other?.full_name ?? "Match"}
                  sizes="36px"
                  priority
                />
              ) : null}
            </div>
            {/* UAT-003: the dot used to be unconditional, so every match looked
                online. It now tracks the other user's heartbeat — and only when
                they publish it (mig 0092 enforces show_online in RLS). */}
            {isOnline(otherPresence?.last_seen_at) && <OnlineDot />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">
              {other?.full_name ?? "Student"}
            </p>
            {/* App-wide activity, NOT "they read your message" — and absent
                entirely for anyone who hides their activity status (RLS
                returns no presence row, so this is null) or was last seen
                before yesterday. */}
            {activityLabel(otherPresence?.last_seen_at) && (
              <p className="truncate text-[11px] text-fg-muted">
                {activityLabel(otherPresence?.last_seen_at)}
              </p>
            )}
          </div>
        </Link>
        <ThreadMenu conversationId={id} />
      </header>

      <ChatThread
        conversationId={id}
        meId={me}
        initialMessages={messages}
        sharedPosts={sharedPosts}
        hasMore={hasMore}
        initialSignedAttachments={signedAttachments}
        initialReactions={reactions}
        initialReplyPreviews={replyPreviews}
        showReadReceipts={
          (other as { read_receipts?: boolean } | null)?.read_receipts !== false
        }
        otherName={other?.full_name ?? null}
        reportParam={report ?? null}
      />
    </div>
  );
}
