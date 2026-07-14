"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CornerUpRight,
  Flag,
  ImagePlus,
  Mic,
  Pencil,
  Pin,
  PinOff,
  Search,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { GlassButton, GlassSheet } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { createClient } from "@/lib/supabase/client";
import { chatMediaPath, CHAT_MEDIA_TTL_SECONDS } from "@/lib/chat-media";
import { timeAgo } from "@/lib/time";
import { VoiceNote } from "@/components/chat/voice-note";
import {
  SharedPostCard,
  type SharedPostPreview,
} from "@/components/chat/shared-post-preview";
import {
  sendMessage,
  markConversationRead,
  reportMessage,
  fetchOlderMessages,
  editMessage,
  deleteMessage,
  toggleMessageReaction,
  forwardMessage,
  togglePinMessage,
  searchMessages,
  listMatchedFriends,
  type MatchedFriend,
  type MessageSearchHit,
} from "@/app/(student)/chat/actions";

type Reaction = { emoji: string; user_id: string };
const QUICK_EMOJIS = ["❤️", "😂", "🔥", "👍", "😮", "😢", "🙏"];

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
  const [reportId, setReportId] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<ChatMessage | null>(null);
  const [forwardFor, setForwardFor] = useState<ChatMessage | null>(null);
  const [reactions, setReactions] =
    useState<Record<string, Reaction[]>>(initialReactions);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [canLoadOlder, setCanLoadOlder] = useState(hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Pinned messages + in-thread search (Refactor Phase 10).
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<MessageSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // iOS keyboard: exposes the keyboard overlap as --kb so the fixed chat shell
  // shrinks and this sticky composer stays visible (Phase 2 keyboard fix).
  useKeyboardInset();

  // Resolve a signed URL for a private chat-media attachment (P5-01). Images get
  // a 1080px transform; voice notes are signed as-is.
  const signAttachment = useCallback(async (m: ChatMessage) => {
    if (!m.attachment_url) return;
    const path = chatMediaPath(m.attachment_url);
    if (!path) return;
    const supabase = createClient();
    const { data } = await supabase.storage
      .from("chat-media")
      .createSignedUrl(
        path,
        CHAT_MEDIA_TTL_SECONDS,
        m.attachment_type === "image"
          ? { transform: { width: 1080, height: 1080, resize: "contain" } }
          : undefined
      );
    if (data?.signedUrl)
      setSignedAttachments((prev) => ({ ...prev, [m.id]: data.signedUrl }));
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

  // Debounced: one server action per pause in typing, not one per keystroke.
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function runSearch(q: string) {
    setSearchQuery(q);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (q.trim().length < 2) {
      setSearchHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchDebounce.current = setTimeout(async () => {
      setSearchHits(await searchMessages(conversationId, q));
      setSearching(false);
    }, 300);
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
    older.forEach((m) => m.attachment_url && signAttachment(m));
    if (older.length < 50) setCanLoadOlder(false);
    setLoadingOlder(false);
  }

  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);
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

  // Realtime: new messages, edits/deletes/read updates, and typing broadcasts.
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) supabase.realtime.setAuth(session.access_token);

      const channel = supabase
        .channel(`conv:${conversationId}`, {
          config: { broadcast: { self: false } },
        })
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
            setMessages((prev) => {
              if (prev.some((x) => x.id === m.id)) return prev;
              // Reconcile my optimistic bubble: the authoritative row replaces
              // the first matching temp message instead of duplicating it.
              if (m.sender_id === meId) {
                const tempIdx = prev.findIndex(
                  (x) => x.id.startsWith("temp-") && x.body === m.body
                );
                if (tempIdx >= 0) {
                  const next = [...prev];
                  next[tempIdx] = m;
                  return next;
                }
              }
              return [...prev, m];
            });
            if (m.attachment_url) signAttachment(m);
            if (m.sender_id !== meId) markConversationRead(conversationId);
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
            const row = (payload.new ?? payload.old) as { message_id?: string };
            if (row?.message_id) refreshReactions(row.message_id);
          }
        )
        .on("broadcast", { event: "typing" }, () => {
          setOtherTyping(true);
          if (typingTimeout.current) clearTimeout(typingTimeout.current);
          typingTimeout.current = setTimeout(() => setOtherTyping(false), 2500);
        })
        .subscribe();

      channelRef.current = channel;
    })();

    markConversationRead(conversationId);
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [conversationId, meId, signAttachment, refreshReactions]);

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
  }, [meId]);

  // Returns the storage PATH (not a URL): chat-media is private, so messages
  // store the path and the app resolves a signed URL at read time (P5-01).
  async function uploadMedia(
    file: Blob,
    ext: string,
    contentType: string
  ): Promise<string | null> {
    const supabase = createClient();
    const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("chat-media")
      .upload(path, file, { contentType });
    if (upErr) return null;
    return path;
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
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      setDraft(text);
      setError(res.error);
    }
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const url = await uploadMedia(file, ext, file.type);
    if (url) await sendMessage(conversationId, "", { url, type: "image" });
    setBusy(false);
  }

  /** Discard the take: stop the recorder but skip the upload in onstop. */
  function cancelRecording() {
    if (!recording) return;
    cancelledRef.current = true;
    recorderRef.current?.stop();
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
      {/* Search + pinned bar (Refactor Phase 10). */}
      <div className="shrink-0">
        <div className="flex items-center gap-2 py-1">
          {searchOpen ? (
            <>
              <div className="glass flex flex-1 items-center gap-2 rounded-[var(--radius-pill)] px-3 py-1.5">
                <Search className="h-4 w-4 text-fg-muted" aria-hidden />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => runSearch(e.target.value)}
                  placeholder="Search this chat…"
                  className="flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-muted"
                />
              </div>
              <button
                type="button"
                aria-label="Close search"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery("");
                  setSearchHits([]);
                }}
                className="glass flex h-8 w-8 items-center justify-center rounded-full text-fg-muted"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label="Search messages"
              onClick={() => setSearchOpen(true)}
              className="glass ml-auto flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:text-fg"
            >
              <Search className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        {searchOpen && searchQuery.trim().length >= 2 && (
          <div className="mb-1 max-h-56 space-y-1 overflow-y-auto rounded-[var(--radius-md)] border border-glass-border bg-card p-2">
            {searching ? (
              <p className="px-2 py-3 text-center text-xs text-fg-muted">Searching…</p>
            ) : searchHits.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-fg-muted">No matches.</p>
            ) : (
              searchHits.map((h) => (
                <div key={h.id} className="rounded-[var(--radius-sm)] px-2 py-1.5">
                  <p className="line-clamp-2 text-sm text-fg">{h.body}</p>
                  <p className="text-[11px] text-fg-muted">
                    {timeAgo(h.created_at)} ago
                    {h.sender_id === meId ? " · you" : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {!searchOpen && latestPinned && (
          <div className="mb-1 flex items-start gap-2 rounded-[var(--radius-md)] border border-glass-border bg-card px-3 py-2">
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
      </div>

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
                    "relative max-w-[78%] overflow-hidden rounded-2xl text-[15px]",
                    // UAT-002: media sizes the bubble, so the bubble must not add
                    // padding around it. Text and voice keep their inset.
                    isMedia ? "p-1" : "px-4 py-2",
                    deleted
                      ? "border border-dashed border-glass-border bg-transparent text-fg-disabled"
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
                    signedAttachments[m.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={signedAttachments[m.id]}
                        alt="Shared image"
                        className="block max-h-72 w-[220px] rounded-xl object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="flex h-40 w-[220px] animate-pulse items-center justify-center rounded-xl bg-white/10" />
                    )
                  ) : m.attachment_type === "voice" && m.attachment_url ? (
                    signedAttachments[m.id] ? (
                      <VoiceNote src={signedAttachments[m.id]} mine={mine} />
                    ) : (
                      <div className="flex h-8 w-[180px] animate-pulse items-center rounded-full bg-white/10" />
                    )
                  ) : (
                    <span className="whitespace-pre-wrap break-words">
                      {m.body}
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

              {/* UAT-004: a read receipt now says WHEN, not just "Read". */}
              {mine && m.id === (lastReadMine ?? lastMineId) && (
                <p className="mr-1 mt-0.5 flex items-center justify-end gap-1 text-right text-[11px] text-fg-muted">
                  {m.read_at && showReadReceipts ? (
                    <>
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                      Seen {timeAgo(m.read_at)} ago
                    </>
                  ) : (
                    "Sent"
                  )}
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
              className="glass h-11 flex-1 rounded-[var(--radius-pill)] px-4 text-base text-fg outline-none focus:ring-2 focus:ring-aura/40"
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
          className="sticky bottom-0 flex items-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={onPickImage}
          />
          {/* While recording, the image button is replaced by Discard — so a
              take can be thrown away instead of only stopped-and-sent. */}
          {recording ? (
            <button
              type="button"
              aria-label="Discard voice note"
              onClick={cancelRecording}
              className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-error"
            >
              <Trash2 className="h-5 w-5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Attach image"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-muted disabled:opacity-40"
            >
              <ImagePlus className="h-5 w-5" aria-hidden />
            </button>
          )}
          <button
            type="button"
            aria-label={recording ? "Send voice note" : "Record voice note"}
            onClick={toggleRecording}
            disabled={busy && !recording}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40",
              recording ? "bg-error text-white" : "glass text-fg-muted"
            )}
          >
            {recording ? (
              <Square className="h-4 w-4" aria-hidden />
            ) : (
              <Mic className="h-5 w-5" aria-hidden />
            )}
          </button>
          {/* text-base (16px): anything smaller triggers iOS Safari's auto-zoom
              on focus — the root cause of the chat "jump" on iPhones. */}
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              broadcastTyping();
            }}
            placeholder={recording ? "Recording…" : "Message…"}
            disabled={recording}
            className="glass h-11 flex-1 rounded-[var(--radius-pill)] px-4 text-base text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
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
        </form>
      )}

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
                      {f.avatar_url && (
                        <AppImage src={f.avatar_url} alt="" sizes="40px" />
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
