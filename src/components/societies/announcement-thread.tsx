"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { shouldAutoScroll } from "@/lib/chat/scroll-anchor";
import { reconcileWithServerWindow } from "@/lib/chat/history";
import { LoadEarlier } from "@/components/chat/load-earlier";
import { useMessageHistory } from "@/components/chat/use-message-history";
import { loadEarlierAnnouncements } from "@/app/(student)/societies/history-actions";
import {
  dropOptimistic,
  mergeMessage,
  mergeMessages,
} from "@/lib/chat/message-merge";
import {
  Check,
  Eye,
  Flag,
  Pencil,
  Pin,
  PinOff,
  Radio,
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
import { DayDivider } from "@/components/chat/day-divider";
import { chatDayLabel, dayKey } from "@/lib/chat-day";
import { PollComposer } from "@/components/communities/community-chat";
import { PollCard } from "@/components/communities/poll-card";
import { useMessagePress } from "@/lib/chat/use-message-press";
import { useReactionMap } from "@/lib/chat/use-reaction-map";
import { hasMyReaction, type MessageReaction } from "@/lib/chat/reactions";
import {
  fromAnnouncementRow,
  isInert,
  toQuotable,
} from "@/lib/chat/conversation-message";
import { replyPreviewText } from "@/lib/chat/reply-preview";
import {
  useRealtimeChannel,
  useVisibilityRefresh,
} from "@/lib/realtime/use-realtime-channel";
import { createClient } from "@/lib/supabase/client";
import { uploadWithProgress } from "@/lib/storage-upload";
import { signChatMediaMany } from "@/lib/chat-media-sign";
import {
  deleteSocietyAnnouncement,
  editSocietyAnnouncement,
  pinSocietyAnnouncement,
  postSocietyAnnouncement,
  postSocietyAnnouncementPoll,
  reportSocietyAnnouncement,
  revealBroadcastAuthor,
  toggleBroadcastReaction,
} from "@/app/(student)/societies/actions";
import {
  fetchPollResults,
  voteCommunityPoll,
  type PollOptionResult,
} from "@/app/(student)/communities/actions";
import type { AnnouncementRow } from "@/lib/societies/types";

const FEED_COLUMNS =
  "id, society_id, title, body, pinned, visibility, created_at, updated_at, author_id, author_name, author_username, author_avatar, is_mine, poll_id, attachment_url, attachment_type, is_anonymous, reply_to_id";

/** A locally-held broadcast row, plus the optimistic fields a send needs. */
type ThreadRow = AnnouncementRow & {
  _status?: "sending" | "error";
  _localSrc?: string;
};

/**
 * The society's broadcast channel, as a conversation.
 *
 * WHAT CHANGED AND WHY. This surface used to render a column of feed CARDS —
 * a bordered article per message, a heading row, a heart pinned under the
 * body — which is how a notice board looks, not how a channel reads. UAT-04
 * had already turned it into a two-way, role-aware channel where ordinary
 * members post, reply and react, so the card presentation was describing a
 * product that no longer existed. It now uses exactly the row the community
 * rooms and the Messages thread use: bubbles, day separators, quote strips,
 * reaction chips under the bubble, swipe-to-reply, long-press actions.
 *
 * WHAT DID NOT CHANGE IS WHO MAY DO WHAT. Every capability below is a flag
 * resolved server-side from `society_capabilities` (mig 0178) and re-checked
 * by the RPC behind each action:
 *
 *   canPost              member and up — post, reply, attach, poll
 *   canPostAnonymously   member and up — post without a name
 *   canManage            officer/admin — pin and delete ANY message
 *   canReveal            president/owner/admin — look behind an anonymous one
 *
 * A member never gains a publisher's powers by the channel looking like a
 * chat: the composer is rendered only for `canPost`, pin and delete-anyone
 * only for `canManage`, and `reveal_announcement_author` refuses anyone below
 * president rank however the button got drawn.
 */
export function AnnouncementThread({
  societyId,
  meId,
  announcements,
  initialReactions = {},
  canPost,
  canManage,
  canPostAnonymously = false,
  canReveal = false,
  hasMoreHistory = false,
}: {
  societyId: string;
  /** The reader's id, so their own reaction chip can be flagged. */
  meId: string;
  /** Newest-first, as loaded from the server. */
  announcements: AnnouncementRow[];
  /** announcementId -> reactions, for the first paint (UAT-04 / mig 0178). */
  initialReactions?: Record<string, MessageReaction[]>;
  canPost: boolean;
  canManage: boolean;
  /** UAT-04: member and up. Mirrors `society_capabilities.can_post_anonymously`. */
  canPostAnonymously?: boolean;
  /** UAT-04: president, owner or admin only. */
  canReveal?: boolean;
  /** The server saw older broadcasts beyond the first page of ten. */
  hasMoreHistory?: boolean;
}) {
  // Display oldest -> newest, like a chat thread.
  const [messages, setMessages] = useState<ThreadRow[]>(() =>
    [...announcements].reverse()
  );

  // Local state, because realtime appends to it — but it must still follow the
  // server's list when a revalidation hands down fresh props. React's documented
  // "adjust state during render" pattern, rather than an effect that setStates
  // synchronously and costs an extra render pass every time.
  //
  // Optimistic rows are CARRIED OVER rather than replaced away: a second send
  // that is still in flight when the first one's revalidation lands would
  // otherwise have its bubble wiped off the screen mid-send.
  const [seen, setSeen] = useState(announcements);
  if (seen !== announcements) {
    setSeen(announcements);
    // The server's page is authoritative over ITS OWN WINDOW only. Replacing
    // the list wholesale — which is what this used to do — would collapse any
    // history the reader had loaded through the capsule back to the newest ten,
    // under them, mid-scroll. `reconcileWithServerWindow` keeps rows older than
    // the server's window, lets the server win inside it (so an edit, delete or
    // pin still lands), and carries optimistic bubbles over regardless.
    setMessages((prev) =>
      reconcileWithServerWindow(prev, [...announcements].reverse() as ThreadRow[])
    );
  }

  const [composingPoll, setComposingPoll] = useState(false);
  // UAT-04: members may post anonymously in the broadcast channel.
  const [anon, setAnon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [polls, setPolls] = useState<Record<string, PollOptionResult[]>>({});
  const [replyTo, setReplyTo] = useState<ThreadRow | null>(null);
  const [actionsFor, setActionsFor] = useState<ThreadRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ThreadRow | null>(null);
  const [reporting, setReporting] = useState<ThreadRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ThreadRow | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [viewing, setViewing] = useState<ThreadRow | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [burstId, setBurstId] = useState<string | null>(null);
  /**
   * announcementId -> the author's real name, and ONLY ever filled by the
   * reveal RPC. An anonymous message's author is not in this component's data
   * at all — the feed view masks it — so there is nothing here to leak.
   */
  const [revealedAuthors, setRevealedAuthors] = useState<Record<string, string>>({});

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
      // Aliased to `message_id` so this table reads like every other reaction
      // table the shared hook consumes.
      const { data } = await supabase
        .from("society_announcement_reactions")
        .select("message_id:announcement_id, emoji, user_id")
        .in("announcement_id", ids);
      return (data ?? []) as unknown as {
        message_id: string;
        emoji: string;
        user_id: string;
      }[];
    },
    toggle: async (messageId, emoji) => {
      const res = await toggleBroadcastReaction(messageId, emoji);
      return res.ok;
    },
    onError: setError,
  });

  const signAll = useCallback(async (rows: ThreadRow[]) => {
    const pending = rows
      .filter((m) => m.attachment_url && m.attachment_type === "image")
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
      .from("society_announcement_feed")
      .select(FEED_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    return (data as ThreadRow | null) ?? null;
  }, []);

  /**
   * Catch-up read. Until mig 0179 this table was not in the realtime
   * publication at all, so the channel below has never delivered anything and
   * a reader only ever saw a broadcast by reloading the page. Even with the
   * publication fixed, `postgres_changes` cannot replay, so the authoritative
   * re-read stays the safety net.
   */
  const catchUp = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("society_announcement_feed")
        .select(FEED_COLUMNS)
        .eq("society_id", societyId)
        .order("created_at", { ascending: false })
        .limit(50);
      const rows = ((data as ThreadRow[] | null) ?? []).slice().reverse();
      if (rows.length > 0) {
        setMessages((prev) => {
          // Merge in new rows AND refresh the ones already held, so an edit or
          // a pin that arrived while the socket was down is not missed.
          const byId = new Map(rows.map((r) => [r.id, r]));
          const refreshed = prev.map((m) => byId.get(m.id) ?? m);
          return mergeMessages(refreshed, rows);
        });
        signAll(rows);
      }
      refreshReactions(
        messagesRef.current.map((m) => m.id).concat(rows.map((m) => m.id))
      );
    } catch {
      // Leave what is on screen; the next resume or poll tries again.
    }
  }, [societyId, refreshReactions, signAll]);

  const refreshPollResults = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const results = await fetchPollResults(ids);
    setPolls((prev) => ({ ...prev, ...results }));
  }, []);

  const channelRef = useRealtimeChannel({
    name: `society-announcements:${societyId}`,
    // Static: the society id must never reach telemetry.
    label: "society broadcast",
    onCatchUp: () => void catchUp(),
    build: (channel) =>
      channel
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "society_announcements",
            filter: `society_id=eq.${societyId}`,
          },
          async (payload) => {
            const raw = payload.new as { id: string; author_id: string };
            if (raw.author_id === meId && pendingSendsRef.current > 0) return;
            // The raw table row carries the TRUE author of an anonymous
            // broadcast and lacks the joined profile fields. Never render it —
            // re-read through the definer feed view, which applies the masking.
            const a = await readOne(raw.id);
            if (!a) return;
            setMessages((prev) => mergeMessage(prev, a));
            signAll([a]);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "society_announcements",
            filter: `society_id=eq.${societyId}`,
          },
          async (payload) => {
            const a = await readOne((payload.new as { id: string }).id);
            if (!a) return;
            setMessages((prev) => prev.map((x) => (x.id === a.id ? a : x)));
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "society_announcements",
          },
          (payload) => {
            // A broadcast is HARD-deleted (`delete_society_announcement`), so
            // there is no tombstone to render — the row leaves the thread.
            // A DELETE payload carries only the primary key unless the table is
            // REPLICA IDENTITY FULL, which is exactly enough here, but it also
            // means the event cannot be filtered by society_id server-side.
            const id = (payload.old as { id?: string })?.id;
            if (!id) return;
            setMessages((prev) => prev.filter((m) => m.id !== id));
          }
        )
        .on("broadcast", { event: "poll_vote" }, ({ payload }) => {
          const pollId = (payload as { pollId?: string })?.pollId;
          if (pollId) void refreshPollResults([pollId]);
        })
        // Reactions sync by broadcast rather than by WAL — see mig 0179.
        .on("broadcast", { event: "reaction" }, ({ payload }) => {
          const id = (payload as { messageId?: string })?.messageId;
          if (id) refreshReactions([id]);
        }),
  });

  useVisibilityRefresh(() => void catchUp(), { onMount: false });

  // Poll tallies for every poll on screen, in ONE read. The old card fetched
  // its own, so a thread of ten polls issued ten round trips.
  useEffect(() => {
    const missing = [
      ...new Set(
        messages
          .map((m) => m.poll_id)
          .filter((id): id is string => Boolean(id) && !polls[id as string])
      ),
    ];
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await fetchPollResults(missing);
      if (cancelled) return;
      setPolls((prev) => ({ ...prev, ...results }));
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, polls]);

  // Sign attachments — the chat-media bucket is private.
  useEffect(() => {
    const pending = messages.filter(
      (m) =>
        m.attachment_url &&
        m.attachment_type === "image" &&
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

  // UAT-06: follow new messages ONLY when the reader is already at the bottom,
  // or when the newest is their own. Scroll the list container directly, not
  // scrollIntoView (which also scrolls ancestors). Shared with the DM thread
  // via `lib/chat/scroll-anchor` and unit-tested there.
  // Paged history. The hook prepends and restores the scroll offset; the effect
  // below must stand down while it does, which is what `suppressAutoScroll` is.
  const fetchEarlier = useCallback(
    async (cursor: { createdAt: string; id: string }) => {
      const page = await loadEarlierAnnouncements(societyId, cursor);
      if (Object.keys(page.reactions).length > 0) {
        setReactions((prev) => ({ ...page.reactions, ...prev }));
      }
      // The action returns newest-first, like every other broadcast read; the
      // merge sorts, so the order handed in does not matter, but the cast does:
      // a feed row IS a thread row plus the client-only fields.
      return {
        messages: page.items as ThreadRow[],
        hasMore: page.hasMore,
      };
    },
    [societyId, setReactions]
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
  const newestIsMine = newest?.is_mine === true;
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

  function likeMessage(m: ThreadRow) {
    if (!canPost || isInert(fromAnnouncementRow(m))) return;
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
      if (m && !m.id.startsWith("temp-")) setActionsFor(m);
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

  function discardFailed(m: ThreadRow) {
    retriesRef.current.delete(m.id);
    if (m._localSrc) URL.revokeObjectURL(m._localSrc);
    setMessages((prev) => dropOptimistic(prev, m.id));
  }

  function retryFailed(m: ThreadRow) {
    const retry = retriesRef.current.get(m.id);
    if (!retry) {
      discardFailed(m);
      return;
    }
    setError(null);
    void retry();
  }

  function optimisticRow(
    overrides: Partial<ThreadRow> & { id: string; is_anonymous: boolean }
  ): ThreadRow {
    return {
      society_id: societyId,
      title: null,
      body: "",
      pinned: false,
      visibility: "public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      author_id: null,
      author_name: null,
      author_username: null,
      author_avatar: null,
      is_mine: true,
      poll_id: null,
      attachment_url: null,
      attachment_type: null,
      reply_to_id: null,
      _status: "sending",
      ...overrides,
    };
  }

  /** FALSE means the send failed and the composer should restore the draft. */
  async function onSend(text: string): Promise<boolean> {
    if (!text || !canPost) return false;
    const target = replyTo;
    const wasAnon = canPostAnonymously && anon;
    const tempId = `temp-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      optimisticRow({
        id: tempId,
        body: text,
        is_anonymous: wasAnon,
        reply_to_id: target?.id ?? null,
      }),
    ]);
    setReplyTo(null);
    setError(null);

    pendingSendsRef.current += 1;
    const res = await postSocietyAnnouncement(societyId, text, {
      anonymous: wasAnon,
      replyTo: target?.id ?? null,
    }).finally(() => {
      pendingSendsRef.current -= 1;
    });
    // Anonymity is per-message, never sticky: leaving the toggle on would make
    // the NEXT broadcast anonymous without anyone choosing it, which is the
    // same failure UAT-13 describes for the feed composer.
    setAnon(false);
    if (!res.ok) {
      setMessages((prev) => dropOptimistic(prev, tempId));
      setReplyTo(target);
      setError(res.error);
      return false;
    }
    // `postSocietyAnnouncement` revalidates this page, so the authoritative
    // row arrives as a prop and is merged by the render-phase sync above; the
    // realtime INSERT and the catch-up are the other two routes. The bubble is
    // dropped here rather than reconciled by id because the RPC returns
    // through `revalidatePath` and not with the id.
    await catchUp();
    setMessages((prev) => dropOptimistic(prev, tempId));
    return true;
  }

  async function onCropped(result: CropResult) {
    setCropFile(null);
    setError(null);
    const target = replyTo;
    setReplyTo(null);
    const wasAnon = canPostAnonymously && anon;
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

    const attempt = async () => {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, _status: "sending" } : m))
      );
      const path = `${societyId}/${crypto.randomUUID()}.${result.extension}`;
      try {
        await uploadWithProgress("chat-media", path, result.blob, {
          contentType: result.mimeType,
        });
      } catch {
        failMessage(tempId, attempt);
        return;
      }
      pendingSendsRef.current += 1;
      const res = await postSocietyAnnouncement(societyId, "", {
        attachmentPath: path,
        anonymous: wasAnon,
        replyTo: target?.id ?? null,
      }).finally(() => {
        pendingSendsRef.current -= 1;
      });
      setAnon(false);
      if (!res.ok) {
        setError(res.error);
        failMessage(tempId, attempt);
        return;
      }
      retriesRef.current.delete(tempId);
      await catchUp();
      setMessages((prev) => dropOptimistic(prev, tempId));
      URL.revokeObjectURL(localSrc);
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
          ? { ...m, body: text, updated_at: new Date().toISOString() }
          : m
      )
    );
    const res = await editSocietyAnnouncement(societyId, target.id, text);
    if (!res.ok) {
      setError(res.error);
      setMessages((prev) => prev.map((m) => (m.id === target.id ? target : m)));
    }
  }

  async function togglePin(m: ThreadRow) {
    setActionsFor(null);
    const next = !m.pinned;
    setMessages((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, pinned: next } : x))
    );
    const res = await pinSocietyAnnouncement(societyId, m.id, next);
    if (!res.ok) {
      setError(res.error);
      setMessages((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, pinned: m.pinned } : x))
      );
    }
  }

  async function onConfirmDelete() {
    const target = confirmDelete;
    if (!target) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteSocietyAnnouncement(societyId, target.id);
    setDeleting(false);
    if (!res.ok) {
      setDeleteError(res.error);
      return;
    }
    // A broadcast is hard-deleted, so it leaves the thread rather than leaving
    // a tombstone — existing behaviour, unchanged.
    setMessages((prev) => prev.filter((m) => m.id !== target.id));
    setReactions((prev) => ({ ...prev, [target.id]: [] }));
    setConfirmDelete(null);
  }

  async function onVote(pollId: string, optionId: string) {
    const res = await voteCommunityPoll(pollId, optionId);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await refreshPollResults([pollId]);
    channelRef.current?.send({
      type: "broadcast",
      event: "poll_vote",
      payload: { pollId },
    });
  }

  function actionsForMessage(
    m: ThreadRow
  ): (MessageAction | false | undefined)[] {
    const isText = !m.attachment_url && !m.poll_id;
    return [
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
      // Pin is an officer power (`set_society_announcement_pin` refuses
      // everyone else), so an ordinary member never sees it.
      canManage && {
        key: "pin",
        label: m.pinned ? "Unpin broadcast" : "Pin broadcast",
        icon: m.pinned ? PinOff : Pin,
        onSelect: () => togglePin(m),
      },
      // Editing is the AUTHOR's alone, officer or not: an officer may remove a
      // broadcast but must not rewrite one under someone else's name. The RPC
      // enforces that regardless of rank.
      m.is_mine &&
        isText && {
          key: "edit",
          label: "Edit broadcast",
          icon: Pencil,
          onSelect: () => {
            setEditDraft(m.body);
            setEditing(m);
            setActionsFor(null);
          },
        },
      // The reveal is a deliberate, single-message action, not a mode: there is
      // no "show all authors" switch, because the point of anonymity here is
      // that reading the channel does not casually deanonymise the people in
      // it. `reveal_announcement_author` refuses anyone below president rank,
      // so this row existing is not what grants the power.
      m.is_anonymous &&
        canReveal &&
        !revealedAuthors[m.id] && {
          key: "reveal",
          label: "Reveal author",
          icon: Eye,
          onSelect: async () => {
            setActionsFor(null);
            const res = await revealBroadcastAuthor(m.id);
            if (res.ok) {
              setRevealedAuthors((prev) => ({
                ...prev,
                [m.id]: res.author.name ?? "Unknown student",
              }));
            } else {
              setError(res.error);
            }
          },
        },
      (m.is_mine || canManage) && {
        key: "delete",
        label: m.is_mine ? "Delete broadcast" : "Remove broadcast",
        icon: Trash2,
        tone: "danger" as const,
        onSelect: () => {
          setConfirmDelete(m);
          setDeleteError(null);
          setActionsFor(null);
        },
      },
      !m.is_mine && {
        key: "report",
        label: "Report broadcast",
        icon: Flag,
        tone: "danger" as const,
        onSelect: () => {
          setReporting(m);
          setActionsFor(null);
        },
      },
    ];
  }

  const pinned = messages.filter((m) => m.pinned);
  const latestPinned = pinned[pinned.length - 1];

  return (
    <div className="flex flex-col gap-3">
      {/* No "Open chat" here. A verified community BROADCASTS — announcements
          out to followers — and does not host a second conversation; chat is a
          chat room's feature. The link used to open /chat/c/<societyId>. */}
      {latestPinned && (
        <div className="flex shrink-0 items-start gap-2 rounded-[var(--radius-md)] border border-glass-border bg-card px-3 py-2">
          <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
          <button
            type="button"
            onClick={() => jumpToMessage(latestPinned.id)}
            className="min-w-0 flex-1 text-left"
          >
            <p className="text-[11px] font-semibold text-fg-muted">
              Pinned{pinned.length > 1 ? ` · ${pinned.length}` : ""}
            </p>
            <p className="line-clamp-1 text-sm text-fg">
              {replyPreviewText(toQuotable(fromAnnouncementRow(latestPinned)))}
            </p>
          </button>
          {canManage && (
            <button
              type="button"
              aria-label="Unpin broadcast"
              onClick={() => togglePin(latestPinned)}
              className="shrink-0 text-fg-muted hover:text-fg"
            >
              <PinOff className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-[14px] bg-card px-5 py-10 text-center">
          <Radio className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
          <p className="mt-2 font-semibold text-fg">
            No broadcast announcements published yet
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            {canPost
              ? "Broadcast times, deadlines and updates to your followers."
              : "Follow the society to catch its updates here."}
          </p>
        </div>
      ) : (
        <div
          ref={listRef}
          className="flex max-h-[70vh] min-h-[240px] flex-col gap-2 overflow-y-auto rounded-[14px] bg-card/60 p-3"
        >
          <LoadEarlier status={history.status} onLoad={history.loadEarlier} />
          {messages.map((row, i) => {
            const m = fromAnnouncementRow(row);
            const prev = i > 0 ? messages[i - 1] : null;
            const showDay =
              !prev || dayKey(prev.created_at) !== dayKey(row.created_at);
            // Two anonymous messages both carry a NULL author_id, so a plain
            // equality would group them as "the same person" — which is both
            // wrong and a hint about authorship. Anonymous messages never group.
            const sameAuthor =
              !showDay &&
              prev != null &&
              !prev.is_anonymous &&
              !row.is_anonymous &&
              prev.author_id != null &&
              prev.author_id === row.author_id;
            const quotedRow = row.reply_to_id
              ? (messages.find((x) => x.id === row.reply_to_id) ?? null)
              : null;
            // A revealed author replaces the "Anonymous" label for this reader
            // only, and only after they deliberately asked.
            const revealedName = revealedAuthors[row.id];
            const shown = revealedName
              ? { ...m, isAnonymous: false, authorName: revealedName }
              : m;

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
                    message={shown}
                    quoted={quotedRow ? fromAnnouncementRow(quotedRow) : null}
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
                          mine={row.is_mine}
                          onVote={(optionId) => onVote(row.poll_id!, optionId)}
                        />
                      ) : undefined
                    }
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
                  />
                </div>
              </Fragment>
            );
          })}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      {canPost && (
        <div>
          {composingPoll && (
            <PollComposer
              onCancel={() => setComposingPoll(false)}
              onSubmit={async (question, options) => {
                const res = await postSocietyAnnouncementPoll(
                  societyId,
                  question,
                  options
                );
                if (!res.ok) {
                  setError(res.error);
                  return false;
                }
                setComposingPoll(false);
                await catchUp();
                return true;
              }}
            />
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
                Editing broadcast
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
            /* fix-049: the same composer the chat surfaces use — which is now
               literally the Messages composer.
               UAT-04 turns the anonymous option ON here. This channel is no
               longer a one-way officer notice board — members post in it — and
               the whole point of letting a member raise something with their
               society is that they can do it without their name on it. Only the
               president, the owner or an admin can look behind that, and only by
               the explicit reveal action. */
            <ChatComposer
              placeholder={
                canPostAnonymously && anon
                  ? "Post anonymously"
                  : "Post to the channel"
              }
              capabilities={{
                poll: true,
                camera: true,
                anonymous: canPostAnonymously,
              }}
              anonymous={anon}
              onToggleAnonymous={() => setAnon((v) => !v)}
              pollActive={composingPoll}
              onTogglePoll={() => setComposingPoll((p) => !p)}
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
                      replyTo.is_mine
                        ? "Replying to yourself"
                        : replyTo.is_anonymous
                          ? "Replying to an anonymous message"
                          : `Replying to ${replyTo.author_name ?? "a member"}`
                    }
                    text={replyPreviewText(toQuotable(fromAnnouncementRow(replyTo)))}
                    onCancel={() => setReplyTo(null)}
                  />
                ) : null
              }
            />
          )}

          {cropFile && (
            <ImageCropper
              file={cropFile}
              aspect={1}
              aspectOptions
              title="Attach photo"
              onCancel={() => setCropFile(null)}
              onCropped={onCropped}
            />
          )}
        </div>
      )}

      <PhotoViewer
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        src={viewing?.attachment_url ? (signed[viewing.attachment_url] ?? null) : null}
        alt="Shared image"
        // An anonymous broadcast's photo must not carry its author's name into
        // the viewer chrome — the one place the masking could have leaked.
        senderName={
          viewing
            ? viewing.is_anonymous
              ? (revealedAuthors[viewing.id] ?? "Anonymous")
              : viewing.author_name
            : null
        }
        timestamp={viewing?.created_at ?? null}
      />

      <MessageActionsSheet
        open={Boolean(actionsFor)}
        onClose={() => setActionsFor(null)}
        label="Broadcast options"
        // A follower who has not joined may read the channel but not react —
        // `toggle_announcement_reaction` refuses them, so offering the row
        // would only produce a refusal.
        onReact={
          actionsFor && canPost ? (e) => react(actionsFor.id, e) : undefined
        }
        actions={actionsFor ? actionsForMessage(actionsFor) : []}
      />

      <ReportReasonSheet
        open={Boolean(reporting)}
        onClose={() => setReporting(null)}
        title="Report broadcast"
        onSubmit={async (reason) => {
          if (!reporting) return { ok: false, error: "Nothing selected." };
          return reportSocietyAnnouncement(reporting.id, reason);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this broadcast?"
        description="This can't be undone."
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
