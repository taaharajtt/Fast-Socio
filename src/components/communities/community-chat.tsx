"use client";

import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { shouldAutoScroll } from "@/lib/chat/scroll-anchor";
import { LoadEarlier } from "@/components/chat/load-earlier";
import { useMessageHistory } from "@/components/chat/use-message-history";
import { loadEarlierCommunityMessages } from "@/app/(student)/communities/history-actions";
import {
  dropOptimistic,
  mergeMessage,
  mergeMessages,
  newestServerCursor,
  resolveOptimistic,
} from "@/lib/chat/message-merge";
import {
  Check,
  Flag,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply,
  Trash2,
  X,
} from "lucide-react";
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
import { useMessagePress } from "@/lib/chat/use-message-press";
import { useReactionMap } from "@/lib/chat/use-reaction-map";
import { hasMyReaction, type MessageReaction } from "@/lib/chat/reactions";
import {
  fromCommunityRow,
  isInert,
  toQuotable,
} from "@/lib/chat/conversation-message";
import { replyPreviewText } from "@/lib/chat/reply-preview";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { createClient } from "@/lib/supabase/client";
import { uploadWithProgress } from "@/lib/storage-upload";
import { signChatMediaMany } from "@/lib/chat-media-sign";
import {
  useRealtimeChannel,
  useVisibilityRefresh,
} from "@/lib/realtime/use-realtime-channel";
import { PollCard } from "@/components/communities/poll-card";
import { DayDivider } from "@/components/chat/day-divider";
import { chatDayLabel, dayKey } from "@/lib/chat-day";
import {
  createCommunityPoll,
  deleteCommunityMessage,
  editCommunityMessage,
  markCommunityChatRead,
  reportCommunityMessage,
  sendCommunityImage,
  sendCommunityMessage,
  toggleCommunityMessagePin,
  toggleCommunityMessageReaction,
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
  /** mig 0179 — reply/edit/pin, bringing the room to DM parity. */
  edited_at: string | null;
  pinned_at: string | null;
  reply_to_id: string | null;
  /** Client-only: an optimistic bubble's lifecycle. */
  _status?: "sending" | "error";
  /** Client-only: object-URL preview for an image still uploading. */
  _localSrc?: string;
};

const VIEW_COLUMNS =
  "id, sender_id, sender_name, sender_avatar, sender_gender, body, poll_id, is_anonymous, created_at, deleted_at, attachment_url, attachment_type, edited_at, pinned_at, reply_to_id";

/** A catch-up read is bounded; a longer gap is served by the page's own read. */
const CATCH_UP_LIMIT = 200;

