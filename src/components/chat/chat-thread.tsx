"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CornerUpRight,
  Flag,
  Loader2,
  Mic,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  MAX_REPORT_MESSAGES,
  canDisclose,
  undisclosableReason,
} from "@/lib/chat/dm-report";
import {
  ReportFiled,
  ReportReview,
  type ReviewMessage,
} from "@/components/chat/report-review";
import { GlassButton, GlassSheet } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import { ImageCropper, type CropResult } from "@/components/ui/image-cropper";
import { PhotoViewer } from "@/components/ui/photo-viewer";
import { ComposerInput } from "@/components/chat/composer-input";
import { cn } from "@/lib/utils";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { renderLinkifiedText } from "@/lib/linkify";
import { createClient } from "@/lib/supabase/client";
import { chatMediaPath } from "@/lib/chat-media";
import { signChatMedia, signChatMediaMany } from "@/lib/chat-media-sign";
import { uploadWithProgress } from "@/lib/storage-upload";
import { absoluteTime } from "@/lib/time";
import { deliveryLabel, exactMessageTime } from "@/lib/chat/status-labels";
import { VoiceNote } from "@/components/chat/voice-note";
import { SwipeToReply } from "@/components/chat/swipe-to-reply";
import { QuotedMessage } from "@/components/chat/quoted-message";
import { replyPreviewText } from "@/lib/chat/reply-preview";
import { DayDivider } from "@/components/chat/day-divider";
import { chatDayLabel, dayKey } from "@/lib/chat-day";
import {
  SharedPostCard,
  type SharedPostPreview,
} from "@/components/chat/shared-post-preview";
import {
  useRealtimeChannel,
  useVisibilityRefresh,
} from "@/lib/realtime/use-realtime-channel";
import {
  dropOptimistic,
  mergeMessage,
  mergeMessages,
  newestServerCursor,
  resolveOptimistic,
  type MessageCursor,
} from "@/lib/chat/message-merge";
import {
  sendMessage,
  markConversationRead,
  fetchOlderMessages,
  fetchNewerMessages,
  editMessage,
  deleteMessage,
  toggleMessageReaction,
  forwardMessage,
  togglePinMessage,
  listMatchedFriends,
  fetchReplyPreviews,
  type MatchedFriend,
  type ReplyPreview,
} from "@/app/(student)/chat/actions";

type Reaction = { emoji: string; user_id: string };
const QUICK_EMOJIS = ["❤️", "😂", "🔥", "👍", "😮", "😢", "🙏"];
/**
 * At most one `mark_conversation_read` RPC per this many ms. The RPC marks the
 * WHOLE conversation, so calling it once per inbound message — as this
 * component used to — bought nothing and cost a round trip plus an UPDATE
 * broadcast back down every subscriber's socket each time.
 */
const MARK_READ_THROTTLE_MS = 3_000;

function formatRecordingTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Static bar heights for the recording waveform preview — a lightweight visual
// cue, not a real amplitude readout (no audio-analysis wiring needed for it).
const WAVEFORM_BARS = [6, 12, 8, 16, 10, 14, 7, 11, 15, 9, 13, 6];

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string | null;
  attachment_url: string | null;
  attachment_type: "image" | "voice" | null;
  shared_post_id: string | null;
  created_at: string;
  read_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  pinned_at: string | null;
  /** The message this one replies to (mig 0167), or null. */
  reply_to_id?: string | null;
  /** Client-only: object-URL preview for an optimistic image while it uploads. */
  _localSrc?: string;
  /** Client-only: optimistic image lifecycle — drives the in-bubble spinner and
   *  the Uploading…/Sent footer. Absent on authoritative rows. */
  _uploadStatus?: "uploading" | "sent" | "error";
};

export type { SharedPostPreview };

