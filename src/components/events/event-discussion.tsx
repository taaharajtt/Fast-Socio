"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { shouldAutoScroll } from "@/lib/chat/scroll-anchor";
import { LoadEarlier } from "@/components/chat/load-earlier";
import { useMessageHistory } from "@/components/chat/use-message-history";
import { loadEarlierEventMessages } from "@/app/(student)/events/history-actions";
import {
  dropOptimistic,
  mergeMessage,
  mergeMessages,
  newestServerCursor,
  resolveOptimistic,
} from "@/lib/chat/message-merge";
import { Check, Flag, MessagesSquare, Pencil, Reply, Trash2, X } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ImageCropper, type CropResult } from "@/components/ui/image-cropper";
import { PhotoViewer } from "@/components/ui/photo-viewer";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ReplyBanner } from "@/components/chat/reply-banner";
import { GroupMessageRow } from "@/components/chat/group-message-row";
import {
  MessageActionsSheet,
  type MessageAction,
} from "@/components/chat/message-actions-sheet";
import { ReportReasonSheet } from "@/components/chat/report-reason-sheet";
import { DayDivider } from "@/components/chat/day-divider";
import { chatDayLabel, dayKey } from "@/lib/chat-day";
import { useMessagePress } from "@/lib/chat/use-message-press";
import { useReactionMap } from "@/lib/chat/use-reaction-map";
import { hasMyReaction, type MessageReaction } from "@/lib/chat/reactions";
import {
  fromEventRow,
  isInert,
  toQuotable,
} from "@/lib/chat/conversation-message";
import { replyPreviewText } from "@/lib/chat/reply-preview";
import {
  useRealtimeChannel,
  useVisibilityRefresh,
} from "@/lib/realtime/use-realtime-channel";
import { resolveAvatarUrl } from "@/lib/avatar";
import { createClient } from "@/lib/supabase/client";
import { uploadWithProgress } from "@/lib/storage-upload";
import { signChatMediaMany } from "@/lib/chat-media-sign";
import {
  deleteEventMessage,
  editEventMessage,
  reportEventMessage,
  sendEventMessage,
  toggleEventMessageReaction,
} from "@/app/(student)/events/actions";

export type EventMessage = {
  id: string;
  sender_id: string;
  sender_name: string | null;
  sender_avatar: string | null;
  body: string;
  created_at: string;
  /** mig 0179 — reply/edit/unsend/attachment, bringing the thread to DM parity. */
  edited_at: string | null;
  deleted_at: string | null;
  reply_to_id: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  /** Client-only: an optimistic bubble's lifecycle. */
  _status?: "sending" | "error";
  /** Client-only: object-URL preview for an image still uploading. */
  _localSrc?: string;
};

const SELECT =
  "id, sender_id, body, created_at, edited_at, deleted_at, reply_to_id, attachment_url, attachment_type, sender:profiles(full_name, avatar_url, gender)";

/** A catch-up read is bounded; a longer gap is served by the page's own read. */
const CATCH_UP_LIMIT = 200;

type Row = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_to_id: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  sender: {
    full_name: string | null;
    avatar_url: string | null;
    gender: string | null;
  } | null;
};

function toMessage(r: Row): EventMessage {
  return {
    id: r.id,
    sender_id: r.sender_id,
    body: r.body,
    created_at: r.created_at,
    edited_at: r.edited_at,
    deleted_at: r.deleted_at,
    reply_to_id: r.reply_to_id,
    attachment_url: r.attachment_url,
    attachment_type: r.attachment_type,
    sender_name: r.sender?.full_name ?? null,
    sender_avatar: resolveAvatarUrl(r.sender?.avatar_url, r.sender?.gender),
  };
}

/**
 * Attendee discussion for an event (Refactor Phase 6), brought to Messages
 * parity by mig 0179: replies, reactions, photo attachments, edit, unsend,
 * optimistic sends with retry, and a real catch-up on reconnect.
 *
 * ATTENDEE GATING IS UNCHANGED AND IS NOT A UI RULE. `canPost` decides what to
 * DRAW; the database decides what happens. Reading needs an `event_attendees`
 * row (or the host / an admin) through the SELECT policy, posting needs one on
 * an APPROVED event through the INSERT policy, editing needs authorship through
 * the UPDATE policy, and reacting goes through an RPC that re-checks
 * `can_post_event_message`. A non-attendee who calls any of these directly is
 * refused by Postgres, not by this component.
 */
