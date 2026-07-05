"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { sendCommunityMessage } from "@/app/(student)/communities/actions";

export type CommunityMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type Sender = { name: string | null; avatar: string | null };

export function CommunityChat({
  communityId,
  meId,
  initialMessages,
  initialSenders,
}: {
  communityId: string;
  meId: string;
  initialMessages: CommunityMessage[];
  initialSenders: Record<string, Sender>;
}) {
  const [messages, setMessages] = useState<CommunityMessage[]>(initialMessages);
  const [senders, setSenders] = useState<Record<string, Sender>>(initialSenders);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) supabase.realtime.setAuth(session.access_token);

      const channel = supabase
        .channel(`community-chat:${communityId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "community_chat_messages",
            filter: `community_id=eq.${communityId}`,
          },
          async (payload) => {
            const m = payload.new as CommunityMessage;
            setMessages((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m]
            );
            // Resolve an unknown sender's profile lazily.
            setSenders((prev) => {
              if (prev[m.sender_id]) return prev;
              supabase
                .from("profiles")
                .select("full_name, avatar_url")
                .eq("id", m.sender_id)
                .single()
                .then(({ data }) => {
                  if (data)
                    setSenders((s) => ({
                      ...s,
                      [m.sender_id]: {
                        name: data.full_name,
                        avatar: data.avatar_url,
                      },
                    }));
                });
              return prev;
            });
          }
        )
        .subscribe();

      channelRef.current = channel;
    })();

    return () => {
      if (channelRef.current) createClient().removeChannel(channelRef.current);
    };
  }, [communityId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
    const res = await sendCommunityMessage(communityId, text);
    setBusy(false);
    if (!res.ok) {
      setDraft(text);
      setError(res.error);
    }
  }

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-fg-muted">
            No messages yet — say hello 👋
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === meId;
          const s = senders[m.sender_id];
          return (
            <div
              key={m.id}
              className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}
            >
              {!mine && (
                <div className="glass mt-auto h-7 w-7 shrink-0 overflow-hidden rounded-full">
                  {s?.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.avatar}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
              )}
              <div
                className={cn(
                  "max-w-[78%] rounded-2xl px-4 py-2 text-[15px]",
                  mine
                    ? "gradient-brand rounded-br-md text-white"
                    : "glass rounded-bl-md text-fg"
                )}
              >
                {!mine && (
                  <p className="mb-0.5 text-xs font-semibold text-aura">
                    {s?.name ?? "Member"}
                  </p>
                )}
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
          placeholder="Message the community…"
          className="glass h-11 flex-1 rounded-[var(--radius-pill)] px-4 text-[15px] text-fg outline-none placeholder:text-fg-muted/70 focus:ring-2 focus:ring-aura/40"
        />
        <GlassButton
          type="submit"
          size="icon"
          className="h-11 w-11"
          aria-label="Send"
          disabled={busy || draft.trim().length === 0}
        >
          <Send className="h-5 w-5" aria-hidden />
        </GlassButton>
      </form>
      {error && <p className="pb-2 text-sm text-error">{error}</p>}
    </div>
  );
}
