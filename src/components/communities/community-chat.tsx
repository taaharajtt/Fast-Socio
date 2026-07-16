"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Plus, Send, VenetianMask, X } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { clockTime, absoluteTime } from "@/lib/time";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { createClient } from "@/lib/supabase/client";
import { PollCard } from "@/components/communities/poll-card";
import {
  createCommunityPoll,
  sendCommunityMessage,
  voteCommunityPoll,
  type PollOptionResult,
} from "@/app/(student)/communities/actions";

/**
 * A row of `community_chat_view` — sender_id/name/avatar are null on someone
 * else's anonymous message, masked by the view.
 */
export type CommunityMessage = {
  id: string;
  sender_id: string | null;
  sender_name: string | null;
  sender_avatar: string | null;
  body: string;
  poll_id: string | null;
  is_anonymous: boolean;
  created_at: string;
};

const VIEW_COLUMNS =
  "id, sender_id, sender_name, sender_avatar, body, poll_id, is_anonymous, created_at";

export function CommunityChat({
  communityId,
  meId,
  initialMessages,
  initialPolls,
}: {
  communityId: string;
  meId: string;
  initialMessages: CommunityMessage[];
  initialPolls: Record<string, PollOptionResult[]>;
}) {
  const [messages, setMessages] = useState<CommunityMessage[]>(initialMessages);
  const [polls, setPolls] = useState(initialPolls);
  const [draft, setDraft] = useState("");
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composingPoll, setComposingPoll] = useState(false);

  // iOS keyboard: exposes the keyboard overlap as --kb so the fixed chat shell
  // shrinks and the sticky composer stays visible (Phase 2 keyboard fix).
  useKeyboardInset();

  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  /** Re-read one poll's tallies (after our vote, or a broadcast that someone voted). */
  const refreshPoll = useCallback(async (pollId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("community_poll_results")
      .select("poll_id, option_id, label, position, votes, voted_by_me")
      .eq("poll_id", pollId)
      .order("position", { ascending: true });
    if (!data) return;
    setPolls((prev) => ({
      ...prev,
      [pollId]: data.map((r) => ({
        option_id: r.option_id as string,
        label: r.label as string,
        position: r.position as number,
        votes: Number(r.votes),
        voted_by_me: Boolean(r.voted_by_me),
      })),
    }));
  }, []);

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
            const id = (payload.new as { id: string }).id;
            // The realtime payload is the RAW table row, so it carries the true
            // sender_id even for anonymous messages. Never render it — refetch
            // through community_chat_view, which applies the masking.
            const { data } = await supabase
              .from("community_chat_view")
              .select(VIEW_COLUMNS)
              .eq("id", id)
              .maybeSingle();
            if (!data) return;
            const m = data as CommunityMessage;
            setMessages((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m]
            );
            if (m.poll_id) refreshPoll(m.poll_id);
          }
        )
        // Ballots are private, so votes can't be broadcast via postgres_changes.
        // The voter announces the poll id and everyone re-reads the tallies.
        .on("broadcast", { event: "poll_vote" }, ({ payload }) => {
          const pollId = (payload as { pollId?: string })?.pollId;
          if (pollId) refreshPoll(pollId);
        })
        .subscribe();

      channelRef.current = channel;
    })();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [communityId, refreshPoll]);

  // Scroll the list container directly (not scrollIntoView, which also scrolls
  // ancestors and jumped the page when the keyboard opened). First paint jumps
  // instantly; new messages scroll smoothly.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!didInitialScroll.current) {
      el.scrollTop = el.scrollHeight;
      didInitialScroll.current = true;
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
    const res = await sendCommunityMessage(communityId, text, anon);
    setBusy(false);
    if (!res.ok) {
      setDraft(text);
      setError(res.error);
    }
  }

  async function onVote(pollId: string, optionId: string) {
    const res = await voteCommunityPoll(pollId, optionId);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await refreshPoll(pollId);
    channelRef.current?.send({
      type: "broadcast",
      event: "poll_vote",
      payload: { pollId },
    });
  }

  async function onCreatePoll(question: string, options: string[]) {
    const res = await createCommunityPoll(communityId, question, options, anon);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setComposingPoll(false);
    return true;
  }

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-fg-muted">
            No messages yet — say hello 👋
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === meId;
          const anonymous = m.is_anonymous;
          const displayName = anonymous
            ? mine
              ? "You (anonymous)"
              : "Anonymous"
            : (m.sender_name ?? "Member");
          return (
            <div
              key={m.id}
              className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}
            >
              {!mine && (
                <div className="glass relative mt-auto flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
                  {anonymous ? (
                    <VenetianMask className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
                  ) : m.sender_avatar ? (
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
                  <p
                    className={cn(
                      "mb-0.5 flex items-center gap-1 text-xs font-semibold",
                      anonymous ? "text-fg-muted" : "text-aura"
                    )}
                  >
                    {anonymous && <VenetianMask className="h-3 w-3" aria-hidden />}
                    {displayName}
                  </p>
                )}
                {m.poll_id && polls[m.poll_id] ? (
                  <PollCard
                    question={m.body}
                    options={polls[m.poll_id]}
                    mine={mine}
                    onVote={(optionId) => onVote(m.poll_id!, optionId)}
                  />
                ) : (
                  m.body
                )}
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

      {composingPoll && (
        <PollComposer
          onCancel={() => setComposingPoll(false)}
          onSubmit={onCreatePoll}
        />
      )}

      <form
        onSubmit={onSend}
        className="sticky bottom-0 space-y-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Create a poll"
            aria-pressed={composingPoll}
            onClick={() => setComposingPoll((p) => !p)}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
              composingPoll ? "bg-aura text-white" : "glass text-fg-muted"
            )}
          >
            <BarChart3 className="h-5 w-5" aria-hidden />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={anon ? "Message anonymously…" : "Message the community…"}
            // min-w-0 lets the input shrink so the Send button stays on-screen
            // on narrow viewports instead of being pushed off the row.
            className="glass h-11 min-w-0 flex-1 rounded-[var(--radius-pill)] px-4 text-base text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
          />
          <GlassButton
            type="submit"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label="Send"
            disabled={busy || draft.trim().length === 0}
          >
            <Send className="h-5 w-5" aria-hidden />
          </GlassButton>
        </div>

        {/* UAT-005: anonymity lives here, in the open chat room — not in the
            moderated Main panel where posts are attributed. */}
        <button
          type="button"
          onClick={() => setAnon((a) => !a)}
          aria-pressed={anon}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
            anon ? "bg-aura text-white" : "glass text-fg-muted"
          )}
        >
          <VenetianMask className="h-3.5 w-3.5" aria-hidden />
          {anon ? "Posting anonymously" : "Post anonymously"}
        </button>
      </form>

      {error && <p className="pb-2 text-sm text-error">{error}</p>}
    </div>
  );
}

