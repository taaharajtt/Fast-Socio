import Link from "next/link";
import { DmMessageRow, type DmMessage } from "@/components/admin/dm-message-row";
import { getAdminContext } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";

/**
 * Full DM transcript viewer. Reading a conversation is itself audited
 * (admin_dm_messages logs a `dm.view` action) — this is a deliberate
 * privacy/moderation trade-off (full DM browser).
 */
export default async function DmTranscriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await getAdminContext();
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.rpc("admin_dm_messages", { p_conversation_id: id });
  const messages = (data ?? []) as DmMessage[];

  return (
    <>
      <Link
        href="/admin/content?tab=dm"
        className="font-mono text-[11px] uppercase tracking-wide text-fg-muted hover:text-fg"
      >
        ← Conversations
      </Link>

      <header className="mb-4 mt-2 border-b border-glass-border pb-4">
        <h1 className="text-lg font-semibold tracking-tight text-fg">DM transcript</h1>
        <p className="mt-1 font-mono text-[11px] text-fg-muted">
          {messages.length} messages · conversation {id.slice(0, 8)} · viewing is audited
        </p>
      </header>

      <div className="space-y-2">
        {messages.length === 0 ? (
          <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
            No messages in this conversation.
          </p>
        ) : (
          messages.map((m) => <DmMessageRow key={m.id} msg={m} conversationId={id} />)
        )}
      </div>
    </>
  );
}