export function EventDiscussion({
  eventId,
  meId,
  canPost,
  canModerate = false,
  initialMessages,
  initialReactions = {},
  hasMoreHistory = false,
}: {
  eventId: string;
  meId: string;
  /** Viewer is a registered attendee of an approved event. */
  canPost: boolean;
  /** Viewer hosts or organizes the event, so may remove anyone's message. */
  canModerate?: boolean;
  initialMessages: EventMessage[];
  initialReactions?: Record<string, MessageReaction[]>;
  /** The server saw older rows beyond the first page of ten. */
  hasMoreHistory?: boolean;
}) {
  const [messages, setMessages] = useState<EventMessage[]>(initialMessages);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [replyTo, setReplyTo] = useState<EventMessage | null>(null);
  const [actionsFor, setActionsFor] = useState<EventMessage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<EventMessage | null>(null);
  const [reporting, setReporting] = useState<EventMessage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [viewing, setViewing] = useState<EventMessage | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [burstId, setBurstId] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef<Map<string, () => Promise<void>>>(new Map());
  const pendingSendsRef = useRef(0);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    []
  );

  const {
    reactions,
    setReactions,
    react: toggleReaction,
    refresh: refreshReactions,
    chipsFor,
  } = useReactionMap({
    meId,
    initial: initialReactions,
    load: async (ids) => {
      const supabase = createClient();
      const { data } = await supabase
        .from("event_message_reactions")
        .select("message_id, emoji, user_id")
        .in("message_id", ids);
      return (data ?? []) as { message_id: string; emoji: string; user_id: string }[];
    },
    toggle: async (messageId, emoji) => {
      const res = await toggleEventMessageReaction(messageId, emoji);
      return res.ok;
    },
    onError: setError,
  });

  const signAll = useCallback(async (rows: EventMessage[]) => {
    const pending = rows
      .filter((m) => m.attachment_url && m.attachment_type === "image" && !m.deleted_at)
      .map((m) => ({ path: m.attachment_url as string, type: "image" as const }));
    if (pending.length === 0) return;
    const urls = await signChatMediaMany(pending);
    if (urls.size === 0) return;
    setSigned((prev) => {
      const next = { ...prev };
      urls.forEach((url, path) => {
        next[path] = url;
      });
      return next;
    });
  }, []);

  const readOne = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("event_messages")
      .select(SELECT)
      .eq("id", id)
      .maybeSingle();
    return data ? toMessage(data as unknown as Row) : null;
  }, []);

  /**
   * Catch-up read. `postgres_changes` cannot replay, so anything published
   * while the socket was down is recoverable only by asking for it. Reactions
   * are re-read alongside, because they never travel over the socket at all
   * (mig 0179 keeps them out of the WAL publication deliberately).
   */
  const catchUp = useCallback(async () => {
    try {
      const supabase = createClient();
      const cursor = newestServerCursor(messagesRef.current);
      let query = supabase.from("event_messages").select(SELECT).eq("event_id", eventId);
      if (cursor) {
        query = query.or(
          `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`
        );
      }
      const { data } = await query
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(CATCH_UP_LIMIT);
      const rows = ((data ?? []) as unknown as Row[]).map(toMessage);
      if (rows.length > 0) {
        setMessages((prev) => mergeMessages(prev, rows));
        signAll(rows);
      }
      refreshReactions(
        messagesRef.current.map((m) => m.id).concat(rows.map((m) => m.id))
      );
    } catch {
      // Leave what is on screen; the next resume, event or poll tries again.
    }
  }, [eventId, refreshReactions, signAll]);

  const channelRef = useRealtimeChannel({
    name: `event-chat:${eventId}`,
    // Static: the event id must never reach telemetry.
    label: "event discussion",
    onCatchUp: () => void catchUp(),
    build: (channel) =>
      channel
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "event_messages",
            filter: `event_id=eq.${eventId}`,
          },
          async (payload) => {
            const raw = payload.new as { id: string; sender_id: string };
            // My own row is left to the send response while one is in flight,
            // so the optimistic bubble and the real row are never both drawn.
            if (raw.sender_id === meId && pendingSendsRef.current > 0) return;
            // The raw payload has no joined author, so it is re-read.
            const m = await readOne(raw.id);
            if (!m) return;
            setMessages((prev) => mergeMessage(prev, m));
            signAll([m]);
          }
        )
        .on(
          "postgres_changes",
          {
            // Edits and tombstones (mig 0179) must reach everyone in the
            // thread, not just the person who made them.
            event: "UPDATE",
            schema: "public",
            table: "event_messages",
            filter: `event_id=eq.${eventId}`,
          },
          async (payload) => {
            const m = await readOne((payload.new as { id: string }).id);
            if (!m) return;
            setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
          }
        )
        // Reactions sync by broadcast rather than by WAL — see mig 0179.
        .on("broadcast", { event: "reaction" }, ({ payload }) => {
          const id = (payload as { messageId?: string })?.messageId;
          if (id) refreshReactions([id]);
        }),
  });

  useVisibilityRefresh(() => void catchUp(), { onMount: false });

  // UAT-06. Two problems, not one.
  //
  // `scrollIntoView` walks EVERY scrollable ancestor, so scrolling this thread
  // also scrolled the event page behind it — the visible page jump when the
  // keyboard opens. And it fired on every new message regardless of where the
  // reader was, dragging them out of the history they were reading.
  //
  // Now: scroll the list container itself, and only when the reader is already
  // at the bottom or sent the message. Same rule, same helper, as the DM thread.
  // Paged history. The hook prepends and restores the scroll offset; the effect
  // below must stand down while it does, which is what `suppressAutoScroll` is.
  const fetchEarlier = useCallback(
    async (cursor: { createdAt: string; id: string }) => {
      const page = await loadEarlierEventMessages(eventId, cursor);
      // The older rows bring their own reaction chips.
      if (Object.keys(page.reactions).length > 0) {
        setReactions((prev) => ({ ...page.reactions, ...prev }));
      }
      return { messages: page.messages, hasMore: page.hasMore };
    },
    [eventId, setReactions]
  );

  const history = useMessageHistory({
    messages,
    setMessages,
    listRef,
    hasMore: hasMoreHistory,
    fetchPage: fetchEarlier,
  });

  const didInitialScroll = useRef(false);
  const newest = messages.length > 0 ? messages[messages.length - 1] : null;
  const newestId = newest?.id ?? null;
  const newestIsMine = newest?.sender_id === meId;
  const suppressAutoScroll = history.suppressAutoScroll;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!didInitialScroll.current) {
      el.scrollTop = el.scrollHeight;
      didInitialScroll.current = true;
      return;
    }
    // A history prepend changes `messages.length` and would otherwise be read
    // as "something new arrived" — scrolling a reader who is at the bottom to
    // the newest message and undoing the compensation just applied.
    if (suppressAutoScroll) return;
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
  }, [newestId, newestIsMine, messages.length, suppressAutoScroll]);

  // Sign any attachment not signed yet — the bucket is private, so a raw path
  // is useless without this.
  useEffect(() => {
    const pending = messages.filter(
      (m) =>
        m.attachment_url &&
        m.attachment_type === "image" &&
        !m.deleted_at &&
        !signed[m.attachment_url]
    );
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      const urls = await signChatMediaMany(
        pending.map((m) => ({ path: m.attachment_url as string, type: "image" as const }))
      );
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

  useEffect(() => {
    if (!burstId) return;
    const t = setTimeout(() => setBurstId(null), 850);
    return () => clearTimeout(t);
  }, [burstId]);

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      setActionsFor(null);
      if (!canPost) return;
      await toggleReaction(messageId, emoji);
      channelRef.current?.send({
        type: "broadcast",
        event: "reaction",
        payload: { messageId },
      });
    },
    [canPost, toggleReaction, channelRef]
  );

  function likeMessage(m: EventMessage) {
    if (!canPost || isInert(fromEventRow(m, meId))) return;
    setBurstId(m.id);
    if (hasMyReaction(reactions[m.id], meId, "❤️")) return;
    void react(m.id, "❤️");
  }

  const jumpToMessage = useCallback((id: string) => {
    const el = rowRefs.current.get(id);
    const list = listRef.current;
    if (!el || !list) return;
    const delta =
      el.getBoundingClientRect().top -
      list.getBoundingClientRect().top -
      list.clientHeight / 2;
    list.scrollTo({ top: list.scrollTop + delta, behavior: "smooth" });
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1600);
  }, []);

  const press = useMessagePress({
    onLongPress: (id) => {
      const m = messagesRef.current.find((x) => x.id === id);
      if (m && !m.deleted_at && !m.id.startsWith("temp-")) setActionsFor(m);
    },
    onDoubleTap: (id) => {
      const m = messagesRef.current.find((x) => x.id === id);
      if (m) likeMessage(m);
    },
    onTap: (id) => setRevealedId((cur) => (cur === id ? null : id)),
  });

  function failMessage(tempId: string, retry: () => Promise<void>) {
    retriesRef.current.set(tempId, retry);
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? { ...m, _status: "error" } : m))
    );
  }

  function discardFailed(m: EventMessage) {
    retriesRef.current.delete(m.id);
    if (m._localSrc) URL.revokeObjectURL(m._localSrc);
    setMessages((prev) => dropOptimistic(prev, m.id));
  }

  function retryFailed(m: EventMessage) {
    const retry = retriesRef.current.get(m.id);
    if (!retry) {
      discardFailed(m);
      return;
    }
    setError(null);
    void retry();
  }

  function optimisticRow(
    overrides: Partial<EventMessage> & { id: string }
  ): EventMessage {
    return {
      sender_id: meId,
      sender_name: null,
      sender_avatar: null,
      body: "",
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      reply_to_id: null,
      attachment_url: null,
      attachment_type: null,
      _status: "sending",
      ...overrides,
    };
  }

  /** FALSE means the send failed and the composer should restore the draft. */
  async function onSend(text: string): Promise<boolean> {
    if (!text || !canPost) return false;
    const target = replyTo;
    const tempId = `temp-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      optimisticRow({ id: tempId, body: text, reply_to_id: target?.id ?? null }),
    ]);
    setReplyTo(null);
    setError(null);

    pendingSendsRef.current += 1;
    const res = await sendEventMessage(eventId, text, {
      replyToId: target?.id ?? null,
    }).finally(() => {
      pendingSendsRef.current -= 1;
    });
    if (!res.ok) {
      setMessages((prev) => dropOptimistic(prev, tempId));
      setReplyTo(target);
      setError(res.error);
      return false;
    }
    if (res.messageId) {
      setMessages((prev) =>
        resolveOptimistic(prev, tempId, { id: res.messageId!, _status: undefined })
      );
      const real = await readOne(res.messageId);
      if (real) setMessages((prev) => prev.map((m) => (m.id === real.id ? real : m)));
    } else {
      setMessages((prev) => dropOptimistic(prev, tempId));
    }
    return true;
  }

  async function onCropped(result: CropResult) {
    setCropFile(null);
    setError(null);
    const target = replyTo;
    setReplyTo(null);
    const localSrc = URL.createObjectURL(result.blob);
    const tempId = `temp-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      optimisticRow({
        id: tempId,
        attachment_url: "pending",
        attachment_type: "image",
        reply_to_id: target?.id ?? null,
        _localSrc: localSrc,
      }),
    ]);

    const attempt = async () => {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, _status: "sending" } : m))
      );
      const path = `${eventId}/${crypto.randomUUID()}.${result.extension}`;
      try {
        await uploadWithProgress("chat-media", path, result.blob, {
          contentType: result.mimeType,
        });
      } catch {
        failMessage(tempId, attempt);
        return;
      }
      pendingSendsRef.current += 1;
      const res = await sendEventMessage(eventId, "", {
        replyToId: target?.id ?? null,
        attachmentPath: path,
      }).finally(() => {
        pendingSendsRef.current -= 1;
      });
      if (!res.ok) {
        setError(res.error);
        failMessage(tempId, attempt);
        return;
      }
      retriesRef.current.delete(tempId);
      if (!res.messageId) {
        setMessages((prev) => dropOptimistic(prev, tempId));
        return;
      }
      setMessages((prev) =>
        resolveOptimistic(prev, tempId, {
          id: res.messageId!,
          attachment_url: path,
          _status: undefined,
        })
      );
      const real = await readOne(res.messageId);
      if (real)
        setMessages((prev) =>
          prev.map((m) => (m.id === real.id ? { ...real, _localSrc: localSrc } : m))
        );
    };
    await attempt();
  }

  async function submitEdit() {
    const target = editing;
    if (!target) return;
    const text = editDraft.trim();
    if (!text) return;
    setEditing(null);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.id
          ? { ...m, body: text, edited_at: new Date().toISOString() }
          : m
      )
    );
    const res = await editEventMessage(target.id, text);
    if (!res.ok) {
      setError(res.error);
      setMessages((prev) => prev.map((m) => (m.id === target.id ? target : m)));
    }
  }

  async function onConfirmDelete() {
    const target = confirmDelete;
    if (!target) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteEventMessage(target.id);
    setDeleting(false);
    if (!res.ok) {
      setDeleteError(res.error);
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.id
          ? {
              ...m,
              body: "",
              attachment_url: null,
              attachment_type: null,
              deleted_at: new Date().toISOString(),
            }
          : m
      )
    );
    setReactions((prev) => ({ ...prev, [target.id]: [] }));
    setConfirmDelete(null);
  }

  function actionsForMessage(
    m: EventMessage
  ): (MessageAction | false | undefined)[] {
    const mine = m.sender_id === meId;
    const isText = !m.attachment_url;
    return [
      // Every row here is also refused server-side for a non-attendee: the
      // insert policy, the update policies and the reaction RPC each re-check
      // attendance, so `canPost` only decides what is drawn.
      canPost && {
        key: "reply",
        label: "Reply",
        icon: Reply,
        onSelect: () => {
          setActionsFor(null);
          setEditing(null);
          setReplyTo(m);
        },
      },
      mine &&
        isText &&
        canPost && {
          key: "edit",
          label: "Edit message",
          icon: Pencil,
          onSelect: () => {
            setEditDraft(m.body);
            setEditing(m);
            setActionsFor(null);
          },
        },
      (mine || canModerate) && {
        key: "delete",
        label: mine ? "Unsend" : "Delete message",
        icon: Trash2,
        tone: "danger" as const,
        onSelect: () => {
          setConfirmDelete(m);
          setDeleteError(null);
          setActionsFor(null);
        },
      },
      !mine && {
        key: "report",
        label: "Report message",
        icon: Flag,
        tone: "danger" as const,
        onSelect: () => {
          setReporting(m);
          setActionsFor(null);
        },
      },
    ];
  }

  return (
    <div className="flex flex-col">
      <div
        ref={listRef}
        // `overscroll-contain` stops a flick that reaches the end of this list
        // from continuing into the page behind it (UAT-06: exactly one region
        // scrolls).
        className="max-h-[50vh] flex-1 space-y-2 overflow-y-auto overscroll-contain py-2"
      >
        <LoadEarlier status={history.status} onLoad={history.loadEarlier} />
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <MessagesSquare className="h-7 w-7 text-fg-muted" aria-hidden />
            <p className="text-sm text-fg-muted">
              No messages yet{canPost ? " — start the conversation 👋" : "."}
            </p>
          </div>
        )}
        {messages.map((row, i) => {
          const m = fromEventRow(row, meId);
          const prev = i > 0 ? messages[i - 1] : null;
          const showDay =
            !prev || dayKey(prev.created_at) !== dayKey(row.created_at);
          const sameAuthor =
            !showDay && prev != null && prev.sender_id === row.sender_id;
          const quotedRow = row.reply_to_id
            ? (messages.find((x) => x.id === row.reply_to_id) ?? null)
            : null;
          return (
            <Fragment key={row.id}>
              {showDay && <DayDivider label={chatDayLabel(row.created_at)} />}
              <div
                ref={(el) => {
                  rowRefs.current.set(row.id, el);
                  return () => {
                    rowRefs.current.delete(row.id);
                  };
                }}
              >
                <GroupMessageRow
                  message={m}
                  quoted={quotedRow ? fromEventRow(quotedRow, meId) : null}
                  quotedLoaded={Boolean(quotedRow)}
                  signedUrl={
                    row.attachment_url ? signed[row.attachment_url] : undefined
                  }
                  chips={chipsFor(row.id)}
                  revealed={revealedId === row.id}
                  highlighted={highlightId === row.id}
                  burst={burstId === row.id}
                  showAuthor={!sameAuthor}
                  canReply={canPost}
                  canReact={canPost}
                  press={press(row.id)}
                  onReply={
                    canPost
                      ? () => {
                          setEditing(null);
                          setReplyTo(row);
                        }
                      : undefined
                  }
                  onToggleReaction={(emoji) => react(row.id, emoji)}
                  onJumpToQuoted={
                    quotedRow ? () => jumpToMessage(quotedRow.id) : undefined
                  }
                  onOpenPhoto={() => setViewing(row)}
                  onRetry={() => retryFailed(row)}
                  onDiscard={() => discardFailed(row)}
                  fallbackName="Attendee"
                />
              </div>
            </Fragment>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-1 text-sm text-error">
          {error}
        </p>
      )}

      {canPost ? (
        editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitEdit();
            }}
            className="space-y-1.5 pt-2"
          >
            <div className="flex items-center gap-2 px-1 text-xs text-fg-muted">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Editing message
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-full"
                aria-label="Cancel edit"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                className="glass h-11 min-w-0 flex-1 rounded-[var(--radius-pill)] px-4 text-base text-fg outline-none focus:ring-2 focus:ring-aura/40"
              />
              <GlassButton
                type="submit"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label="Save edit"
                disabled={editDraft.trim().length === 0}
              >
                <Check className="h-5 w-5" aria-hidden />
              </GlassButton>
            </div>
          </form>
        ) : (
          <ChatComposer
            placeholder="Message attendees…"
            // No poll and no anonymity here: attendees coordinate openly, and
            // a poll belongs to a community's own tooling. Camera, not
            // paperclip: images come from the idle composer.
            capabilities={{ camera: true }}
            onFilePicked={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setCropFile(file);
            }}
            onSend={onSend}
            replyActive={Boolean(replyTo)}
            replyPreview={
              replyTo ? (
                <ReplyBanner
                  label={
                    replyTo.sender_id === meId
                      ? "Replying to yourself"
                      : `Replying to ${replyTo.sender_name ?? "an attendee"}`
                  }
                  text={replyPreviewText(toQuotable(fromEventRow(replyTo, meId)))}
                  onCancel={() => setReplyTo(null)}
                />
              ) : null
            }
          />
        )
      ) : (
        <p className="mt-2 rounded-[var(--radius-md)] bg-card p-3 text-center text-sm text-fg-muted">
          Register to join the discussion.
        </p>
      )}

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

      <PhotoViewer
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        src={viewing?.attachment_url ? (signed[viewing.attachment_url] ?? null) : null}
        alt="Shared image"
        senderName={viewing?.sender_name ?? null}
        timestamp={viewing?.created_at ?? null}
      />

      <MessageActionsSheet
        open={Boolean(actionsFor)}
        onClose={() => setActionsFor(null)}
        label="Message options"
        // A non-attendee who can read the thread (the host, an admin) gets no
        // reaction row: `toggle_event_message_reaction` requires the right to
        // POST, so offering it would only produce a refusal.
        onReact={
          actionsFor && canPost ? (e) => react(actionsFor.id, e) : undefined
        }
        actions={actionsFor ? actionsForMessage(actionsFor) : []}
      />

      <ReportReasonSheet
        open={Boolean(reporting)}
        onClose={() => setReporting(null)}
        onSubmit={async (reason) => {
          if (!reporting) return { ok: false, error: "Nothing selected." };
          return reportEventMessage(reporting.id, reason);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete message?"
        description="This removes the message for everyone in the discussion. A short 'message deleted' note stays in its place."
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
