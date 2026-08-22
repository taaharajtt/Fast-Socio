"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  CornerUpRight,
  Flag,
  Loader2,
  Mic,
  Paperclip,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { GlassButton, GlassSheet } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import { ImageCropper, type CropResult } from "@/components/ui/image-cropper";
import { PhotoViewer } from "@/components/ui/photo-viewer";
import { cn } from "@/lib/utils";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { renderLinkifiedText } from "@/lib/linkify";
import { createClient } from "@/lib/supabase/client";
import { chatMediaPath } from "@/lib/chat-media";
import { signChatMedia, signChatMediaMany } from "@/lib/chat-media-sign";
import { uploadWithProgress } from "@/lib/storage-upload";
import { clockTime, absoluteTime, timeAgo } from "@/lib/time";
import { VoiceNote } from "@/components/chat/voice-note";
import {
  SharedPostCard,
  type SharedPostPreview,
} from "@/components/chat/shared-post-preview";
import { useRealtimeChannel, useVisibilityRefresh } from "@/lib/realtime/use-realtime-channel";
import {
  mergeMessage,
  mergeMessages,
  newestServerTimestamp,
  resolveOptimistic,
  dropOptimistic,
} from "@/lib/chat/message-merge";
import {
  sendMessage,
  markConversationRead,
  reportMessage,
  fetchOlderMessages,
  fetchNewerMessages,
  editMessage,
  deleteMessage,
  toggleMessageReaction,
  forwardMessage,
  togglePinMessage,
  listMatchedFriends,
  type MatchedFriend,
} from "@/app/(student)/chat/actions";

type Reaction = { emoji: string; user_id: string };
const QUICK_EMOJIS = ["❤️", "😂", "🔥", "👍", "😮", "😢", "🙏"];
// Single-line pill height (min-h-[40px]); the textarea grows past this and
// caps at ~5-6 lines before it scrolls internally.
const MIN_TEXTAREA_HEIGHT = 40;
const MAX_TEXTAREA_HEIGHT = 144;
/**
 * At most one `mark_conversation_read` RPC per this many ms. The RPC marks the
 * whole conversation, so calling it once per inbound message (as this component
 * used to) bought nothing and cost a round trip plus an UPDATE broadcast each
 * time.
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
  /** Client-only: object-URL preview for an optimistic image while it uploads. */
  _localSrc?: string;
  /** Client-only: optimistic image lifecycle — drives the in-bubble spinner and
   *  the Uploading…/Sent footer. Absent on authoritative rows. */
  _uploadStatus?: "uploading" | "sent" | "error";
};

export type { SharedPostPreview };

const REPORT_REASONS = [
  "Harassment or hate",
  "Inappropriate content",
  "Spam or scam",
  "Other",
];

