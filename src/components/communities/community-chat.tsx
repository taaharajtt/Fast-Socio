"use client";

import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { shouldAutoScroll } from "@/lib/chat/scroll-anchor";
import { mergeMessage } from "@/lib/chat/message-merge";
import { MessageCircle, Plus, Trash2, VenetianMask, X } from "lucide-react";
import { GlassButton, GlassSheet } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ImageCropper, type CropResult } from "@/components/ui/image-cropper";
import { PhotoViewer } from "@/components/ui/photo-viewer";
import { ChatComposer } from "@/components/chat/chat-composer";
import { resolveAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { clockTime, absoluteTime } from "@/lib/time";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { renderLinkifiedText } from "@/lib/linkify";
import { createClient } from "@/lib/supabase/client";
import { uploadWithProgress } from "@/lib/storage-upload";
import { signChatMediaMany } from "@/lib/chat-media-sign";
import { PollCard } from "@/components/communities/poll-card";
import { DayDivider } from "@/components/chat/day-divider";
import { chatDayLabel, dayKey } from "@/lib/chat-day";
import {
  createCommunityPoll,
  deleteCommunityMessage,
  markCommunityChatRead,
  sendCommunityImage,
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
  sender_gender: string | null;
  body: string;
  poll_id: string | null;
  is_anonymous: boolean;
  created_at: string;
  /** Set once the message has been tombstoned (fix-051, mig 0142). */
  deleted_at: string | null;
  /** Raw `chat-media` storage path — signed at display time (fix-052). */
  attachment_url: string | null;
  attachment_type: string | null;
};

const VIEW_COLUMNS =
  "id, sender_id, sender_name, sender_avatar, sender_gender, body, poll_id, is_anonymous, created_at, deleted_at, attachment_url, attachment_type";

export function CommunityChat({
  communityId,
  meId,
  initialMessages,
  initialPolls,
  allowAnonymous = true,
  canModerate = false,
}: {
  communityId: string;
  meId: string;
  initialMessages: CommunityMessage[];
  initialPolls: Record<string, PollOptionResult[]>;
  /**
   * fix-058: Discover team rooms pass false. Anonymous posting is deliberately
   * absent there — decided in fix-018 — while community chat and campus chat
   * rooms keep it. This is the only per-surface difference in the composer.
   */
  allowAnonymous?: boolean;
  /** Viewer is the community owner or a moderator, so may delete any message. */
  canModerate?: boolean;
}) {
  const [messages, setMessages] = useState<CommunityMessage[]>(initialMessages);
  const [polls, setPolls] = useState(initialPolls);
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composingPoll, setComposingPoll] = useState(false);
  /** Signed URLs for attachment paths, resolved lazily. */
  const [signed, setSigned] = useState<Record<string, string>>({});
  /** The message whose action sheet is open. */
  const [actionsFor, setActionsFor] = useState<CommunityMessage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CommunityMessage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** The image currently open in the full-screen viewer (fix-057). */
  const [viewing, setViewing] = useState<CommunityMessage | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** The picked file, held while the crop dialog is open. */
  const [cropFile, setCropFile] = useState<File | null>(null);

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
            setMessages((prev) => mergeMessage(prev, m));
            if (m.poll_id) refreshPoll(m.poll_id);
            // The room is open right now, so a message that just arrived is
            // visible immediately — keep the read position moving instead of
            // leaving it stamped at whenever the room was first opened.
            markCommunityChatRead(communityId);
          }
        )
        .on(
          "postgres_changes",
          {
            // fix-051: a delete is a soft-delete UPDATE, so the tombstone has to
            // propagate to everyone in the room, not just the person who did it.
            event: "UPDATE",
            schema: "public",
            table: "community_chat_messages",
            filter: `community_id=eq.${communityId}`,
          },
          async (payload) => {
            const id = (payload.new as { id: string }).id;
            const { data } = await supabase
              .from("community_chat_view")
              .select(VIEW_COLUMNS)
              .eq("id", id)
              .maybeSingle();
            if (!data) return;
            const m = data as CommunityMessage;
            setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
          }
        )
        // Ballots are private, so votes can't be broadcast via postgres_changes.
        // The voter announces the poll id and everyone re-reads the tallies.
        .on("broadcast", { event: "poll_vote" }, ({ payload }) => {
          const pollId = (payload as { pollId?: string })?.pollId;
          if (pollId) refreshPoll(pollId);
        })
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || err) {
            console.error(
              `[chat] community chat realtime subscription failed for ${communityId}`,
              status,
              err
            );
          }
        });

      channelRef.current = channel;
    })();

    markCommunityChatRead(communityId);
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [communityId, refreshPoll]);

  // Scroll the list container directly (not scrollIntoView, which also scrolls
  // ancestors and jumped the page when the keyboard opened). First paint jumps
  // instantly; new messages scroll smoothly.
  // UAT-06: follow new messages ONLY when the reader is already at the bottom,
  // or when the newest message is their own. This used to scroll on every
  // change to `messages.length`, which drags someone reading history back to
  // the end whenever anyone speaks — and the scroll position they lose is not
  // recorded anywhere, so it cannot be given back. The decision is shared with
  // the DM thread via `lib/chat/scroll-anchor` and unit-tested there.
  const didInitialScroll = useRef(false);
  const newest = messages.length > 0 ? messages[messages.length - 1] : null;
  const newestId = newest?.id ?? null;
  const newestIsMine = newest?.sender_id === meId;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!didInitialScroll.current) {
      el.scrollTop = el.scrollHeight;
      didInitialScroll.current = true;
      return;
    }
    if (
      !shouldAutoScroll({
        metrics: {
          scrollTop: el.scrollTop,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
        },
        fromSelf: newestIsMine,
      })
    ) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [newestId, newestIsMine, messages.length]);

  // Resolve signed URLs for any attachment we haven't signed yet. The bucket is
  // private, so a raw path is useless without this.
  useEffect(() => {
    const pending = messages
      .filter(
        (m) =>
          m.attachment_url &&
          m.attachment_type === "image" &&
          !m.deleted_at &&
          !signed[m.attachment_url]
      )
      .map((m) => ({ path: m.attachment_url as string, type: "image" as const }));
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      const urls = await signChatMediaMany(pending);
      if (cancelled || urls.size === 0) return;
      setSigned((prev) => {
        const next = { ...prev };
        urls.forEach((url, path) => {
          next[path] = url;
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, signed]);

  async function onSend(text: string) {
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const res = await sendCommunityMessage(communityId, text, anon);
    setBusy(false);
    if (!res.ok) setError(res.error);
  }

  /** fix-052: picker → crop → upload → persist. Nothing reaches storage uncropped. */
  async function onCropped(result: CropResult) {
    setCropFile(null);
    setBusy(true);
    setError(null);
    const path = `${communityId}/${crypto.randomUUID()}.${result.extension}`;
    try {
      await uploadWithProgress("chat-media", path, result.blob, {
        contentType: result.mimeType,
      });
      const res = await sendCommunityImage(communityId, path, anon);
      if (!res.ok) setError(res.error);
    } catch {
      setError("Couldn't upload that image.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmDelete() {
    const target = confirmDelete;
    if (!target) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteCommunityMessage(target.id);
    setDeleting(false);
    if (!res.ok) {
      setDeleteError(res.error);
      return;
    }
    // Optimistic: tombstone in place immediately. Realtime UPDATE carries it to
    // everyone else in the room.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.id
          ? {
              ...m,
              body: "",
              poll_id: null,
              attachment_url: null,
              attachment_type: null,
              deleted_at: new Date().toISOString(),
            }
          : m
      )
    );
    setConfirmDelete(null);
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

  // The parent (SpaceShell's `fill` tab) hands this component a fixed height,
  // so the feed is the only thing that scrolls and the composer sits on the
  // bottom edge — no sticky positioning, no page-level scrolling.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4">
        {messages.length === 0 && (
          <div className="mt-8 flex flex-col items-center gap-2 text-center">
            <MessageCircle className="h-7 w-7 text-fg-muted" aria-hidden />
            <p className="text-sm text-fg-muted">Chat room is quiet. Say hello!</p>
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.sender_id === meId;
          // Day separators, same rules and same component as the DM thread.
          const prev = i > 0 ? messages[i - 1] : null;
          const showDay =
            !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const anonymous = m.is_anonymous;
          const deleted = Boolean(m.deleted_at);
          const isImage = !deleted && m.attachment_type === "image";
          const signedUrl = m.attachment_url ? signed[m.attachment_url] : undefined;
          const displayName = anonymous
            ? mine
              ? "You (anonymous)"
              : "Anonymous"
            : (m.sender_name ?? "Member");
          return (
            <Fragment key={m.id}>
              {showDay && <DayDivider label={chatDayLabel(m.created_at)} />}
              <div
                className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}
              >
              {!mine && (
                <div className="glass relative mt-auto flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
                  {anonymous ? (
                    <VenetianMask className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
                  ) : resolveAvatarUrl(m.sender_avatar, m.sender_gender) ? (
                    <AppImage
                      src={resolveAvatarUrl(m.sender_avatar, m.sender_gender)!}
                      alt=""
                      sizes="28px"
                    />
                  ) : null}
                </div>
              )}
              <div
                onContextMenu={(e) => {
                  // Long-press on touch surfaces as a context menu; this is the
                  // one gesture that opens the message actions (fix-051).
                  if (deleted || !(mine || canModerate)) return;
                  e.preventDefault();
                  setActionsFor(m);
                }}
                className={cn(
                  "max-w-[80%] text-[15px]",
                  // fix-052: an image IS the bubble — no padded wrapper around it.
                  isImage
                    ? "overflow-hidden rounded-2xl"
                    : cn(
                        "rounded-2xl px-4 py-2",
                        deleted
                          ? "border border-dashed border-glass-border bg-transparent text-fg-disabled"
                          : mine
                            ? "gradient-brand rounded-br-md text-white"
                            : "glass rounded-bl-md text-fg"
                      )
                )}
              >
                {!mine && !isImage && (
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

                {deleted ? (
                  <span className="text-[13px] italic">This message was deleted</span>
                ) : isImage ? (
                  signedUrl ? (
                    <button
                      type="button"
                      onClick={() => setViewing(m)}
                      aria-label="Open photo"
                      className="block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed,
                          transform-sized storage URL; next/image would re-proxy it. */}
                      <img
                        src={signedUrl}
                        alt=""
                        draggable={false}
                        className="block max-h-72 w-[220px] rounded-2xl object-cover"
                      />
                    </button>
                  ) : (
                    <div className="h-40 w-[220px] animate-pulse rounded-2xl bg-fg-muted/10" />
                  )
                ) : m.poll_id && polls[m.poll_id] ? (
                  <PollCard
                    pollId={m.poll_id}
                    question={m.body}
                    options={polls[m.poll_id]}
                    mine={mine}
                    onVote={(optionId) => onVote(m.poll_id!, optionId)}
                  />
                ) : (
                  renderLinkifiedText(m.body)
                )}

                {!isImage && (
                  <time
                    dateTime={m.created_at}
                    title={absoluteTime(m.created_at)}
                    className={cn(
                      "mt-0.5 block text-right text-[10px]",
                      deleted
                        ? "text-fg-disabled"
                        : mine
                          ? "text-white/70"
                          : "text-fg-muted"
                    )}
                  >
                    {clockTime(m.created_at)}
                  </time>
                )}
              </div>
              </div>
            </Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {composingPoll && (
          <PollComposer
            onCancel={() => setComposingPoll(false)}
            onSubmit={onCreatePoll}
          />
        )}

        {error && <p className="pb-1.5 text-sm text-error">{error}</p>}

        {/* fix-058/050/059: the one shared composer. Poll, anonymity and media
            are capabilities, not separate components — a Discover team room is
            the same component with `allowAnonymous={false}`. */}
        <ChatComposer
          placeholder={anon ? "Message anonymously..." : "Message..."}
          capabilities={{ poll: true, anonymous: allowAnonymous, media: true }}
          anonymous={anon}
          onToggleAnonymous={() => setAnon((a) => !a)}
          pollActive={composingPoll}
          onTogglePoll={() => setComposingPoll((p) => !p)}
          onPickImage={() => fileRef.current?.click()}
          onSend={onSend}
          busy={busy}
        />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so picking the same file twice still fires onChange.
            e.target.value = "";
            if (file) setCropFile(file);
          }}
        />
      </div>

      {/* Crop before upload — storage only ever receives the final image. */}
      {cropFile && (
        <ImageCropper
          file={cropFile}
          aspect={1}
          aspectOptions
          title="Send photo"
          onCancel={() => setCropFile(null)}
          onCropped={onCropped}
        />
      )}

      {/* fix-057: one full-screen viewer, shared with the DM thread. */}
      <PhotoViewer
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        src={viewing?.attachment_url ? (signed[viewing.attachment_url] ?? null) : null}
        senderName={
          viewing
            ? viewing.is_anonymous
              ? "Anonymous"
              : (viewing.sender_name ?? "Member")
            : null
        }
        timestamp={viewing?.created_at ?? null}
      />

      {/* fix-051: message actions. Only offered when the viewer may actually
          delete — but the RLS policy, not this sheet, is what enforces it. */}
      <GlassSheet
        open={Boolean(actionsFor)}
        onClose={() => setActionsFor(null)}
        label="Message options"
      >
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(actionsFor);
              setDeleteError(null);
              setActionsFor(null);
            }}
            className="glass flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm font-medium text-error"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete message
          </button>
        </div>
      </GlassSheet>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete message?"
        description="This removes the message for everyone in this room. A short 'message deleted' note stays in its place."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        pending={deleting}
        error={deleteError}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={onConfirmDelete}
      />
    </div>
  );
}

/** Inline poll builder: a question plus 2–6 options. */
/** Exported so the announcement thread posts polls with the same builder
 *  (fix-049 asks for the same component wherever possible). */
export function PollComposer({
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
