import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";
import { createClient } from "@/lib/supabase/server";

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
      .select("id, sender_id, body, created_at, read_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
  ]);

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
        <div className="glass h-9 w-9 shrink-0 overflow-hidden rounded-full">
          {other?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={other.avatar_url}
              alt={other.full_name ?? "Match"}
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {other?.full_name ?? "Student"}
          </p>
          {other?.department && (
            <p className="truncate text-xs text-fg-muted">
              {other.department}
            </p>
          )}
        </div>
      </header>

      <ChatThread
        conversationId={id}
        meId={me}
        initialMessages={(msgs as ChatMessage[]) ?? []}
      />
    </div>
  );
}
