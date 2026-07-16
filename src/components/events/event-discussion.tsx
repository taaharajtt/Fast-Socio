"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { clockTime, absoluteTime } from "@/lib/time";
import { createClient } from "@/lib/supabase/client";
import { sendEventMessage } from "@/app/(student)/events/actions";

export type EventMessage = {
  id: string;
  sender_id: string;
  sender_name: string | null;
  sender_avatar: string | null;
  body: string;
  created_at: string;
};

const SELECT =
  "id, sender_id, body, created_at, sender:profiles(full_name, avatar_url)";

type Row = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender: { full_name: string | null; avatar_url: string | null } | null;
};

function toMessage(r: Row): EventMessage {
  return {
    id: r.id,
    sender_id: r.sender_id,
    body: r.body,
    created_at: r.created_at,
    sender_name: r.sender?.full_name ?? null,
    sender_avatar: r.sender?.avatar_url ?? null,
  };
}

/**
 * Attendee discussion for an event (Refactor Phase 6). Realtime, attributed
 * (no anonymity — attendees coordinate openly). Non-attendees see a read-only
 * prompt to register.
 */
export function EventDiscussion({
  eventId,
  meId,
  canPost,
  initialMessages,
}: {
  eventId: string;
  meId: string;
  canPost: boolean;
  initialMessages: EventMessage[];
}) {
  const [messages, setMessages] = useState<EventMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`event-chat:${eventId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "event_messages",
            filter: `event_id=eq.${eventId}`,
          },
          async (payload) => {
            const id = (payload.new as { id: string }).id;
            const { data } = await supabase
              .from("event_messages")
              .select(SELECT)
              .eq("id", id)
              .maybeSingle();
            if (!data) return;
            const m = toMessage(data as unknown as Row);
            setMessages((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m]
            );
          }
        )
        .subscribe();
    })();

    return () => {
      if (channel) createClient().removeChannel(channel);
    };
  }, [eventId]);

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
    const res = await sendEventMessage(eventId, text);
    setBusy(false);
    if (!res.ok) {
      setDraft(text);
      setError(res.error);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="max-h-[50vh] flex-1 space-y-3 overflow-y-auto py-2">
        {messages.length === 0 && (
          <p className="py-6 text-center text-sm text-fg-muted">
            No messages yet{canPost ? " — start the conversation 👋" : "."}
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === meId;
          return (
            <div
              key={m.id}
              className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}
            >
              {!mine && (
                <div className="glass relative mt-auto flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
                  {m.sender_avatar ? (
                    <AppImage src={m.sender_avatar} alt="" sizes="28px" />
                  ) : null}
                </div>
              )}
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-2 text-[15px]",
                  mine
                    ? "gradient-brand rounded-br-md text-white"
                    : "glass rounded-bl-md text-fg"
                )}
              >
                {!mine && (
                  <p className="mb-0.5 text-xs font-semibold text-aura">
                    {m.sender_name ?? "Attendee"}
                  </p>
                )}
                {m.body}
                <time
                  dateTime={m.created_at}
                  title={absoluteTime(m.created_at)}
                  className={cn(
                    "mt-0.5 block text-right text-[10px]",
                    mine ? "text-white/70" : "text-fg-muted"
                  )}
                >
                  {clockTime(m.created_at)}
                </time>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {canPost ? (
        <form onSubmit={onSend} className="mt-2 flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message attendees…"
            // min-w-0 lets the input shrink so the Send button stays on-screen
            // on narrow viewports instead of being pushed off the row.
            className="glass h-11 min-w-0 flex-1 rounded-[var(--radius-pill)] px-4 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
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
      ) : (
        <p className="mt-2 rounded-[var(--radius-md)] bg-card p-3 text-center text-sm text-fg-muted">
          Register to join the discussion.
        </p>
      )}
      {error && <p className="mt-1 text-sm text-error">{error}</p>}
    </div>
  );
}