export function ChatThread({
  conversationId,
  meId,
  initialMessages,
  sharedPosts = {},
  hasMore = false,
  initialSignedAttachments = {},
  initialReactions = {},
  showReadReceipts = true,
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
  /** Whether the other participant reveals read receipts (privacy, Phase 8). */
  showReadReceipts?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [signedAttachments, setSignedAttachments] = useState<
    Record<string, string>
  >(initialSignedAttachments);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  // Selected-but-not-yet-cropped image (UAT-011): opens the ImageCropper
  // dialog before anything touches chat-media.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<ChatMessage | null>(null);
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
  const [error, setError] = useState<string | null>(null);
  const [canLoadOlder, setCanLoadOlder] = useState(hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Pinned messages (Refactor Phase 10).

  // iOS keyboard: exposes the keyboard overlap as --kb so the fixed chat shell
  // shrinks and this sticky composer stays visible (Phase 2 keyboard fix).
  useKeyboardInset();

  // Auto-grow the composer textarea with its content, capped at MAX_TEXTAREA_
  // HEIGHT (~5-6 lines) where it starts scrolling internally instead.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT);
    el.style.height = `${Math.max(next, MIN_TEXTAREA_HEIGHT)}px`;
  }, [draft]);

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
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

  /**
   * Newest server-backed timestamp on screen, kept in a ref so the catch-up
   * callback can read it without being re-created (and therefore re-subscribing
   * the channel) on every incoming message.
   */
  const newestServerTimestampRef = useRef<string | null>(
    newestServerTimestamp(initialMessages)
  );
  useEffect(() => {
    newestServerTimestampRef.current = newestServerTimestamp(messages);
  }, [messages]);

  /**
   * Read receipts, throttled.
   *
   * `markConversationRead` used to fire once per inbound INSERT, so receiving a
   * burst of ten messages meant ten server actions, each one an RPC round trip
   * — and each one publishing UPDATEs that came straight back down the socket.
   * The RPC is idempotent and marks the WHOLE conversation, so one call per
   * window is exactly as correct and an order of magnitude cheaper.
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

  /** Mirrors `messages` for callbacks that must not re-subscribe the channel.
   *  Written in an effect: React Compiler rejects a ref write during render. */
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /** Re-read reactions for every message on screen. Only used when a DELETE
   *  event arrives without a `message_id` (see the handler below). */
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
   * while this socket was down — a backgrounded PWA, an expired JWT, a tunnel —
   * is only recoverable by asking for it. Runs on mount, on every (re)subscribe
   * and on focus/visibility resume, and normally returns zero rows.
   *
   * The cursor is the newest SERVER-BACKED row on screen; optimistic bubbles
   * are skipped because their timestamp is this device's clock.
   */
  const catchUp = useCallback(async () => {
    const since = newestServerTimestampRef.current;
    if (!since) return;
    try {
      const rows = (await fetchNewerMessages(conversationId, since)) as ChatMessage[];
      if (rows.length === 0) return;
      setMessages((prev) => mergeMessages(prev, rows));
      for (const m of rows) if (m.attachment_url) signAttachment(m);
      if (rows.some((m) => m.sender_id !== meId)) scheduleMarkRead();
    } catch {
      // Next resume or event tries again.
    }
    // scheduleMarkRead is a stable useCallback declared above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, meId, signAttachment]);

  // Realtime: new messages, edits/deletes/read updates, and typing broadcasts.
  //
  // The subscription itself now goes through `useRealtimeChannel`, which owns
  // the token refresh, the race-free teardown and the reconnect/focus catch-up
  // that this effect used to lack entirely.
  const channelRef = useRealtimeChannel({
    name: `conv:${conversationId}`,
    label: `chat thread ${conversationId}`,
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
            // Dedupe by id and keep the list in `created_at` order. Reconciling
            // my own optimistic bubble is NOT done here any more — it happens
            // off `sendMessage`'s returned id, which cannot mis-pair two
            // identical messages the way body-text matching did.
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
            // Take the whole row, not just read_at: an UPDATE now also carries
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
            // Reactions carry no conversation_id, so we can't filter server-side.
            // RLS already limits delivery to our conversations; re-read the one
            // affected message's reactions (works for INSERT/UPDATE/DELETE alike).
            //
            // On DELETE, `payload.old` carries only the primary key unless the
            // table is REPLICA IDENTITY FULL (it is not), so `message_id` can be
            // absent — in that case fall back to refreshing the reactions of
            // every message currently on screen, which is bounded by the page
            // size and still cheaper than being wrong.
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

  // Opening the thread is a read. Subsequent marks are throttled — see
  // `scheduleMarkRead`.
  useEffect(() => {
    markConversationRead(conversationId);
    lastMarkReadAt.current = Date.now();
  }, [conversationId]);

  // Belt-and-braces alongside the channel's own catch-up: a resume that does
  // NOT re-subscribe (the socket survived) still has to check for messages that
  // arrived while the tab was hidden.
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
      _localSrc: localSrc,
      _uploadStatus: "uploading",
    };
    setMessages((prev) => [...prev, temp]);

    const path = `${conversationId}/${crypto.randomUUID()}.${extension}`;
    try {
      await uploadWithProgress("chat-media", path, blob, { contentType: mimeType });
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, _uploadStatus: "error" } : m))
      );
      return;
    }

    const res = await sendMessage(conversationId, "", { url: path, type: "image" });
    if (!res.ok) {
      setMessages((prev) => dropOptimistic(prev, tempId));
      URL.revokeObjectURL(localSrc);
      setError(res.error);
      return;
    }
    // Reconcile by the id the insert actually got, keeping the local preview so
    // the bubble doesn't flash to a placeholder while its signed URL resolves.
    // If the realtime INSERT beat this round trip, the bubble is dropped
    // instead of duplicated — see `resolveOptimistic`.
    setMessages((prev) =>
      resolveOptimistic(prev, tempId, {
        id: res.message.id,
        created_at: res.message.created_at,
        attachment_url: path,
        _uploadStatus: "sent",
      })
    );
  }

  async function onSendText(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
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
    };
    setMessages((prev) => [...prev, temp]);
    setDraft("");
    const res = await sendMessage(conversationId, text);
    if (!res.ok) {
      setMessages((prev) => dropOptimistic(prev, temp.id));
      setDraft(text);
      setError(res.error);
      return;
    }
    // Reconciled by id, not by body text: sending the same short message twice
    // used to pair the second row with the first bubble and leave a duplicate.
    setMessages((prev) =>
      resolveOptimistic(prev, temp.id, {
        id: res.message.id,
        created_at: res.message.created_at,
      })
    );
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
        if (url) await sendMessage(conversationId, "", { url, type: "voice" });
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

  async function submitReport(reason: string) {
    if (!reportId) return;
    await reportMessage(reportId, reason);
    setReportId(null);
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
    // No actions on deleted or still-sending (optimistic) messages.
    if (m.deleted_at || m.id.startsWith("temp-")) return {};
    const open = () => setActionsFor(m);
    return {
      onPointerDown: () => {
        longPress.current = setTimeout(open, 450);
      },
      onPointerUp: () => {
        if (longPress.current) clearTimeout(longPress.current);
      },
      onPointerLeave: () => {
        if (longPress.current) clearTimeout(longPress.current);
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        open();
      },
    };
  }

  // The last message I sent that the other party has read — the only place a
  // receipt belongs, IG/WhatsApp style.
  const lastReadMine = [...messages]
    .reverse()
    .find((m) => m.sender_id === meId && m.read_at)?.id;
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
        {messages.map((m) => {
          const mine = m.sender_id === meId;
          const deleted = Boolean(m.deleted_at);
          const isMedia =
            !deleted && (m.attachment_type === "image" || Boolean(m.shared_post_id));

          const chips = aggregateReactions(reactions[m.id], meId);

          const isNew = initialUnread.ids.has(m.id);

          return (
            <div key={m.id}>
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
              <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  {...(deleted ? {} : pressHandlers(m))}
                  onDoubleClick={() => !deleted && react(m.id, "❤️")}
                  className={cn(
                    "relative max-w-[78%] text-[15px]",
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
                          : "glass rounded-bl-md cursor-pointer text-fg",
                    // Unread-on-open incoming messages get an accent ring so they
                    // stand out from everything already read.
                    isNew && !deleted && "ring-1 ring-accent/50"
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
                </div>
              </div>

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

              {/* WhatsApp-style meta line under every message: a clock time on
                  each bubble, plus the send/read status on my own messages.
                  UAT-004: the receipt says WHEN a message was seen, not just
                  "Read"; an image still uploading shows its own status. */}
              {!deleted && (
                <p
                  className={cn(
                    "mt-0.5 flex items-center gap-1 text-[11px] text-fg-muted",
                    mine ? "justify-end pr-1" : "justify-start pl-1",
                    m._uploadStatus === "error" && "text-error"
                  )}
                >
                  <time dateTime={m.created_at} title={absoluteTime(m.created_at)}>
                    {clockTime(m.created_at)}
                  </time>
                  {mine &&
                    (m._uploadStatus === "uploading" ? (
                      <>
                        <span aria-hidden>·</span>
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        Uploading…
                      </>
                    ) : m._uploadStatus === "error" ? (
                      <>
                        <span aria-hidden>·</span>
                        Failed to send
                      </>
                    ) : (
                      m.id === (lastReadMine ?? lastMineId) && (
                        <>
                          <span aria-hidden>·</span>
                          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                          {m.read_at && showReadReceipts
                            ? `Seen ${timeAgo(m.read_at)} ago`
                            : "Sent"}
                        </>
                      )
                    ))}
                </p>
              )}
            </div>
          );
        })}
        {otherTyping && (
          <div className="flex justify-start">
            <div className="glass flex items-center gap-1 rounded-2xl rounded-bl-md px-4 py-3">
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

      {editing ? (
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
      ) : (
        <form
          onSubmit={onSendText}
          className="sticky bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
        >
          {/* items-end keeps the side buttons anchored to the textarea's last
              line as it grows, matching the WhatsApp composer feel. */}
          <div className="flex items-end gap-2">
            {recording ? (
              <>
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
              </>
            ) : (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={onPickImage}
                />

                {/* Single rounded pill: textarea + attachment icons live inside
                    together, matching WhatsApp's composer bar. */}
                <div className="glass focus-within:ring-accent/40 flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-3 py-1.5 focus-within:ring-2">
                  {/* text-base (16px): anything smaller triggers iOS Safari's
                      auto-zoom on focus — the root cause of the chat "jump" on
                      iPhones. rows=1 + the auto-grow effect above own the height. */}
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      broadcastTyping();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder="Message…"
                    enterKeyHint="send"
                    className="min-h-[40px] min-w-0 flex-1 resize-none overflow-y-auto border-none bg-transparent text-base text-fg outline-none placeholder:text-fg-muted"
                    style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
                  />

                  {/* Camera only shows idle (no draft) — matches WhatsApp,
                      both icons open the same file picker. */}
                  {draft.trim() === "" && (
                    <button
                      type="button"
                      aria-label="Take photo"
                      onClick={() => fileRef.current?.click()}
                      disabled={busy}
                      className="flex h-7 w-7 shrink-0 items-center justify-center text-fg-muted disabled:opacity-40"
                    >
                      <Camera className="h-5 w-5" aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Attach image"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                    className="flex h-7 w-7 shrink-0 items-center justify-center text-fg-muted disabled:opacity-40"
                  >
                    <Paperclip className="h-5 w-5" aria-hidden />
                  </button>
                </div>

                {/* Floating action button outside the pill: standalone Mic
                    (idle) morphs into Send once text is entered (typing). */}
                {draft.trim().length > 0 ? (
                  <button
                    type="submit"
                    aria-label="Send"
                    disabled={busy}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-light disabled:opacity-40"
                  >
                    <Send className="h-5 w-5" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Record voice note"
                    onClick={toggleRecording}
                    disabled={busy}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-light disabled:opacity-40"
                  >
                    <Mic className="h-5 w-5" aria-hidden />
                  </button>
                )}
              </>
            )}
          </div>
        </form>
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
                    onClick={() => {
                      setReportId(a.id);
                      setActionsFor(null);
                    }}
                    className="glass flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-error"
                  >
                    <Flag className="h-4 w-4" aria-hidden />
                    Report message
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

      <GlassSheet open={Boolean(reportId)} onClose={() => setReportId(null)}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-error" aria-hidden />
            <h3 className="text-lg font-bold">Report message</h3>
          </div>
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => submitReport(r)}
              className="glass flex w-full items-center rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-fg"
            >
              {r}
            </button>
          ))}
        </div>
      </GlassSheet>
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