export function CommunityChat({
  communityId,
  meId,
  initialMessages,
  initialPolls,
  initialReactions = {},
  allowAnonymous = true,
  canModerate = false,
  paginated = false,
  hasMoreHistory = false,
}: {
  communityId: string;
  meId: string;
  initialMessages: CommunityMessage[];
  initialPolls: Record<string, PollOptionResult[]>;
  /** messageId -> reactions, for the first paint (mig 0179). */
  initialReactions?: Record<string, MessageReaction[]>;
  /**
   * Ten-at-a-time history with the "Load earlier messages" capsule. TRUE for
   * community chat rooms; FALSE for Discover team rooms, which are explicitly
   * out of scope for that feature and keep their single unpaged load. Same
   * component, one more per-surface capability.
   */
  paginated?: boolean;
  /** The server saw older rows beyond the first page. */
  hasMoreHistory?: boolean;
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
  const [error, setError] = useState<string | null>(null);
  const [composingPoll, setComposingPoll] = useState(false);
  /** Signed URLs for attachment paths, resolved lazily. */
  const [signed, setSigned] = useState<Record<string, string>>({});
  /** The message whose action sheet is open. */
  const [actionsFor, setActionsFor] = useState<CommunityMessage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CommunityMessage | null>(null);
  const [reporting, setReporting] = useState<CommunityMessage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** The image currently open in the full-screen viewer (fix-057). */
  const [viewing, setViewing] = useState<CommunityMessage | null>(null);
  /** The picked file, held while the crop dialog is open. */
  const [cropFile, setCropFile] = useState<File | null>(null);
  /** The message the composer is replying to, if any. */
  const [replyTo, setReplyTo] = useState<CommunityMessage | null>(null);
  const [editing, setEditing] = useState<CommunityMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");
  /** Tapped-to-reveal exact time, briefly-ringed jump target, heart burst. */
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [burstId, setBurstId] = useState<string | null>(null);

  // iOS keyboard: exposes the keyboard overlap as --kb so the fixed chat shell
  // shrinks and the sticky composer stays visible (Phase 2 keyboard fix).
  useKeyboardInset();

  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** messageId -> its row element, so a quote can scroll to its original. */
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** tempId -> how to retry that failed send. Keyed by the bubble on screen. */
  const retriesRef = useRef<Map<string, () => Promise<void>>>(new Map());
  /**
   * How many of MY sends are waiting on their server action response. An own
   * INSERT is skipped while one is in flight, because the response is about to
   * place that exact row by rebranding the optimistic bubble — see the same
   * note in the DM thread. Skipping cannot lose a message: the row is newer
   * than the catch-up cursor, so the next subscribe/resume/poll fetches it.
   */
  const pendingSendsRef = useRef(0);

  // ---------------------------------------------------------------------
  // Reactions (mig 0179). Read straight from the table through RLS — the
  // policy scopes rows to members of the room — and written through the RPC.
  // ---------------------------------------------------------------------
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
        .from("community_chat_reactions")
        .select("message_id, emoji, user_id")
        .in("message_id", ids);
      return (data ?? []) as { message_id: string; emoji: string; user_id: string }[];
    },
    toggle: async (messageId, emoji) => {
      const res = await toggleCommunityMessageReaction(messageId, emoji);
      return res.ok;
    },
    onError: setError,
  });

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

  /** Mirrors `messages` for callbacks that must not resubscribe the channel. */
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

  /** Sign a page of attachments in ONE dispatch rather than racing per-message. */
  const signAll = useCallback(async (rows: CommunityMessage[]) => {
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

  /** Read one row back through the masking view — never the raw payload. */
  const readOne = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("community_chat_view")
      .select(VIEW_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    return (data as CommunityMessage | null) ?? null;
  }, []);

  /**
   * Catch-up read. `postgres_changes` cannot replay, so anything published
   * while this socket was down is recoverable only by asking for it. Runs on
   * mount, on every (re)subscribe, on resume, on `online`, and from the polling
   * fallback — and normally returns zero rows.
   *
   * It re-reads REACTIONS too, because those never travel over the socket at
   * all (see mig 0179's header: they would double the WAL cost of the busiest
   * table in the app for a chip). A reaction cast while this tab was asleep
   * arrives here.
   */
  const catchUp = useCallback(async () => {
    try {
      const supabase = createClient();
      const cursor = newestServerCursor(messagesRef.current);
      let query = supabase
        .from("community_chat_view")
        .select(VIEW_COLUMNS)
        .eq("community_id", communityId);
      if (cursor) {
        // The cursor is the PAIR (created_at, id): asking for `created_at >`
        // alone drops any row written in the same microsecond as the newest one
        // on screen, which is exactly what a burst looks like.
        query = query.or(
          `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`
        );
      }
      const { data } = await query
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(CATCH_UP_LIMIT);
      const rows = (data as CommunityMessage[] | null) ?? [];
      if (rows.length > 0) {
        setMessages((prev) => mergeMessages(prev, rows));
        signAll(rows);
        for (const m of rows) if (m.poll_id) refreshPoll(m.poll_id);
        markCommunityChatRead(communityId);
      }
      const visible = messagesRef.current.map((m) => m.id).concat(rows.map((m) => m.id));
      refreshReactions(visible);
    } catch {
      // Leave what is on screen; the next resume, event or poll tries again.
    }
  }, [communityId, refreshPoll, refreshReactions, signAll]);

  // Realtime. Through the shared hook, which owns the race-free teardown, the
  // reconnect/focus catch-up and the polling fallback this screen used to lack
  // entirely (it hand-rolled the effect that migration 0121's note describes).
  const channelRef = useRealtimeChannel({
    name: `community-chat:${communityId}`,
    // Static: the room id must never reach telemetry.
    label: "community chat",
    onCatchUp: () => void catchUp(),
    build: (channel) =>
      channel
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "community_chat_messages",
            filter: `community_id=eq.${communityId}`,
          },
          async (payload) => {
            const raw = payload.new as { id: string; sender_id: string };
            // My own row is left to the send response while one is in flight,
            // so the bubble and the real row cannot both be on screen.
            if (raw.sender_id === meId && pendingSendsRef.current > 0) return;
            // The realtime payload is the RAW table row, so it carries the true
            // sender_id even for anonymous messages. Never render it — refetch
            // through community_chat_view, which applies the masking.
            const m = await readOne(raw.id);
            if (!m) return;
            setMessages((prev) => mergeMessage(prev, m));
            signAll([m]);
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
            // propagate to everyone in the room, not just the person who did
            // it. Edits and pins (mig 0179) travel the same way.
            event: "UPDATE",
            schema: "public",
            table: "community_chat_messages",
            filter: `community_id=eq.${communityId}`,
          },
          async (payload) => {
            const m = await readOne((payload.new as { id: string }).id);
            if (!m) return;
            setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
          }
        )
        // Ballots are private, so votes can't be broadcast via postgres_changes.
        // The voter announces the poll id and everyone re-reads the tallies.
        .on("broadcast", { event: "poll_vote" }, ({ payload }) => {
          const pollId = (payload as { pollId?: string })?.pollId;
          if (pollId) refreshPoll(pollId);
        })
        // Reactions are deliberately NOT in the realtime publication (mig 0179
        // header). The reactor announces the message id on the channel that is
        // already open and everyone re-reads that message's reactions under
        // RLS: same freshness, none of the per-subscriber WAL evaluation.
        .on("broadcast", { event: "reaction" }, ({ payload }) => {
          const id = (payload as { messageId?: string })?.messageId;
          if (id) refreshReactions([id]);
        }),
  });

  useEffect(() => {
    markCommunityChatRead(communityId);
  }, [communityId]);

  // Belt-and-braces alongside the channel's own catch-up: a resume that does
  // NOT resubscribe (the socket survived being backgrounded) fires no
  // SUBSCRIBED, but messages may still have arrived while the tab was hidden.
  useVisibilityRefresh(() => void catchUp(), { onMount: false });

  // UAT-06: follow new messages ONLY when the reader is already at the bottom,
  // or when the newest message is their own. The decision lives in
  // `lib/chat/scroll-anchor` so all four conversation surfaces share it, and
  // scrolling the LIST container (never scrollIntoView, which walks every
  // scrollable ancestor including the page behind the fixed shell on iOS) is
  // what stops the page jumping when the keyboard opens.
  // Paged history. The hook prepends and restores the scroll offset; the effect
  // below must stand down while it does, which is what `suppressAutoScroll` is.
  const fetchEarlier = useCallback(
    async (cursor: { createdAt: string; id: string }) => {
      const page = await loadEarlierCommunityMessages(communityId, cursor);
      // The older rows bring their own poll tallies and reaction chips.
      if (Object.keys(page.polls).length > 0) {
        setPolls((prev) => ({ ...page.polls, ...prev }));
      }
      if (Object.keys(page.reactions).length > 0) {
        setReactions((prev) => ({ ...page.reactions, ...prev }));
      }
      return { messages: page.messages, hasMore: page.hasMore };
    },
    [communityId, setPolls, setReactions]
  );

  const history = useMessageHistory({
    messages,
    setMessages,
    listRef,
    hasMore: hasMoreHistory,
    enabled: paginated,
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

  // Resolve signed URLs for any attachment we haven't signed yet. The bucket is
  // private, so a raw path is useless without this.
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

  // The heart burst is one animation long, keyed on the message id so a second
  // double-tap restarts it rather than inheriting the first one's countdown.
  useEffect(() => {
    if (!burstId) return;
    const t = setTimeout(() => setBurstId(null), 850);
    return () => clearTimeout(t);
  }, [burstId]);

  /** Announce a reaction so everyone in the room re-reads that message's chips. */
  const react = useCallback(
    async (messageId: string, emoji: string) => {
      setActionsFor(null);
      await toggleReaction(messageId, emoji);
      channelRef.current?.send({
        type: "broadcast",
        event: "reaction",
        payload: { messageId },
      });
    },
    [toggleReaction, channelRef]
  );

  /**
   * Double-tap to like, Instagram style. A double tap only ever ADDS the
   * heart — never removes one — because tapping twice reads as "I like this",
   * and making the same gesture undo a like meant an accidental extra tap
   * silently withdrew it. Removing stays a deliberate tap on the chip.
   */
  function likeMessage(m: CommunityMessage) {
    const vm = fromCommunityRow(m, meId);
    if (isInert(vm)) return;
    setBurstId(m.id);
    if (hasMyReaction(reactions[m.id], meId, "❤️")) return;
    void react(m.id, "❤️");
  }

  /** Tapping a quote scrolls to the original when it is loaded, and rings it. */
  const jumpToMessage = useCallback((id: string) => {
    const el = rowRefs.current.get(id);
    const list = listRef.current;
    if (!el || !list) return;
    // Scroll the LIST, not via scrollIntoView: that walks every scrollable
    // ancestor, including the page behind the fixed chat shell on iOS.
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

  /** Park an optimistic bubble in the failed state and remember how to retry. */
  function failMessage(tempId: string, retry: () => Promise<void>) {
    retriesRef.current.set(tempId, retry);
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? { ...m, _status: "error" } : m))
    );
  }

  /** Drop a failed optimistic bubble for good, releasing its object URL. */
  function discardFailed(m: CommunityMessage) {
    retriesRef.current.delete(m.id);
    if (m._localSrc) URL.revokeObjectURL(m._localSrc);
    setMessages((prev) => dropOptimistic(prev, m.id));
  }

  function retryFailed(m: CommunityMessage) {
    const retry = retriesRef.current.get(m.id);
    if (!retry) {
      discardFailed(m);
      return;
    }
    setError(null);
    void retry();
  }

  /** The shape of an optimistic bubble: my own row, before the server has one. */
  function optimisticRow(
    overrides: Partial<CommunityMessage> & { id: string }
  ): CommunityMessage {
    return {
      sender_id: meId,
      // Anonymity is honoured optimistically too: my own anonymous message
      // shows as "You (anonymous)" from the instant it appears, exactly as the
      // view will render it a moment later.
      sender_name: null,
      sender_avatar: null,
      sender_gender: null,
      body: "",
      poll_id: null,
      is_anonymous: anon,
      created_at: new Date().toISOString(),
      deleted_at: null,
      attachment_url: null,
      attachment_type: null,
      edited_at: null,
      pinned_at: null,
      reply_to_id: replyTo?.id ?? null,
      _status: "sending",
      ...overrides,
    };
  }

  /**
   * Send a text message. Returns FALSE when the send failed and the composer
   * should put the text back — the same optimistic-clear/restore contract the
   * DM composer uses.
   */
  async function onSend(text: string): Promise<boolean> {
    if (!text) return false;
    const target = replyTo;
    const tempId = `temp-${crypto.randomUUID()}`;
    const wasAnon = anon;
    setMessages((prev) => [
      ...prev,
      optimisticRow({ id: tempId, body: text, reply_to_id: target?.id ?? null }),
    ]);
    setReplyTo(null);
    setError(null);

    pendingSendsRef.current += 1;
    const res = await sendCommunityMessage(
      communityId,
      text,
      wasAnon,
      target?.id ?? null
    ).finally(() => {
      pendingSendsRef.current -= 1;
    });
    if (!res.ok) {
      // The bubble goes away and the text goes back in the composer, so the
      // send is retried by pressing send again — nothing unsendable is left.
      setMessages((prev) => dropOptimistic(prev, tempId));
      setReplyTo(target);
      setError(res.error);
      return false;
    }
    if (res.messageId) {
      // Reconciled by the id the insert actually got, not by body text:
      // sending the same short message twice used to pair the second row with
      // the first bubble and leave a duplicate on screen.
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

  /** fix-052: picker → crop → upload → persist. Nothing reaches storage uncropped. */
  async function onCropped(result: CropResult) {
    setCropFile(null);
    setError(null);
    const target = replyTo;
    setReplyTo(null);
    const wasAnon = anon;
    const localSrc = URL.createObjectURL(result.blob);
    const tempId = `temp-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      optimisticRow({
        id: tempId,
        attachment_url: "pending",
        attachment_type: "image",
        is_anonymous: wasAnon,
        reply_to_id: target?.id ?? null,
        _localSrc: localSrc,
      }),
    ]);

    // A failed image send must be RECOVERABLE, not a permanent temp row.
    const attempt = async () => {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, _status: "sending" } : m))
      );
      const path = `${communityId}/${crypto.randomUUID()}.${result.extension}`;
      try {
        await uploadWithProgress("chat-media", path, result.blob, {
          contentType: result.mimeType,
        });
      } catch {
        failMessage(tempId, attempt);
        return;
      }
      pendingSendsRef.current += 1;
      const res = await sendCommunityImage(
        communityId,
        path,
        wasAnon,
        target?.id ?? null
      ).finally(() => {
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
    // Optimistic; the realtime UPDATE reconciles the authoritative row.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.id
          ? { ...m, body: text, edited_at: new Date().toISOString() }
          : m
      )
    );
    const res = await editCommunityMessage(target.id, text);
    if (!res.ok) {
      setError(res.error);
      setMessages((prev) => prev.map((m) => (m.id === target.id ? target : m)));
    }
  }

  async function togglePin(m: CommunityMessage) {
    setActionsFor(null);
    const wasPinned = Boolean(m.pinned_at);
    setMessages((prev) =>
      prev.map((x) =>
        x.id === m.id
          ? { ...x, pinned_at: wasPinned ? null : new Date().toISOString() }
          : x
      )
    );
    const res = await toggleCommunityMessagePin(m.id, !wasPinned);
    if (!res.ok) {
      setError(res.error);
      setMessages((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, pinned_at: m.pinned_at } : x))
      );
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
    setReactions((prev) => ({ ...prev, [target.id]: [] }));
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

  // The pinned bar, same shape as the DM thread's (Refactor Phase 10).
  const pinnedMessages = messages.filter((m) => m.pinned_at && !m.deleted_at);
  const latestPinned = pinnedMessages[pinnedMessages.length - 1];

  /** Build the action sheet for one message, from what this viewer may do. */
  function actionsForMessage(
    m: CommunityMessage
  ): (MessageAction | false | undefined)[] {
    const mine = m.sender_id === meId;
    const isText = !m.attachment_url && !m.poll_id;
    return [
      {
        key: "reply",
        label: "Reply",
        icon: Reply,
        onSelect: () => {
          setActionsFor(null);
          setEditing(null);
          setReplyTo(m);
        },
      },
      // Pinning is a moderation act on someone else's words, so — unlike a DM,
      // where either of the two participants may pin — this needs the room's
      // moderators. `set_community_chat_pin` refuses everyone else regardless.
      canModerate && {
        key: "pin",
        label: m.pinned_at ? "Unpin message" : "Pin message",
        icon: m.pinned_at ? PinOff : Pin,
        onSelect: () => togglePin(m),
      },
      mine &&
        isText && {
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

  // The parent (SpaceShell's `fill` tab) hands this component a fixed height,
  // so the feed is the only thing that scrolls and the composer sits on the
  // bottom edge — no sticky positioning, no page-level scrolling.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {latestPinned && (
        <div className="mb-1 mt-1 flex shrink-0 items-start gap-2 rounded-[var(--radius-md)] border border-glass-border bg-card px-3 py-2">
          <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
          <button
            type="button"
            onClick={() => jumpToMessage(latestPinned.id)}
            className="min-w-0 flex-1 text-left"
          >
            <p className="text-[11px] font-semibold text-fg-muted">
              Pinned{pinnedMessages.length > 1 ? ` · ${pinnedMessages.length}` : ""}
            </p>
            <p className="line-clamp-1 text-sm text-fg">
              {replyPreviewText(toQuotable(fromCommunityRow(latestPinned, meId)))}
            </p>
          </button>
          {canModerate && (
            <button
              type="button"
              aria-label="Unpin message"
              onClick={() => togglePin(latestPinned)}
              className="shrink-0 text-fg-muted hover:text-fg"
            >
              <PinOff className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto py-4">
        {paginated && (
          <LoadEarlier status={history.status} onLoad={history.loadEarlier} />
        )}
        {messages.length === 0 && (
          <div className="mt-8 flex flex-col items-center gap-2 text-center">
            <MessageCircle className="h-7 w-7 text-fg-muted" aria-hidden />
            <p className="text-sm text-fg-muted">Chat room is quiet. Say hello!</p>
          </div>
        )}
        {messages.map((row, i) => {
          const m = fromCommunityRow(row, meId);
          const prev = i > 0 ? messages[i - 1] : null;
          // Day separators, same rules and same component as the DM thread.
          const showDay =
            !prev || dayKey(prev.created_at) !== dayKey(row.created_at);
          // Consecutive messages from one author collapse to a single header.
          // Two anonymous messages both carry a NULL sender_id, so a plain
          // equality would group them as "the same person" — which is both
          // wrong and a hint about authorship. Anonymous messages never group.
          const sameAuthor =
            !showDay &&
            prev != null &&
            !prev.is_anonymous &&
            !row.is_anonymous &&
            prev.sender_id != null &&
            prev.sender_id === row.sender_id;
          const quotedRow = row.reply_to_id
            ? (messages.find((x) => x.id === row.reply_to_id) ?? null)
            : null;

          return (
            <Fragment key={row.id}>
              {showDay && <DayDivider label={chatDayLabel(row.created_at)} />}
              <div
                // React 19 ref cleanup: the map must not keep rows that have
                // scrolled out of the list alive.
                ref={(el) => {
                  rowRefs.current.set(row.id, el);
                  return () => {
                    rowRefs.current.delete(row.id);
                  };
                }}
              >
                <GroupMessageRow
                  message={m}
                  quoted={quotedRow ? fromCommunityRow(quotedRow, meId) : null}
                  quotedLoaded={Boolean(quotedRow)}
                  signedUrl={
                    row.attachment_url ? signed[row.attachment_url] : undefined
                  }
                  chips={chipsFor(row.id)}
                  poll={
                    row.poll_id && polls[row.poll_id] ? (
                      <PollCard
                        pollId={row.poll_id}
                        question={row.body}
                        options={polls[row.poll_id]}
                        mine={m.mine}
                        onVote={(optionId) => onVote(row.poll_id!, optionId)}
                      />
                    ) : undefined
                  }
                  revealed={revealedId === row.id}
                  highlighted={highlightId === row.id}
                  burst={burstId === row.id}
                  showAuthor={!sameAuthor}
                  canReply
                  canReact
                  press={press(row.id)}
                  onReply={() => {
                    setEditing(null);
                    setReplyTo(row);
                  }}
                  onToggleReaction={(emoji) => react(row.id, emoji)}
                  onJumpToQuoted={
                    quotedRow ? () => jumpToMessage(quotedRow.id) : undefined
                  }
                  onOpenPhoto={() => setViewing(row)}
                  onRetry={() => retryFailed(row)}
                  onDiscard={() => discardFailed(row)}
                />
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

        {error && (
          <p role="alert" className="pb-1.5 text-sm text-error">
            {error}
          </p>
        )}

        {editing ? (
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
          /* fix-058/050/059: the one shared composer, which is now literally
             the Messages composer. Poll, anonymity and media are capabilities,
             not separate components — a Discover team room is the same
             component with `allowAnonymous={false}`. */
          <ChatComposer
            placeholder={anon ? "Message anonymously..." : "Message..."}
            capabilities={{ poll: true, anonymous: allowAnonymous, camera: true }}
            anonymous={anon}
            onToggleAnonymous={() => setAnon((a) => !a)}
            pollActive={composingPoll}
            onTogglePoll={() => setComposingPoll((p) => !p)}
            onFilePicked={(e) => {
              const file = e.target.files?.[0];
              // Reset so picking the same file twice still fires onChange.
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
                      : replyTo.is_anonymous
                        ? "Replying to an anonymous message"
                        : `Replying to ${replyTo.sender_name ?? "a member"}`
                  }
                  text={replyPreviewText(toQuotable(fromCommunityRow(replyTo, meId)))}
                  onCancel={() => setReplyTo(null)}
                />
              ) : null
            }
          />
        )}
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
        alt="Shared image"
        senderName={
          viewing
            ? viewing.is_anonymous
              ? "Anonymous"
              : (viewing.sender_name ?? "Member")
            : null
        }
        timestamp={viewing?.created_at ?? null}
      />

      {/* The DM action sheet, not a bespoke menu. Every row here is separately
          refused by the database for anyone not entitled to it, so hiding one
          is presentation rather than protection. */}
      <MessageActionsSheet
        open={Boolean(actionsFor)}
        onClose={() => setActionsFor(null)}
        label="Message options"
        onReact={actionsFor ? (e) => react(actionsFor.id, e) : undefined}
        actions={actionsFor ? actionsForMessage(actionsFor) : []}
      />

      <ReportReasonSheet
        open={Boolean(reporting)}
        onClose={() => setReporting(null)}
        onSubmit={async (reason) => {
          if (!reporting) return { ok: false, error: "Nothing selected." };
          return reportCommunityMessage(reporting.id, reason);
        }}
      />

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
