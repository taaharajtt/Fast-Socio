"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, ImagePlus, Mic, Square, Flag } from "lucide-react";
import { GlassButton, GlassSheet } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  sendMessage,
  markConversationRead,
  reportMessage,
} from "@/app/(student)/chat/actions";

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string | null;
  attachment_url: string | null;
  attachment_type: "image" | "voice" | null;
  created_at: string;
  read_at: string | null;
};

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
}: {
  conversationId: string;
  meId: string;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

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
  }, [conversationId, meId]);

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
    return supabase.storage.from("chat-media").getPublicUrl(path).data
      .publicUrl;
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
                  {m.attachment_type === "image" && m.attachment_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.attachment_url}
                      alt="Shared image"
                      className="max-h-64 rounded-xl object-cover"
                    />
                  ) : m.attachment_type === "voice" && m.attachment_url ? (
                    <audio controls src={m.attachment_url} className="h-10" />
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
            <div className="glass rounded-2xl rounded-bl-md px-4 py-2 text-sm text-fg-muted">
              typing…
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