export function ChatThread({
  conversationId,
  meId,
  initialMessages,
  sharedPosts = {},
  hasMore = false,
  initialSignedAttachments = {},
  initialReactions = {},
  initialReplyPreviews = {},
  showReadReceipts = true,
  otherName = null,
  reportParam = null,
}: {
  conversationId: string;
  meId: string;
  initialMessages: ChatMessage[];
  sharedPosts?: Record<string, SharedPostPreview>;
  hasMore?: boolean;
  /** messageId -> signed URL for private chat-media attachments (P5-01). */
  initialSignedAttachments?: Record<string, string>;
  /** messageId -> reactions (UAT-005). */
  initialReactions?: Record<string, Reaction[]>;
  /** messageId -> the quoted row it is a reply to, for the first paint. */
  initialReplyPreviews?: Record<string, ReplyPreview>;
  /** Whether the other participant reveals read receipts (privacy, Phase 8). */
  showReadReceipts?: boolean;
  /** The other participant's display name, for labelling report evidence. */
  otherName?: string | null;
  /** The `?report` search param. The thread menu sets it to open selection
   *  mode; ChatThread clears it when selection ends. */
  reportParam?: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [signedAttachments, setSignedAttachments] = useState<
    Record<string, string>
  >(initialSignedAttachments);
  const [busy, setBusy] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  // Selected-but-not-yet-cropped image (UAT-011): opens the ImageCropper
  // dialog before anything touches chat-media.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [actionsFor, setActionsFor] = useState<ChatMessage | null>(null);
  // Selective reporting (Phase 3): pick 1-10 messages, review, file. `selecting`
  // suppresses the thread's normal tap/long-press affordances so a tap means
  // "select" and nothing else.
  const [selecting, setSelecting] = useState(reportParam === "1");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [filedReportId, setFiledReportId] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const router = useRouter();

  // The header menu opens selection by navigating to ?report=1, which is a SOFT
  // navigation: this component stays mounted, so `useState(reportParam === "1")`
  // above only ever reflects the value at first mount. This is React's
  // documented "adjust state when a prop changes" pattern — a render-phase
  // update, not an effect, so selection opens in the same paint and it does not
  // trip the repo's set-state-in-effect lint rule.
  const [seenReportParam, setSeenReportParam] = useState(reportParam);
  if (reportParam !== seenReportParam) {
    setSeenReportParam(reportParam);
    setSelecting(reportParam === "1");
    setSelectedIds([]);
    setSelectionNotice(null);
  }
  const [forwardFor, setForwardFor] = useState<ChatMessage | null>(null);
  const [reactions, setReactions] =
    useState<Record<string, Reaction[]>>(initialReactions);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  /** fix-057: the image currently open in the full-screen viewer. */
  const [viewingPhoto, setViewingPhoto] = useState<{
    src: string;
    senderName: string | null;
    timestamp: string;
  } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  /** Quoted rows, keyed by the QUOTED message's id (not the reply's). */
  const [replyPreviews, setReplyPreviews] =
    useState<Record<string, ReplyPreview>>(initialReplyPreviews);
  /** The message the composer is currently replying to, if any. */
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  /** Briefly ringed after tapping a quote, so the original is findable. */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** The message currently playing the double-tap heart burst. */
  const [burstId, setBurstId] = useState<string | null>(null);
  /**
   * The message whose exact time is revealed by tapping it.
   *
   * Times are NOT printed under every bubble any more — a column of clock
   * stamps is most of the visual noise in a chat thread, and the day separators
   * already carry the "when". Desktop reveals a time on hover/focus in CSS;
   * this is the touch equivalent, and one at a time.
   */
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canLoadOlder, setCanLoadOlder] = useState(hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Pinned messages (Refactor Phase 10).

  // iOS keyboard: exposes the keyboard overlap as --kb so the fixed chat shell
  // shrinks and this sticky composer stays visible (Phase 2 keyboard fix).
  useKeyboardInset();


  // Live "0:00" timer for the recording strip — ticks every second while
  // recording and not paused. recordingSeconds is reset to 0 where recording
  // actually starts (toggleRecording), not here, so this effect never needs to
  // call setState outside its own interval callback.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      if (!recordingPaused) setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [recording, recordingPaused]);

  // Resolve a signed URL for a private chat-media attachment (P5-01), at
  // display size rather than the full upload — and via the shared cache/dedupe
  // helper, so reopening a thread or a burst of realtime inserts doesn't
  // re-sign a path that's already cached.
  const signAttachment = useCallback(async (m: ChatMessage) => {
    if (!m.attachment_url) return;
    const path = chatMediaPath(m.attachment_url);
    if (!path) return;
    const url = await signChatMedia(path, m.attachment_type ?? "image");
    if (url) setSignedAttachments((prev) => ({ ...prev, [m.id]: url }));
  }, []);

  const refreshReactions = useCallback(async (messageId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("message_reactions")
      .select("emoji, user_id")
      .eq("message_id", messageId);
    setReactions((prev) => ({ ...prev, [messageId]: (data as Reaction[]) ?? [] }));
  }, []);

  async function react(messageId: string, emoji: string) {
    setActionsFor(null);
    if (messageId.startsWith("temp-")) return; // still sending — no server row yet
    // Optimistic: reflect my toggle immediately, reconcile on the realtime event.
    setReactions((prev) => {
      const list = prev[messageId] ?? [];
      const mineHere = list.find((r) => r.user_id === meId);
      let next: Reaction[];
      if (mineHere && mineHere.emoji === emoji) {
        next = list.filter((r) => r.user_id !== meId);
      } else {
        next = [...list.filter((r) => r.user_id !== meId), { emoji, user_id: meId }];
      }
      return { ...prev, [messageId]: next };
    });
    const res = await toggleMessageReaction(messageId, emoji);
    if (!res.ok) {
      setError(res.error);
      refreshReactions(messageId);
    }
  }

  /**
   * Double-tap to like, Instagram style.
   *
   * A double tap only ever ADDS the heart — it never removes one. Tapping a
   * message twice reads as "I like this", and making the same gesture undo a
   * like meant an accidental extra tap silently withdrew it. Removing a
   * reaction stays a deliberate act: tap the chip under the bubble.
   */
  function likeMessage(m: ChatMessage) {
    if (selecting || m.deleted_at || m.id.startsWith("temp-")) return;

    // The burst plays either way, so the gesture always reads as registered
    // even on a message that already carries my heart. It clears itself in the
    // effect below — no timer ref, which a render-time caller must not touch.
    setBurstId(m.id);

    const mineHere = (reactions[m.id] ?? []).find((r) => r.user_id === meId);
    if (mineHere?.emoji === "❤️") return;
    void react(m.id, "❤️");
  }

  async function togglePin(m: ChatMessage) {
    setActionsFor(null);
    const wasPinned = Boolean(m.pinned_at);
    // Optimistic; the realtime UPDATE reconciles the authoritative pinned_at.
    setMessages((prev) =>
      prev.map((x) =>
        x.id === m.id
          ? { ...x, pinned_at: wasPinned ? null : new Date().toISOString() }
          : x
      )
    );
    const res = await togglePinMessage(m.id);
    if (!res.ok) {
      setError(res.error);
      setMessages((prev) =>
        prev.map((x) =>
          x.id === m.id ? { ...x, pinned_at: wasPinned ? m.pinned_at : null } : x
        )
      );
    }
  }

  async function loadOlder() {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const older = (await fetchOlderMessages(
      conversationId,
      messages[0].created_at
    )) as ChatMessage[];
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      return [...older.filter((m) => !seen.has(m.id)), ...prev];
    });
    // Batch-sign every attachment on this page concurrently (one dispatch,
    // all requests in flight together) instead of firing signAttachment
    // per-message and racing 50 independent promises.
    const attachments = older
      .filter((m) => m.attachment_url)
      .map((m) => ({
        id: m.id,
        path: chatMediaPath(m.attachment_url),
        type: m.attachment_type ?? "image",
      }))
      .filter((a): a is { id: string; path: string; type: "image" | "voice" } =>
        Boolean(a.path)
      );
    if (attachments.length > 0) {
      signChatMediaMany(attachments).then((signed) => {
        setSignedAttachments((prev) => {
          const next = { ...prev };
          for (const a of attachments) {
            const url = signed.get(a.path);
            if (url) next[a.id] = url;
          }
          return next;
        });
      });
    }
    if (older.length < 50) setCanLoadOlder(false);
    setLoadingOlder(false);
  }

  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** tempId -> how to retry that failed optimistic send. Keyed by the bubble on
   *  screen, so a discarded bubble takes its retry with it. */
  const retriesRef = useRef<Map<string, () => Promise<void>>>(new Map());
  /**
   * How many of MY sends are waiting on their server action response.
   *
   * Reconciling an optimistic bubble now happens off the action's returned id
   * rather than in the INSERT handler, which means the two can race: if the
   * socket delivers my own row before the action returns, both the bubble and
   * the real row would be on screen for that window and the message would flash
   * twice. So an own INSERT is SKIPPED while a send of mine is in flight — the
   * response is about to place that exact row by rebranding the bubble.
   *
   * Skipping cannot lose a message. If the response never arrives, the row is
   * newer than the catch-up cursor (which only tracks rows actually on screen),
   * so the next subscribe/resume/poll fetches it.
   */
  const pendingSendsRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  // Set when the user discards a take, so onstop skips the upload/send.
  const cancelledRef = useRef(false);

  // Unread boundary, frozen at mount. markConversationRead() runs in an effect
  // just after this, wiping read_at — so the "new" state has to be captured from
  // the server-rendered rows first, or the divider would vanish on arrival.
  // Lazy initializer: computed once, never recomputed on re-render.
  const [initialUnread] = useState(() => {
    const incomingUnread = initialMessages.filter(
      (m) => m.sender_id !== meId && !m.read_at
    );
    return {
      ids: new Set(incomingUnread.map((m) => m.id)),
      firstId: incomingUnread[0]?.id ?? null,
      count: incomingUnread.length,
    };
  });
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Where a press started, so a press that MOVES can cancel the long-press. */
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  /** The last tap, for detecting a double tap on the SAME message. */
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  /** Pending single-tap action, cancelled if a second tap turns it into a like. */
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** messageId -> its row element, so a quote can scroll to its original. */
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The quote-able shape of a loaded message. */
  const toPreview = useCallback(
    (m: ChatMessage): ReplyPreview => ({
      id: m.id,
      sender_id: m.sender_id,
      body: m.body,
      attachment_type: m.attachment_type,
      shared_post_id: m.shared_post_id,
      deleted_at: m.deleted_at,
    }),
    []
  );

  /**
   * Resolve the quoted row for every reply on screen.
   *
   * Most targets are in `messages` already, so they cost nothing. A reply to a
   * message older than the loaded page — or one that arrived by realtime while
   * its target was never loaded — is fetched, once, in a single batched read.
   */
  useEffect(() => {
    const wanted = new Set<string>();
    for (const m of messages) if (m.reply_to_id) wanted.add(m.reply_to_id);
    if (wanted.size === 0) return;

    // A target that IS on screen needs no state: it is read straight off the
    // list at render time. Only the ones outside the loaded window are fetched.
    const missing: string[] = [];
    for (const id of wanted) {
      if (replyPreviews[id]) continue;
      if (messages.some((m) => m.id === id)) continue;
      missing.push(id);
    }
    if (missing.length === 0) return;

    let active = true;
    fetchReplyPreviews(conversationId, missing).then((rows) => {
      if (!active || rows.length === 0) return;
      setReplyPreviews((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.id] = r;
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [messages, replyPreviews, conversationId, toPreview]);

  useEffect(() => {
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
    };
  }, []);

  /** Enter reply mode for one message and focus the composer. */
  const startReply = useCallback(
    (m: ChatMessage) => {
      if (m.deleted_at || m.id.startsWith("temp-")) return;
      setActionsFor(null);
      setEditing(null);
      setReplyTo(toPreview(m));
    },
    [toPreview]
  );


  // The heart burst is one animation long. Keyed on the message id so a second
  // double-tap restarts it rather than inheriting the first one's countdown.
  useEffect(() => {
    if (!burstId) return;
    const t = setTimeout(() => setBurstId(null), 850);
    return () => clearTimeout(t);
  }, [burstId]);

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

  /**
   * The cursor a catch-up asks for rows after: the newest SERVER-BACKED row on
   * screen, as a `(created_at, id)` pair. Kept in a ref so the catch-up callback
   * can read it without being re-created — and therefore without resubscribing
   * the channel — on every incoming message.
   */
  const cursorRef = useRef<MessageCursor | null>(
    newestServerCursor(initialMessages)
  );
  useEffect(() => {
    cursorRef.current = newestServerCursor(messages);
  }, [messages]);

  /**
   * Read receipts, throttled.
   *
   * `markConversationRead` used to fire once per inbound INSERT, so receiving a
   * burst of ten messages meant ten server actions, each an RPC round trip, and
   * each publishing UPDATEs that came straight back down the socket. The RPC is
   * idempotent and marks the whole conversation, so one call per window is
   * exactly as correct and an order of magnitude cheaper.
   */
  const lastMarkReadAt = useRef(0);
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleMarkRead = useCallback(() => {
    if (markReadTimer.current) return;
    const elapsed = Date.now() - lastMarkReadAt.current;
    const wait = Math.max(0, MARK_READ_THROTTLE_MS - elapsed);
    markReadTimer.current = setTimeout(() => {
      markReadTimer.current = null;
      lastMarkReadAt.current = Date.now();
      markConversationRead(conversationId);
    }, wait);
  }, [conversationId]);

  useEffect(() => {
    return () => {
      if (markReadTimer.current) clearTimeout(markReadTimer.current);
    };
  }, []);

  /** Mirrors `messages` for callbacks that must not resubscribe the channel.
   *  Written in an effect: the React Compiler rejects a ref write in render. */
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /**
   * Re-read reactions for every message on screen. Only used when a reaction
   * DELETE arrives without a `message_id` — see the handler below.
   */
  const refreshVisibleReactions = useCallback(async () => {
    const supabase = createClient();
    const ids = messagesRef.current
      .map((m) => m.id)
      .filter((id) => !id.startsWith("temp-"));
    if (ids.length === 0) return;
    const { data } = await supabase
      .from("message_reactions")
      .select("message_id, emoji, user_id")
      .in("message_id", ids);
    const next: Record<string, Reaction[]> = {};
    for (const id of ids) next[id] = [];
    for (const r of data ?? []) {
      (next[r.message_id] ??= []).push({ emoji: r.emoji, user_id: r.user_id });
    }
    setReactions(next);
  }, []);

  /**
   * Catch-up read. `postgres_changes` cannot replay, so anything published
   * while this socket was down — a backgrounded PWA, a tunnel, a WebSocket the
   * network ate — is recoverable only by asking for it. Runs on mount, on every
   * (re)subscribe, on focus/visibility resume, on `online`, and from the polling
   * fallback, and normally returns zero rows.
   */
  const catchUp = useCallback(async () => {
    try {
      // A null cursor means an empty conversation. That is NOT a reason to skip
      // — the action falls back to the latest page, because an empty thread is
      // precisely where a first incoming message is most likely to be missed.
      const rows = (await fetchNewerMessages(
        conversationId,
        cursorRef.current
      )) as ChatMessage[];
      if (rows.length === 0) return;
      setMessages((prev) => mergeMessages(prev, rows));
      for (const m of rows) if (m.attachment_url) signAttachment(m);
      // Recovered messages from the other side are unread by definition, and
      // the thread is open, so they must be marked — throttled like every other
      // read receipt.
      if (rows.some((m) => m.sender_id !== meId)) scheduleMarkRead();
    } catch {
      // Leave what is on screen; the next resume, event or poll tries again.
    }
  }, [conversationId, meId, signAttachment, scheduleMarkRead]);

  // Realtime: new messages, edits/deletes/read updates, and typing broadcasts.
  //
  // The subscription goes through `useRealtimeChannel`, which owns the race-free
  // teardown, the reconnect/focus catch-up and the polling fallback that this
  // effect used to lack entirely.
  const channelRef = useRealtimeChannel({
    name: `conv:${conversationId}`,
    // Static: the conversation id must never reach telemetry.
    label: "chat thread",
    channelOptions: { config: { broadcast: { self: false } } },
    onCatchUp: () => void catchUp(),
    build: (channel) =>
      channel
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
            // Dedupe by id and keep the list in (created_at, id) order.
            // Reconciling MY OWN optimistic bubble is not done here any more —
            // it happens off `sendMessage`'s returned id, which cannot mis-pair
            // two identical messages the way body-text matching did. While one
            // of my sends is still out, its row is left to that response rather
            // than merged here alongside the bubble it belongs to.
            if (m.sender_id === meId && pendingSendsRef.current > 0) return;
            setMessages((prev) => mergeMessage(prev, m));
            if (m.attachment_url) signAttachment(m);
            if (m.sender_id !== meId) scheduleMarkRead();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            // Take the whole row, not just read_at: an UPDATE also carries
            // edits and soft-deletes (UAT-009), which the old handler dropped.
            const m = payload.new as ChatMessage;
            setMessages((prev) =>
              prev.map((x) => (x.id === m.id ? { ...x, ...m } : x))
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "message_reactions" },
          (payload) => {
            // Reactions carry no conversation_id, so we cannot filter
            // server-side. RLS already limits delivery to our conversations;
            // re-read the affected message's reactions.
            //
            // On DELETE, `payload.old` carries ONLY the primary key unless the
            // table is REPLICA IDENTITY FULL — and no migration in this repo
            // sets that — so `message_id` is absent and removing a reaction
            // never refreshed for the other party. Rather than widen the WAL
            // for every reaction row, fall back to a bounded authoritative
            // re-read of the reactions for the messages currently on screen.
            const row = (payload.new ?? payload.old) as { message_id?: string };
            if (row?.message_id) {
              refreshReactions(row.message_id);
            } else if (payload.eventType === "DELETE") {
              refreshVisibleReactions();
            }
          }
        )
        .on("broadcast", { event: "typing" }, () => {
          setOtherTyping(true);
          if (typingTimeout.current) clearTimeout(typingTimeout.current);
          typingTimeout.current = setTimeout(() => setOtherTyping(false), 2500);
        }),
  });

  // Opening the thread is a read. Subsequent marks are throttled above.
  useEffect(() => {
    markConversationRead(conversationId);
    lastMarkReadAt.current = Date.now();
  }, [conversationId]);

  // Belt-and-braces alongside the channel's own catch-up: a resume that does
  // NOT resubscribe (the socket survived being backgrounded) fires no
  // SUBSCRIBED, but messages may still have arrived while the tab was hidden.
  // `onMount: false` — the channel's first SUBSCRIBED already covers mount.
  useVisibilityRefresh(() => void catchUp(), { onMount: false });

  // Scroll the MESSAGE LIST container directly instead of scrollIntoView —
  // scrollIntoView walks every scrollable ancestor (including the page behind
  // the fixed shell on iOS), which caused visible jumps when the keyboard
  // opened. First paint jumps instantly; new messages scroll smoothly.
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
  }, [messages.length, otherTyping]);

  // Throttled: one broadcast per 1.2s of continuous typing is enough for a
  // typing indicator; per-keystroke sends flooded the realtime socket.
  const lastTypingSent = useRef(0);
  const broadcastTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 1200) return;
    lastTypingSent.current = now;
    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: meId },
    });
    // `channelRef` is the stable ref the shared hook returns; listed because the
    // lint rule cannot see that a hook return value is a ref.
  }, [meId, channelRef]);

  // Returns the storage PATH (not a URL): chat-media is private, so messages
  // store the path and the app resolves a signed URL at read time (P5-01).
  /**
   * Upload a voice note.
   *
   * This used to PUT straight into Supabase Storage while every other chat
   * attachment went through the presigned Contabo path. Playback signs through
   * /api/storage/sign-get, which resolves against Contabo — so a voice note
   * written to Supabase Storage had no object behind its signed URL and simply
   * never played. Same route as images now, so the bytes land where the reader
   * looks for them. `uploadWithProgress` only recompresses image/*, so the
   * recorded audio is passed through untouched.
   */
  async function uploadMedia(
    file: Blob,
    ext: string,
    contentType: string
  ): Promise<string | null> {
    const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
    try {
      await uploadWithProgress("chat-media", path, file, { contentType });
      return path;
    } catch {
      return null;
    }
  }

  /** Selecting a file just opens the crop step — nothing touches chat-media yet. */
  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingFile(file);
  }

  /** ImageCropper's onCropped: the only path an image ever reaches chat-media from. */
  async function onCropped({ blob, extension, mimeType }: CropResult) {
    setPendingFile(null);
    setError(null);
    const target = replyTo;
    if (target) setReplyPreviews((prev) => ({ ...prev, [target.id]: target }));
    setReplyTo(null);

    // Optimistic image bubble: the cropped photo renders immediately with an
    // "Uploading…" spinner, so the send has clear feedback instead of the
    // composer just freezing until the upload + insert round-trips finish.
    const localSrc = URL.createObjectURL(blob);
    const tempId = `temp-${crypto.randomUUID()}`;
    const temp: ChatMessage = {
      id: tempId,
      sender_id: meId,
      body: null,
      attachment_url: "pending",
      attachment_type: "image",
      shared_post_id: null,
      created_at: new Date().toISOString(),
      read_at: null,
      edited_at: null,
      deleted_at: null,
      pinned_at: null,
      reply_to_id: target?.id ?? null,
      _localSrc: localSrc,
      _uploadStatus: "uploading",
    };
    setMessages((prev) => [...prev, temp]);

    // A failed image send must be RECOVERABLE, not a permanent temp row: the
    // retry closure is kept so the bubble can offer "Retry", and the bubble can
    // always be discarded. Neither leaves an unsendable row behind for good.
    const attempt = async () => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, _uploadStatus: "uploading" } : m
        )
      );
      const path = `${conversationId}/${crypto.randomUUID()}.${extension}`;
      try {
        await uploadWithProgress("chat-media", path, blob, {
          contentType: mimeType,
        });
      } catch {
        failMessage(tempId, attempt);
        return;
      }

      pendingSendsRef.current += 1;
      const res = await sendMessage(
        conversationId,
        "",
        { url: path, type: "image" },
        target?.id
      ).finally(() => {
        pendingSendsRef.current -= 1;
      });
      if (!res.ok) {
        setError(res.error);
        failMessage(tempId, attempt);
        return;
      }
      // Reconcile by the id the insert actually got, keeping the local preview
      // so the bubble does not flash to a placeholder while its signed URL
      // resolves. If the realtime INSERT beat this round trip the bubble is
      // dropped (its preview carried onto the real row) rather than duplicated
      // — see `resolveOptimistic`.
      retriesRef.current.delete(tempId);
      setMessages((prev) =>
        resolveOptimistic(prev, tempId, {
          id: res.message.id,
          created_at: res.message.created_at,
          attachment_url: path,
          _uploadStatus: "sent",
        })
      );
    };
    await attempt();
  }

  /** Park an optimistic bubble in the failed state and remember how to retry. */
  function failMessage(tempId: string, retry: () => Promise<void>) {
    retriesRef.current.set(tempId, retry);
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? { ...m, _uploadStatus: "error" } : m))
    );
  }

  /** Drop a failed optimistic bubble for good, releasing its object URL. */
  function discardFailed(m: ChatMessage) {
    retriesRef.current.delete(m.id);
    if (m._localSrc) URL.revokeObjectURL(m._localSrc);
    setMessages((prev) => dropOptimistic(prev, m.id));
  }

  function retryFailed(m: ChatMessage) {
    const retry = retriesRef.current.get(m.id);
    if (!retry) {
      discardFailed(m);
      return;
    }
    setError(null);
    void retry();
  }

  /**
   * Send a text message. Returns FALSE when the send failed and the composer
   * should put the text back — the optimistic-clear/restore contract that used
   * to live inline here now crosses the <ComposerInput/> boundary as this
   * return value (perf audit Phase 5). Everything else is unchanged.
   */
  async function sendText(text: string): Promise<boolean> {
    if (!text || busy) return false;
    // Captured before the composer is cleared, so a reply that fails can be
    // restored with its target intact.
    const target = replyTo;
    // Optimistic: the bubble renders NOW; the realtime INSERT swaps in the
    // authoritative row (see the INSERT handler). On failure it is removed and
    // the draft restored. `busy` is not set, so rapid sends each get a bubble.
    const temp: ChatMessage = {
      id: `temp-${crypto.randomUUID()}`,
      sender_id: meId,
      body: text,
      attachment_url: null,
      attachment_type: null,
      shared_post_id: null,
      created_at: new Date().toISOString(),
      read_at: null,
      edited_at: null,
      deleted_at: null,
      pinned_at: null,
      reply_to_id: target?.id ?? null,
    };
    if (target) setReplyPreviews((prev) => ({ ...prev, [target.id]: target }));
    setMessages((prev) => [...prev, temp]);
    setReplyTo(null);
    pendingSendsRef.current += 1;
    const res = await sendMessage(conversationId, text, undefined, target?.id).finally(() => {
      pendingSendsRef.current -= 1;
    });
    if (!res.ok) {
      // The bubble goes away and the text goes back in the composer, so the
      // send is retried by pressing send again — nothing unsendable is left on
      // screen.
      setMessages((prev) => dropOptimistic(prev, temp.id));
      setReplyTo(target);
      setError(res.error);
      return false;
    }
    // Reconciled by id, not by body text: sending the same short message twice
    // used to pair the second row with the first bubble and leave a duplicate.
    setMessages((prev) =>
      resolveOptimistic(prev, temp.id, {
        id: res.message.id,
        created_at: res.message.created_at,
      })
    );
    return true;
  }

  /** Discard the take: stop the recorder but skip the upload in onstop. */
  function cancelRecording() {
    if (!recording) return;
    cancelledRef.current = true;
    recorderRef.current?.stop();
  }

  /** Pause/resume capture without ending the take (MediaRecorder pause/resume). */
  function togglePauseRecording() {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.pause();
      setRecordingPaused(true);
    } else if (rec.state === "paused") {
      rec.resume();
      setRecordingPaused(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    // The reply target is captured when the take STARTS: the composer's reply
    // row is dismissed for the recording strip, so it must not be read again
    // once the recording ends.
    const target = replyTo;
    if (target) setReplyPreviews((prev) => ({ ...prev, [target.id]: target }));
    setReplyTo(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (ev) => chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        // Always release the mic, whether we're sending or discarding.
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setRecordingPaused(false);
        // Cancelled: drop the captured audio without uploading or sending.
        if (cancelledRef.current) {
          cancelledRef.current = false;
          chunksRef.current = [];
          return;
        }
        setBusy(true);
        const blob = new Blob(chunksRef.current, { type: mime });
        const ext = mime === "audio/webm" ? "webm" : "mp4";
        const url = await uploadMedia(blob, ext, mime);
        if (url)
          await sendMessage(
            conversationId,
            "",
            { url, type: "voice" },
            target?.id
          );
        setBusy(false);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecordingSeconds(0);
    } catch {
      // Mic permission denied or unsupported — silently ignore.
    }
  }

  /** Enter selection mode, optionally seeding it with one message. */
  function startSelecting(seed?: ChatMessage) {
    setActionsFor(null);
    setSelectionNotice(null);
    setSelectedIds(seed && canDisclose(seed) ? [seed.id] : []);
    setSelecting(true);
  }

  function exitSelecting() {
    setSelecting(false);
    setSelectedIds([]);
    setReviewing(false);
    setSelectionNotice(null);
    // Drop ?report=1 so a refresh or a back-forward does not silently reopen
    // selection mode.
    if (reportParam) router.replace(`/chat/${conversationId}`);
  }

  /** Toggle one message in the selection, explaining any refusal. */
  function toggleSelected(m: ChatMessage) {
    const blocked = undisclosableReason(m);
    if (blocked) {
      setSelectionNotice(blocked);
      return;
    }
    setSelectedIds((prev) => {
      if (prev.includes(m.id)) {
        setSelectionNotice(null);
        return prev.filter((id) => id !== m.id);
      }
      if (prev.length >= MAX_REPORT_MESSAGES) {
        setSelectionNotice(
          `You can report up to ${MAX_REPORT_MESSAGES} messages at a time.`
        );
        return prev;
      }
      setSelectionNotice(null);
      return [...prev, m.id];
    });
  }

  /** The selection, in thread order, shaped for the review step. Built from the
   *  loaded messages so the reporter reviews exactly what they saw. */
  function selectedForReview(): ReviewMessage[] {
    const chosen = new Set(selectedIds);
    return messages
      .filter((m) => chosen.has(m.id))
      .map((m) => ({
        id: m.id,
        body: m.body,
        attachment_type: m.attachment_type,
        shared_post_id: m.shared_post_id,
        created_at: m.created_at,
        senderLabel: m.sender_id === meId ? "You" : (otherName ?? "Them"),
      }));
  }

  async function submitEdit() {
    if (!editing) return;
    const text = editDraft.trim();
    if (!text) return;
    const target = editing;
    setEditing(null);
    // Optimistic: the bubble updates now and reconciles on the realtime UPDATE.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.id
          ? { ...m, body: text, edited_at: new Date().toISOString() }
          : m
      )
    );
    const res = await editMessage(target.id, text);
    if (!res.ok) {
      setError(res.error);
      setMessages((prev) =>
        prev.map((m) => (m.id === target.id ? target : m))
      );
    }
  }

  async function confirmDelete(message: ChatMessage) {
    setActionsFor(null);
    const res = await deleteMessage(message.id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === message.id
          ? {
              ...m,
              body: "",
              attachment_url: null,
              attachment_type: null,
              shared_post_id: null,
              deleted_at: new Date().toISOString(),
            }
          : m
      )
    );
  }

  /** Long-press (touch) or right-click opens the per-message action sheet. */
  function pressHandlers(m: ChatMessage) {
    // In selection mode a tap means "select"; the long-press action sheet and
    // the double-tap reaction would both fight it.
    if (selecting) return {};
    // No actions on deleted or still-sending (optimistic) messages.
    if (m.deleted_at || m.id.startsWith("temp-")) return {};
    const open = () => setActionsFor(m);
    const cancel = () => {
      if (longPress.current) clearTimeout(longPress.current);
      longPress.current = null;
    };
    return {
      onPointerDown: (e: React.PointerEvent) => {
        pressOrigin.current = { x: e.clientX, y: e.clientY };
        longPress.current = setTimeout(open, 450);
      },
      // A press that TRAVELS is a swipe (or a scroll), not a long press. Without
      // this the action sheet opened mid-swipe on any deliberate "hold, then
      // slide" — the exact gesture the reply affordance asks for — and stole it.
      onPointerMove: (e: React.PointerEvent) => {
        const o = pressOrigin.current;
        if (!o || !longPress.current) return;
        if (Math.abs(e.clientX - o.x) > 8 || Math.abs(e.clientY - o.y) > 8) {
          cancel();
        }
      },
      onPointerUp: (e: React.PointerEvent) => {
        const origin = pressOrigin.current;
        pressOrigin.current = null;
        cancel();
        // A tap, not a swipe or a scroll: the pointer barely moved.
        const moved =
          !origin ||
          Math.abs(e.clientX - origin.x) > 8 ||
          Math.abs(e.clientY - origin.y) > 8;
        if (moved) {
          lastTap.current = null;
          return;
        }
        const now = Date.now();
        const prev = lastTap.current;
        if (prev && prev.id === m.id && now - prev.at < 350) {
          lastTap.current = null;
          if (tapTimer.current) clearTimeout(tapTimer.current);
          tapTimer.current = null;
          likeMessage(m);
          return;
        }
        lastTap.current = { id: m.id, at: now };
        // A single tap reveals this message's exact time — but only once the
        // double-tap window has closed, or every like would flash a timestamp
        // on its way through.
        if (tapTimer.current) clearTimeout(tapTimer.current);
        tapTimer.current = setTimeout(() => {
          tapTimer.current = null;
          setRevealedId((cur) => (cur === m.id ? null : m.id));
        }, 360);
      },
      onPointerLeave: () => {
        pressOrigin.current = null;
        cancel();
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        open();
      },
    };
  }

  // The newest message I sent — the ONE place a receipt belongs, IG style. It
  // carries "Seen …" once read and "Sent …" until then, so the status is always
  // on the same bubble instead of jumping between them.
  const lastMineId = [...messages].reverse().find((m) => m.sender_id === meId)?.id;

  // Pinned messages currently loaded in the thread (Phase 10).
  const pinnedMessages = messages.filter((m) => m.pinned_at && !m.deleted_at);
  const latestPinned = pinnedMessages[pinnedMessages.length - 1];

  return (
    // min-h-0 lets this flex column shrink inside the fixed chat shell so the
    // message list can actually scroll (UAT-017) instead of overflowing and
    // pushing the composer off-screen.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned bar (Refactor Phase 10). */}
      {latestPinned && (
        <div className="mb-1 mt-1 flex shrink-0 items-start gap-2 rounded-[var(--radius-md)] border border-glass-border bg-card px-3 py-2">
          <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-fg-muted">
              Pinned{pinnedMessages.length > 1 ? ` · ${pinnedMessages.length}` : ""}
            </p>
            <p className="line-clamp-1 text-sm text-fg">
              {latestPinned.body ?? "📎 Attachment"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Unpin message"
            onClick={() => togglePin(latestPinned)}
            className="shrink-0 text-fg-muted hover:text-fg"
          >
            <PinOff className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto py-4">
        {canLoadOlder && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="glass rounded-[var(--radius-pill)] px-4 py-1.5 text-xs text-fg-muted disabled:opacity-50"
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-fg-muted">Say hello 👋</p>
        )}
        {messages.map((m, i) => {
          const mine = m.sender_id === meId;
          // A day separator opens every new local calendar day, including the
          // first message in the thread.
          const prev = i > 0 ? messages[i - 1] : null;
          const showDay =
            !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const deleted = Boolean(m.deleted_at);
          const isMedia =
            !deleted && (m.attachment_type === "image" || Boolean(m.shared_post_id));

          const chips = aggregateReactions(reactions[m.id], meId);

          const isNew = initialUnread.ids.has(m.id);

          const revealed = revealedId === m.id;
          const uploading = m._uploadStatus === "uploading";
          const failedUpload = m._uploadStatus === "error";
          // The receipt lives on the newest outgoing message only: "Seen …"
          // once read, "Sent …" until then, and never "Seen" at all when the
          // recipient has read receipts switched off.
          const receipt =
            mine && m.id === lastMineId && !m._uploadStatus
              ? deliveryLabel(
                  { createdAt: m.created_at, readAt: m.read_at },
                  showReadReceipts
                )
              : null;
          const showMeta =
            !deleted && (revealed || Boolean(receipt) || uploading || failedUpload);

          const quotedLoaded = m.reply_to_id
            ? (messages.find((x) => x.id === m.reply_to_id) ?? null)
            : null;
          const quoted = !m.reply_to_id
            ? null
            : quotedLoaded
              ? toPreview(quotedLoaded)
              : (replyPreviews[m.reply_to_id] ?? null);
          const quotedIsMine = quoted?.sender_id === meId;
          const quoteLabel = !m.reply_to_id
            ? null
            : mine
              ? `You replied to ${quotedIsMine ? "yourself" : (otherName ?? "them")}`
              : quotedIsMine
                ? "replied to you"
                : `replied to ${otherName ?? "themselves"}`;

          return (
            <div
              key={m.id}
              // React 19 ref cleanup: the map must not keep rows that have
              // scrolled out of the list alive.
              ref={(el) => {
                rowRefs.current.set(m.id, el);
                return () => {
                  rowRefs.current.delete(m.id);
                };
              }}
            >
              {showDay && <DayDivider label={chatDayLabel(m.created_at)} />}
              {/* "New messages" divider above the first message that was still
                  unread when this thread opened (WhatsApp/Slack convention). */}
              {m.id === initialUnread.firstId && (
                <div className="flex items-center gap-2 py-2">
                  <span className="h-px flex-1 bg-accent/40" aria-hidden />
                  <span className="rounded-full bg-accent/[0.14] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
                    {initialUnread.count} new message
                    {initialUnread.count === 1 ? "" : "s"}
                  </span>
                  <span className="h-px flex-1 bg-accent/40" aria-hidden />
                </div>
              )}
              {/* Press and swipe to reply: theirs drags right, mine drags
                  left, each away from the edge its bubble sits against.
                  Disabled in selection mode and on messages there is nothing
                  to reply to. */}
              <SwipeToReply
                onReply={() => startReply(m)}
                direction={mine ? "left" : "right"}
                disabled={selecting || deleted || m.id.startsWith("temp-")}
              >
              <div
                className={cn(
                  "flex items-end gap-2",
                  mine ? "justify-end" : "justify-start"
                )}
              >
                {selecting && (
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(m.id)}
                    disabled={!canDisclose(m)}
                    onChange={() => toggleSelected(m)}
                    aria-label={`Select message from ${
                      mine ? "you" : (otherName ?? "them")
                    } at ${absoluteTime(m.created_at)}${
                      canDisclose(m) ? "" : " (cannot be reported)"
                    }`}
                    className="focus-ring h-5 w-5 shrink-0 accent-[var(--color-accent)] disabled:opacity-30"
                  />
                )}
                <div
                  className={cn(
                    "group/msg relative flex min-w-0 max-w-[78%] flex-col gap-1",
                    mine ? "items-end" : "items-start"
                  )}
                >
                  {/* Desktop reveal: hovering or keyboard-focusing a message
                      floats its exact time beside the bubble. Absolutely
                      positioned so nothing reserves a row of empty space, and
                      opacity-only so the layout never shifts. Touch gets the
                      same time from a single tap (see `revealedId`). */}
                  {!deleted && (
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute top-1/2 hidden -translate-y-1/2 whitespace-nowrap text-[11px] text-fg-subtle opacity-0 transition-opacity",
                        "group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 sm:block",
                        mine ? "right-full mr-2" : "left-full ml-2"
                      )}
                    >
                      {exactMessageTime(m.created_at)}
                    </span>
                  )}
                {m.reply_to_id && (
                  <QuotedMessage
                    preview={quoted}
                    label={quoteLabel}
                    // Only clickable when the original is actually in the
                    // loaded list — there is nowhere to scroll to otherwise.
                    onClick={
                      quotedLoaded
                        ? () => jumpToMessage(quotedLoaded.id)
                        : undefined
                    }
                    className="max-w-full"
                  />
                )}
                <div
                  {...(deleted ? {} : pressHandlers(m))}
                  // Focusable so the hover reveal has a keyboard equivalent,
                  // and titled so the exact time is available to a pointer
                  // tooltip and to assistive tech without being drawn.
                  tabIndex={deleted ? undefined : 0}
                  title={deleted ? undefined : absoluteTime(m.created_at)}
                  onClick={selecting ? () => toggleSelected(m) : undefined}
                  className={cn(
                    "relative max-w-full text-[15px]",
                    // UAT-002 / fix-037: media (image or shared post) already has
                    // its own edge — no outer frame, padding, or background. Text
                    // and voice keep the bubble chrome and inset.
                    isMedia
                      ? isNew && "rounded-2xl"
                      : "overflow-hidden rounded-2xl px-4 py-2",
                    deleted
                      ? "overflow-hidden rounded-2xl border border-dashed border-glass-border bg-transparent text-fg-disabled"
                      : isMedia
                        ? !mine && "cursor-pointer"
                        : mine
                          ? "gradient-brand rounded-br-md text-white"
                          : // Borderless: a soft dark fill, no outline (the
                            // incoming bubble used to be a bordered card).
                            "bg-fill rounded-bl-md cursor-pointer text-fg",
                    // Unread-on-open incoming messages get an accent ring so they
                    // stand out from everything already read.
                    isNew && !deleted && "ring-1 ring-accent/50",
                    // Briefly ringed after jumping here from a quote.
                    highlightId === m.id && "ring-2 ring-accent",
                    selecting && !canDisclose(m) && "opacity-40",
                    selecting && selectedIds.includes(m.id) && "ring-2 ring-accent"
                  )}
                >
                  {deleted ? (
                    <span className="text-[13px] italic">
                      This message was deleted
                    </span>
                  ) : m.shared_post_id ? (
                    <SharedPostCard
                      postId={m.shared_post_id}
                      preview={sharedPosts[m.shared_post_id]}
                      mine={mine}
                    />
                  ) : m.attachment_type === "image" && m.attachment_url ? (
                    (() => {
                      // Prefer the signed URL; fall back to the local preview
                      // while an optimistic upload is in flight or its signed URL
                      // is still resolving.
                      const src = signedAttachments[m.id] ?? m._localSrc;
                      if (!src) {
                        return (
                          <div className="flex h-40 w-[220px] animate-pulse items-center justify-center rounded-xl bg-white/10" />
                        );
                      }
                      const uploading = m._uploadStatus === "uploading";
                      const failed = m._uploadStatus === "error";
                      return (
                        <div className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt="Shared image"
                            // fix-057: tap opens the full-screen viewer. Not while
                            // the upload is still in flight — the signed URL and
                            // final dimensions aren't settled yet.
                            onClick={
                              uploading || failed
                                ? undefined
                                : () =>
                                    setViewingPhoto({
                                      src,
                                      // The DM thread doesn't carry the peer's
                                      // display name, so the overlay names only
                                      // the viewer's own photos rather than
                                      // inventing a label for the other side.
                                      senderName:
                                        m.sender_id === meId ? "You" : null,
                                      timestamp: m.created_at,
                                    })
                            }
                            className={cn(
                              "block max-h-72 w-[220px] rounded-xl object-cover transition-opacity",
                              uploading && "opacity-70",
                              !uploading && !failed && "cursor-zoom-in"
                            )}
                            loading="lazy"
                            decoding="async"
                          />
                          {uploading && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/25">
                              <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-medium text-white">
                                <Loader2
                                  className="h-3.5 w-3.5 animate-spin"
                                  aria-hidden
                                />
                                Uploading…
                              </span>
                            </div>
                          )}
                          {failed && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
                              <span className="rounded-full bg-error px-3 py-1.5 text-[11px] font-semibold text-white">
                                Upload failed
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : m.attachment_type === "voice" && m.attachment_url ? (
                    signedAttachments[m.id] ? (
                      <VoiceNote src={signedAttachments[m.id]} mine={mine} />
                    ) : (
                      <div className="flex h-8 w-[180px] animate-pulse items-center rounded-full bg-white/10" />
                    )
                  ) : (
                    <span className="whitespace-pre-wrap break-words">
                      {renderLinkifiedText(m.body ?? "")}
                      {m.edited_at && (
                        <span
                          className={cn(
                            "ml-1.5 align-baseline text-[11px]",
                            mine ? "text-white/60" : "text-fg-disabled"
                          )}
                        >
                          edited
                        </span>
                      )}
                    </span>
                  )}

                  {/* Double-tap heart, the same burst the feed uses. */}
                  {burstId === m.id && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    >
                      <span className="animate-like-burst text-4xl drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
                        ❤️
                      </span>
                    </span>
                  )}
                </div>
                </div>
              </div>
              </SwipeToReply>

              {/* UAT-005: reaction chips under the bubble. Tap yours to remove. */}
              {chips.length > 0 && (
                <div
                  className={cn(
                    "-mt-1 flex flex-wrap gap-1",
                    mine ? "justify-end pr-1" : "justify-start pl-1"
                  )}
                >
                  {chips.map((c) => (
                    <button
                      key={c.emoji}
                      type="button"
                      onClick={() => react(m.id, c.emoji)}
                      className={cn(
                        "flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px]",
                        c.mine
                          ? "border-accent/50 bg-accent/15 text-fg"
                          : "border-glass-border bg-card text-fg-muted"
                      )}
                    >
                      <span>{c.emoji}</span>
                      {c.count > 1 && <span className="tabular-nums">{c.count}</span>}
                    </button>
                  ))}
                </div>
              )}

              {/* The meta line is now EXCEPTIONAL, not per-message.
                  Instagram prints no clock under every bubble — the day
                  separators carry the "when" and an exact time is revealed on
                  demand — so this renders only for: a time the reader asked
                  for, an in-flight or failed upload, and the read receipt,
                  which belongs on the newest outgoing message alone. */}
              {showMeta && (
                <p
                  className={cn(
                    "mt-0.5 flex items-center gap-1 text-[11px] text-fg-muted",
                    mine ? "justify-end pr-1" : "justify-start pl-1",
                    failedUpload && "text-error"
                  )}
                >
                  {revealed && (
                    <time
                      dateTime={m.created_at}
                      title={absoluteTime(m.created_at)}
                    >
                      {exactMessageTime(m.created_at)}
                    </time>
                  )}
                  {revealed && (receipt || uploading || failedUpload) && (
                    <span aria-hidden>·</span>
                  )}
                  {uploading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      Uploading…
                    </>
                  ) : failedUpload ? (
                    // A failed send is recoverable rather than a stuck temp
                    // row: retry re-runs the upload and insert, discard drops
                    // the bubble and releases its object URL.
                    <>
                      Failed to send
                      <button
                        type="button"
                        onClick={() => retryFailed(m)}
                        className="focus-ring rounded font-semibold text-fg underline underline-offset-2"
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        onClick={() => discardFailed(m)}
                        className="focus-ring rounded text-fg-muted underline underline-offset-2"
                      >
                        Discard
                      </button>
                    </>
                  ) : (
                    receipt && (
                      <>
                        <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                        {receipt}
                      </>
                    )
                  )}
                </p>
              )}
            </div>
          );
        })}
        {otherTyping && (
          <div className="flex justify-start">
            <div className="bg-fill flex items-center gap-1 rounded-2xl rounded-bl-md px-4 py-3">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-muted"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p role="alert" className="pb-1 text-center text-xs text-error">
          {error}
        </p>
      )}

      {selecting ? (
        <div className="sticky bottom-0 space-y-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          {/* Announced whenever the count or a refusal changes, so a screen
              reader user hears the limit rather than silently hitting it. */}
          <p aria-live="polite" className="px-1 text-xs text-fg-muted">
            {selectionNotice ??
              `${selectedIds.length} of ${MAX_REPORT_MESSAGES} selected`}
          </p>
          <div className="flex gap-2">
            <GlassButton
              type="button"
              variant="secondary"
              onClick={exitSelecting}
              className="flex-1"
            >
              Cancel
            </GlassButton>
            <GlassButton
              type="button"
              variant="danger"
              disabled={selectedIds.length < 1}
              onClick={() => setReviewing(true)}
              className="flex-1"
            >
              Continue
              {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
            </GlassButton>
          </div>
        </div>
      ) : editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitEdit();
          }}
          className="sticky bottom-0 space-y-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
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
      ) : recording ? (
        <div className="sticky bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          {/* No <form> here: every control in the recording strip is a
              type="button", so it never needed one. The text branch owns its
              own form inside <ComposerInput/> (perf audit Phase 5). */}
          <div className="flex items-end gap-2">
            {/* State 3 (Recording) — left: discard the take entirely. */}
            <button
              type="button"
              aria-label="Discard voice note"
              onClick={cancelRecording}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-error/20 text-error transition-colors hover:bg-error hover:text-white"
            >
              <Trash2 className="h-5 w-5" aria-hidden />
            </button>

            {/* Center: live timer + waveform preview + pause/resume. */}
            <div className="glass flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full px-4">
              <span
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full bg-error",
                  !recordingPaused && "animate-pulse"
                )}
                aria-hidden
              />
              <span className="shrink-0 text-sm font-medium tabular-nums text-fg">
                {formatRecordingTime(recordingSeconds)}
              </span>
              <span
                className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
                aria-hidden
              >
                {WAVEFORM_BARS.map((h, i) => (
                  <span
                    key={i}
                    className={cn(
                      "w-0.5 shrink-0 rounded-full bg-accent/70",
                      recordingPaused ? "opacity-30" : "animate-pulse"
                    )}
                    style={{ height: h, animationDelay: `${i * 80}ms` }}
                  />
                ))}
              </span>
              <button
                type="button"
                aria-label={recordingPaused ? "Resume recording" : "Pause recording"}
                onClick={togglePauseRecording}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg"
              >
                {recordingPaused ? (
                  <Mic className="h-4 w-4" aria-hidden />
                ) : (
                  <Pause className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>

            {/* Right: finalize + submit the voice note. */}
            <button
              type="button"
              aria-label="Send voice note"
              onClick={toggleRecording}
              disabled={busy}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-light disabled:opacity-40"
            >
              <Send className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      ) : (
        /* Owns the draft, so typing re-renders only the composer and never
           the message list above it. See composer-input.tsx. */
        <ComposerInput
          busy={busy}
          replyActive={Boolean(replyTo)}
          onSend={sendText}
          onTyping={broadcastTyping}
          onFilePicked={onPickImage}
          onRecord={toggleRecording}
          replyPreview={
            replyTo ? (
              <div className="flex items-start gap-2 border-b border-glass-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-fg">
                    Replying to{" "}
                    {replyTo.sender_id === meId
                      ? "yourself"
                      : (otherName ?? "them")}
                  </p>
                  <p className="truncate text-[13px] text-fg-muted">
                    {replyPreviewText(replyTo)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="focus-ring -mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : null
          }
        />
      )}

      {pendingFile && (
        <ImageCropper
          file={pendingFile}
          aspect={1}
          aspectOptions
          title="Edit photo"
          onCancel={() => setPendingFile(null)}
          onCropped={onCropped}
        />
      )}

      {/* fix-057: the same viewer the community/room/Discover surfaces use. */}
      <PhotoViewer
        open={Boolean(viewingPhoto)}
        onClose={() => setViewingPhoto(null)}
        src={viewingPhoto?.src ?? null}
        alt="Shared image"
        senderName={viewingPhoto?.senderName ?? null}
        timestamp={viewingPhoto?.timestamp ?? null}
      />

      {/* UAT-005/009: long-press any message to react, forward, edit or unsend. */}
      <GlassSheet
        open={Boolean(actionsFor)}
        onClose={() => setActionsFor(null)}
        label="Message actions"
      >
        {actionsFor &&
          (() => {
            const a = actionsFor;
            const mine = a.sender_id === meId;
            const isText = !a.attachment_url && !a.shared_post_id;
            const canForward = Boolean(a.body) || Boolean(a.shared_post_id);
            return (
              <div className="space-y-3">
                {/* Quick-emoji reaction row (UAT-005). */}
                <div className="flex items-center justify-between px-1">
                  {QUICK_EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => react(a.id, e)}
                      className="flex h-10 w-10 items-center justify-center rounded-full text-2xl active:scale-90"
                      aria-label={`React ${e}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => startReply(a)}
                  className="glass flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-fg"
                >
                  <Reply className="h-4 w-4" aria-hidden />
                  Reply
                </button>

                {canForward && (
                  <button
                    type="button"
                    onClick={() => {
                      setForwardFor(a);
                      setActionsFor(null);
                    }}
                    className="glass flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-fg"
                  >
                    <CornerUpRight className="h-4 w-4" aria-hidden />
                    Forward
                  </button>
                )}

                {/* Pin/unpin — either participant, any non-deleted message (Phase 10). */}
                <button
                  type="button"
                  onClick={() => togglePin(a)}
                  className="glass flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-fg"
                >
                  {a.pinned_at ? (
                    <>
                      <PinOff className="h-4 w-4" aria-hidden />
                      Unpin message
                    </>
                  ) : (
                    <>
                      <Pin className="h-4 w-4" aria-hidden />
                      Pin message
                    </>
                  )}
                </button>

                {mine && isText && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditDraft(a.body ?? "");
                      setEditing(a);
                      setActionsFor(null);
                    }}
                    className="glass flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-fg"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    Edit message
                  </button>
                )}

                {mine ? (
                  <button
                    type="button"
                    onClick={() => confirmDelete(a)}
                    className="glass flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-error"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Unsend
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startSelecting(a)}
                    className="glass flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-error"
                  >
                    <Flag className="h-4 w-4" aria-hidden />
                    Report messages
                  </button>
                )}
              </div>
            );
          })()}
      </GlassSheet>

      <ForwardSheet
        message={forwardFor}
        onClose={() => setForwardFor(null)}
        onError={setError}
      />

      {/* Selective reporting replaces the old one-tap "report this message"
          sheet. That sheet filed a report carrying a reason and a message id
          and nothing else, so a moderator received a complaint with no
          evidence they were allowed to look at — and the only way to see the
          message was the DM transcript browser, which no longer exists. */}
      {reviewing && (
        <ReportReview
          conversationId={conversationId}
          messages={selectedForReview()}
          onClose={() => setReviewing(false)}
          onSubmitted={(id) => {
            setReviewing(false);
            setSelecting(false);
            setSelectedIds([]);
            setFiledReportId(id);
          }}
        />
      )}

      {filedReportId && (
        <ReportFiled
          reportId={filedReportId}
          onClose={() => {
            setFiledReportId(null);
            if (reportParam) router.replace(`/chat/${conversationId}`);
          }}
        />
      )}
    </div>
  );
}

/** Group a message's raw reactions into per-emoji chips, flagging mine. */
function aggregateReactions(
  list: Reaction[] | undefined,
  meId: string
): { emoji: string; count: number; mine: boolean }[] {
  if (!list || list.length === 0) return [];
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const r of list) {
    const cur = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (r.user_id === meId) cur.mine = true;
    byEmoji.set(r.emoji, cur);
  }
  return [...byEmoji.entries()]
    .map(([emoji, v]) => ({ emoji, ...v }))
    .sort((a, b) => b.count - a.count);
}

/** Forward a message's content to one of the caller's matches (UAT-005). */
function ForwardSheet({
  message,
  onClose,
  onError,
}: {
  message: ChatMessage | null;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  return (
    <GlassSheet open={Boolean(message)} onClose={onClose} label="Forward to">
      {/* Mounts fresh each open, so friends/sent state resets per message with
          no effect-driven resetting (keeps the linter's no-setState-in-effect
          rule happy). */}
      {message && (
        <ForwardSheetContent message={message} onError={onError} />
      )}
    </GlassSheet>
  );
}

function ForwardSheetContent({
  message,
  onError,
}: {
  message: ChatMessage;
  onError: (msg: string) => void;
}) {
  const [friends, setFriends] = useState<MatchedFriend[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    listMatchedFriends().then((f) => active && setFriends(f));
    return () => {
      active = false;
    };
  }, []);

  async function send(friend: MatchedFriend) {
    if (sentIds.has(friend.id) || busyId) return;
    setBusyId(friend.id);
    const res = await forwardMessage(friend.id, {
      body: message.body,
      sharedPostId: message.shared_post_id,
    });
    setBusyId(null);
    if (!res.ok) {
      onError(res.error);
      return;
    }
    setSentIds((prev) => new Set(prev).add(friend.id));
  }

  return (
      <div className="flex max-h-[70vh] flex-col">
        <h3 className="mb-3 text-lg font-bold">Forward to</h3>
        {/* Keeps finger-scrolling while the sheet panel claims the drag gesture. */}
        <div data-sheet-scroll className="min-h-0 flex-1 overflow-y-auto">
          {friends === null ? (
            <p className="py-6 text-center text-sm text-fg-muted">Loading…</p>
          ) : friends.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              No matches yet to forward to.
            </p>
          ) : (
            <ul className="space-y-1">
              {friends.map((f) => {
                const sent = sentIds.has(f.id);
                return (
                  <li
                    key={f.id}
                    className="glass flex items-center gap-3 rounded-[var(--radius-sm)] p-3"
                  >
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-card">
                      {resolveAvatarUrl(f.avatar_url, f.gender) && (
                        <AppImage
                          src={resolveAvatarUrl(f.avatar_url, f.gender)!}
                          alt=""
                          sizes="40px"
                        />
                      )}
                    </div>
                    <span className="flex-1 truncate text-sm font-medium">
                      {f.full_name ?? "Student"}
                    </span>
                    <button
                      type="button"
                      onClick={() => send(f)}
                      disabled={sent || busyId === f.id}
                      className={cn(
                        "flex h-9 min-w-[76px] items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold",
                        sent ? "bg-aura/15 text-aura" : "bg-aura text-white"
                      )}
                    >
                      {sent ? (
                        <>
                          <Check className="h-4 w-4" aria-hidden />
                          Sent
                        </>
                      ) : busyId === f.id ? (
                        "Sending…"
                      ) : (
                        "Send"
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
  );
}
