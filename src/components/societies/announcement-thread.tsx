"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle, Radio } from "lucide-react";
import { AnnouncementCard } from "@/components/societies/announcement-card";
import { ChatComposer } from "@/components/chat/chat-composer";
import { PollComposer } from "@/components/communities/community-chat";
import { ImageCropper, type CropResult } from "@/components/ui/image-cropper";
import { createClient } from "@/lib/supabase/client";
import { uploadWithProgress } from "@/lib/storage-upload";
import {
  postSocietyAnnouncement,
  postSocietyAnnouncementPoll,
} from "@/app/(student)/societies/actions";
import type { AnnouncementRow } from "@/lib/societies/types";

const FEED_COLUMNS =
  "id, society_id, title, body, pinned, visibility, created_at, updated_at, author_id, author_name, author_username, author_avatar, is_mine, poll_id, attachment_url, attachment_type";

/**
 * Broadcast announcements presented as a chat thread — newest at the bottom,
 * scrolled there on mount, consecutive messages from the same author grouped
 * the way `community-thread`/`community-chat` group theirs. The composer
 * lives below the thread and only renders for who-can-post, unchanged.
 */
export function AnnouncementThread({
  societyId,
  announcements,
  canPost,
  canManage,
  isMember,
}: {
  societyId: string;
  /** Newest-first, as loaded from the server. */
  announcements: AnnouncementRow[];
  canPost: boolean;
  canManage: boolean;
  isMember: boolean;
}) {
  // Display oldest -> newest, like a chat thread.
  const [messages, setMessages] = useState<AnnouncementRow[]>(
    () => [...announcements].reverse()
  );

  // Local state, because realtime appends to it — but it must still follow the
  // server's list when a revalidation hands down fresh props. React's documented
  // "adjust state during render" pattern, rather than an effect that setStates
  // synchronously and costs an extra render pass every time.
  const [seen, setSeen] = useState(announcements);
  if (seen !== announcements) {
    setSeen(announcements);
    setMessages([...announcements].reverse());
  }

  const [composingPoll, setComposingPoll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  async function onSend(text: string) {
    setBusy(true);
    setError(null);
    const res = await postSocietyAnnouncement(societyId, text);
    setBusy(false);
    if (!res.ok) setError(res.error);
  }

  async function onCropped(result: CropResult) {
    setCropFile(null);
    setBusy(true);
    setError(null);
    const path = `${societyId}/${crypto.randomUUID()}.${result.extension}`;
    try {
      await uploadWithProgress("chat-media", path, result.blob, {
        contentType: result.mimeType,
      });
      const res = await postSocietyAnnouncement(societyId, "", {
        attachmentPath: path,
      });
      if (!res.ok) setError(res.error);
    } catch {
      setError("Couldn't upload that image.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) supabase.realtime.setAuth(session.access_token);

      const channel = supabase
        .channel(`society-announcements:${societyId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "society_announcements",
            filter: `society_id=eq.${societyId}`,
          },
          async (payload) => {
            const id = (payload.new as { id: string }).id;
            // The raw table row lacks the author's joined name/username/avatar
            // and the is_mine flag, so re-read through the definer feed view
            // that already backs the initial load.
            const { data } = await supabase
              .from("society_announcement_feed")
              .select(FEED_COLUMNS)
              .eq("id", id)
              .maybeSingle();
            if (!data) return;
            const a = data as AnnouncementRow;
            setMessages((prev) =>
              prev.some((x) => x.id === a.id) ? prev : [...prev, a]
            );
          }
        )
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || err) {
            console.error(
              `[societies] announcement realtime subscription failed for ${societyId}`,
              status,
              err
            );
          }
        });

      channelRef.current = channel;
    })();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [societyId]);

  // Scroll the list container directly, not scrollIntoView (which also
  // scrolls ancestors). First paint jumps straight to the bottom; anything
  // that arrives after scrolls smoothly, same as the community chat thread.
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

  return (
    <div className="flex flex-col gap-3">
      {isMember && (
        <Link
          href={`/chat/c/${societyId}`}
          className="flex items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold text-fg active:scale-95"
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          Open chat
        </Link>
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
          className="flex max-h-[70vh] min-h-[240px] flex-col gap-1 overflow-y-auto rounded-[14px] bg-card/60 p-3"
        >
          {messages.map((a, i) => {
            const prev = messages[i - 1];
            const sameAuthor = prev && prev.author_id === a.author_id;
            return (
              <AnnouncementCard
                key={a.id}
                a={a}
                canManage={canManage}
                showAuthorHeader={!sameAuthor}
              />
            );
          })}
        </div>
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
                return true;
              }}
            />
          )}

          {error && <p className="pb-1.5 text-sm text-error">{error}</p>}

          {/* fix-049: the same composer the chat surfaces use, configured for
              this one. No anonymous option — an announcement is signed by the
              society by definition. */}
          <ChatComposer
            placeholder="Post an announcement"
            capabilities={{ poll: true, media: true }}
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
              e.target.value = "";
              if (file) setCropFile(file);
            }}
          />

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
    </div>
  );
}
