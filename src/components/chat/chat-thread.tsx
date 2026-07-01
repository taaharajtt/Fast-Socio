"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  sendMessage,
  markConversationRead,
} from "@/app/(student)/chat/actions";

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
};

export function ChatThread({
  conversationId,
  meId,
  initialMessages,
}: {
  conversationId: string;
  meId: string;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Subscribe to new messages in this conversation (RLS gates delivery).
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      // Realtime must carry the user's JWT or RLS filters out every row.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`conv:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const m = payload.new as ChatMessage;
            setMessages((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m]
            );
          }
        )
        .subscribe();
    })();

    markConversationRead(conversationId);
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    const res = await sendMessage(conversationId, text);
    setSending(false);
    if (!res.ok) {
      setDraft(text); // restore on failure
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-fg-muted">
            Say hello 👋
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === meId;
          return (
            <div
              key={m.id}
              className={cn("flex", mine ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[78%] rounded-2xl px-4 py-2 text-[15px]",
                  mine
                    ? "gradient-brand rounded-br-md text-white"
                    : "glass rounded-bl-md text-fg"
                )}
              >
                {m.body}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={onSend}
        className="sticky bottom-0 flex items-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message…"
          className="glass h-12 flex-1 rounded-[var(--radius-pill)] px-4 text-[15px] text-fg outline-none placeholder:text-fg-muted/70 focus:ring-2 focus:ring-aura/40"
        />
        <GlassButton
          type="submit"
          size="icon"
          className="h-12 w-12"
          aria-label="Send"
          disabled={sending || draft.trim().length === 0}
        >
          <Send className="h-5 w-5" aria-hidden />
        </GlassButton>
      </form>
    </div>
  );
}