/** Inline poll builder: a question plus 2–6 options. */
function PollComposer({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (question: string, options: string[]) => Promise<boolean>;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [busy, setBusy] = useState(false);

  const filled = options.filter((o) => o.trim()).length;
  const valid = question.trim().length > 0 && filled >= 2;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    const ok = await onSubmit(question, options);
    setBusy(false);
    if (ok) {
      setQuestion("");
      setOptions(["", ""]);
    }
  }

  return (
    <div className="glass mb-2 space-y-2 rounded-[var(--radius-md)] p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-fg">New poll</p>
        <button
          type="button"
          aria-label="Cancel poll"
          onClick={onCancel}
          className="flex h-7 w-7 items-center justify-center rounded-full text-fg-muted"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value.slice(0, 300))}
        placeholder="Ask a question…"
        className="h-10 w-full rounded-[var(--radius-sm)] bg-input-bg px-3 text-base text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
      />

      {options.map((value, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={value}
            onChange={(e) =>
              setOptions((prev) =>
                prev.map((o, j) => (j === i ? e.target.value.slice(0, 80) : o))
              )
            }
            placeholder={`Option ${i + 1}`}
            className="h-10 flex-1 rounded-[var(--radius-sm)] bg-input-bg px-3 text-base text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
          />
          {options.length > 2 && (
            <button
              type="button"
              aria-label={`Remove option ${i + 1}`}
              onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2">
        {options.length < 6 && (
          <button
            type="button"
            onClick={() => setOptions((prev) => [...prev, ""])}
            className="flex items-center gap-1 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-fg-muted"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add option
          </button>
        )}
        <GlassButton
          size="sm"
          className="ml-auto"
          onClick={submit}
          disabled={!valid || busy}
        >
          {busy ? "Posting…" : "Post poll"}
        </GlassButton>
      </div>
    </div>
  );
}
