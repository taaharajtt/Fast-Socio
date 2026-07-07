"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Send, ImagePlus, Mic, Square, Flag, FileText } from "lucide-react";
import { GlassButton, GlassSheet } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { chatMediaPath, CHAT_MEDIA_TTL_SECONDS } from "@/lib/chat-media";
import {
  sendMessage,
  markConversationRead,
  reportMessage,
  fetchOlderMessages,
} from "@/app/(student)/chat/actions";

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string | null;
  attachment_url: string | null;
  attachment_type: "image" | "voice" | null;
  shared_post_id: string | null;
  created_at: string;
  read_at: string | null;
};

export type SharedPostPreview = { body: string | null; image_url: string | null };

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
}: {
  conversationId: string;
  meId: string;
  initialMessages: ChatMessage[];
  sharedPosts?: Record<string, SharedPostPreview>;
  hasMore?: boolean;
  /** messageId -> signed URL for private chat-media attachments (P5-01). */
  initialSignedAttachments?: Record<string, string>;
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
  const [canLoadOlder, setCanLoadOlder] = useState(hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Resolve a signed URL for a private chat-media attachment (P5-01). Images get
  // a 1080px transform; voice notes are signed as-is.
  const signAttachment = useCallback(
    async (m: ChatMessage) => {
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
    },
    []
  );

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
  const fileRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Realtime: new messages, read updates, and typing broadcasts.
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
            setMessages((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m]
            );
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
            const m = payload.new as ChatMessage;
            setMessages((prev) =>
              prev.map((x) => (x.id === m.id ? { ...x, read_at: m.read_at } : x))
            );
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
  }, [conversationId, meId, signAttachment]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, otherTyping]);

  const broadcastTyping = useCallback(() => {
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
    const { error } = await supabase.storage
      .from("chat-media")
      .upload(path, file, { contentType });
    if (error) return null;
    return path;
  }

  async function onSendText(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setDraft("");
    const res = await sendMessage(conversationId, text);
    setBusy(false);
    if (!res.ok) setDraft(text);
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
      rec.ondataavailable = (ev) => chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
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

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto py-4">
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
          const isLastMine =
            mine && i === messages.map((x) => x.sender_id).lastIndexOf(meId);
          return (
            <div key={m.id}>
              <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  onClick={() => !mine && setReportId(m.id)}
                  className={cn(
                    "max-w-[78%] overflow-hidden rounded-2xl text-[15px]",
                    m.attachment_type === "image" ? "p-1" : "px-4 py-2",
                    mine
                      ? "gradient-brand rounded-br-md text-white"
                      : "glass rounded-bl-md text-fg cursor-pointer"
                  )}
                >
                  {m.shared_post_id ? (
                    <Link
                      href={`/post/${m.shared_post_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="block w-56 max-w-full"
                    >
                      <div
                        className={cn(
                          "flex items-start gap-2 rounded-xl border p-2.5",
                          mine
                            ? "border-white/30 bg-white/10"
                            : "border-glass-border bg-bg-elevated/40"
                        )}
                      >
                        <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-sm">
                            {sharedPosts[m.shared_post_id]?.body ?? "Shared a post"}
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-xs",
                              mine ? "text-white/70" : "text-fg-muted"
                            )}
                          >
                            Tap to view post →
                          </p>
                        </div>
                      </div>
                    </Link>
                  ) : m.attachment_type === "image" && m.attachment_url ? (
                    signedAttachments[m.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={signedAttachments[m.id]}
                        alt="Shared image"
                        className="max-h-64 rounded-xl object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="flex h-24 w-40 items-center justify-center text-xs text-fg-muted">
                        Loading image…
                      </div>
                    )
                  ) : m.attachment_type === "voice" && m.attachment_url ? (
                    signedAttachments[m.id] ? (
                      <audio controls src={signedAttachments[m.id]} className="h-10" />
                    ) : (
                      <span className="text-xs text-fg-muted">Loading audio…</span>
                    )
                  ) : (
                    m.body
                  )}
                </div>
              </div>
              {isLastMine && (
                <p className="mr-1 mt-0.5 text-right text-[11px] text-fg-muted">
                  {m.read_at ? "Read" : "Sent"}
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
        <button
          type="button"
          aria-label="Attach image"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-muted disabled:opacity-40"
        >
          <ImagePlus className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={recording ? "Stop recording" : "Record voice note"}
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
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            broadcastTyping();
          }}
          placeholder={recording ? "Recording…" : "Message…"}
          disabled={recording}
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
