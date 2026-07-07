import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Phone, Video } from "lucide-react";
import {
  ChatThread,
  type ChatMessage,
  type SharedPostPreview,
} from "@/components/chat/chat-thread";
import { createClient } from "@/lib/supabase/server";
import { AppImage } from "@/components/ui/app-image";
import {
  chatMediaPath,
  CHAT_MEDIA_TTL_SECONDS,
  MESSAGE_PAGE_SIZE,
} from "@/lib/chat-media";

export default async function ConversationPage({
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

  // RLS ensures the caller is a participant; otherwise no row is returned.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, user_low, user_high")
    .eq("id", id)
    .single();
  if (!conv) notFound();

  const otherId = conv.user_low === me ? conv.user_high : conv.user_low;
  const [{ data: other }, { data: msgs }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, avatar_url, department")
      .eq("id", otherId)
      .single(),
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

  // chat-media is private (P5-01): resolve a short-lived signed URL for each
  // attachment. Images are signed with a 1080px transform; voice notes as-is.
  const signedAttachments: Record<string, string> = {};
  await Promise.all(
    messages
      .filter((m) => m.attachment_url)
      .map(async (m) => {
        const path = chatMediaPath(m.attachment_url);
        if (!path) return;
        const { data: signed } = await supabase.storage
          .from("chat-media")
          .createSignedUrl(
            path,
            CHAT_MEDIA_TTL_SECONDS,
            m.attachment_type === "image"
              ? { transform: { width: 1080, height: 1080, resize: "contain" } }
              : undefined
          );
        if (signed?.signedUrl) signedAttachments[m.id] = signed.signedUrl;
      })
  );
  const sharedIds = [
    ...new Set(
      messages.map((m) => m.shared_post_id).filter(Boolean) as string[]
    ),
  ];
  const sharedPosts: Record<string, SharedPostPreview> = {};
  if (sharedIds.length > 0) {
    const { data: preRows } = await supabase
      .from("feed_posts")
      .select("id, body, image_url")
      .in("id", sharedIds);
    (preRows ?? []).forEach((p) => {
      sharedPosts[p.id] = { body: p.body, image_url: p.image_url };
    });
  }

  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-bg px-4">
      <header className="flex items-center gap-3 border-b border-glass-border py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/chat"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="relative shrink-0">
          <div className="glass relative h-9 w-9 overflow-hidden rounded-full">
            {other?.avatar_url ? (
              <AppImage
                src={other.avatar_url}
                alt={other.full_name ?? "Match"}
                sizes="36px"
              />
            ) : null}
          </div>
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-bg bg-success" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {other?.full_name ?? "Student"}
          </p>
          <p className="truncate text-[11px] text-fg-muted">
            {other?.department ? `${other.department} · ` : ""}Active now
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="glass flex h-8 w-8 items-center justify-center rounded-full text-fg-muted"
          >
            <Phone className="h-4 w-4" />
          </span>
          <span
            aria-hidden
            className="glass flex h-8 w-8 items-center justify-center rounded-full text-fg-muted"
          >
            <Video className="h-4 w-4" />
          </span>
        </div>
      </header>

      <ChatThread
        conversationId={id}
        meId={me}
        initialMessages={messages}
        sharedPosts={sharedPosts}
        hasMore={hasMore}
        initialSignedAttachments={signedAttachments}
      />
    </div>
  );
}
