"use client";

import { useEffect, useRef, useState } from "react";
import { shouldAutoScroll } from "@/lib/chat/scroll-anchor";
import { mergeMessage } from "@/lib/chat/message-merge";
import { Radio } from "lucide-react";
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
  "id, society_id, title, body, pinned, visibility, created_at, updated_at, author_id, author_name, author_username, author_avatar, is_mine, poll_id, attachment_url, attachment_type, is_anonymous, reply_to_id";

/**
 * Broadcast announcements presented as a chat thread — newest at the bottom,
 * scrolled there on mount, consecutive messages from the same author grouped
 * the way `community-thread`/`community-chat` group theirs. The composer
 * lives below the thread and only renders for who-can-post, unchanged. There is
 * no chat entry point here: a verified community broadcasts, it does not
 * converse.
 */
export function AnnouncementThread({
  societyId,
  announcements,
  canPost,
  canManage,
  canPostAnonymously = false,
  canReveal = false,
}: {
  societyId: string;
  /** Newest-first, as loaded from the server. */
  announcements: AnnouncementRow[];
  canPost: boolean;
  canManage: boolean;
  /** UAT-04: member and up. Mirrors `society_capabilities.can_post_anonymously`. */
  canPostAnonymously?: boolean;
  /** UAT-04: president, owner or admin only. */
  canReveal?: boolean;
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
  // UAT-04: members may post anonymously in the broadcast channel.
  const [anon, setAnon] = useState(false);
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
    const res = await postSocietyAnnouncement(societyId, text, {
      anonymous: anon,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Anonymity is per-message, never sticky: leaving the toggle on would make
    // the NEXT broadcast anonymous without anyone choosing it, which is the
    // same failure UAT-13 describes for the feed composer.
    setAnon(false);
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
            setMessages((prev) => mergeMessage(prev, a));
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
  // UAT-06: follow new messages ONLY when the reader is already at the bottom,
  // or when the newest message is their own. This used to scroll on every
  // change to `messages.length`, which drags someone reading history back to
  // the end whenever anyone speaks — and the scroll position they lose is not
  // recorded anywhere, so it cannot be given back. The decision is shared with
  // the DM thread via `lib/chat/scroll-anchor` and unit-tested there.
  const didInitialScroll = useRef(false);
  const newest = messages.length > 0 ? messages[messages.length - 1] : null;
  const newestId = newest?.id ?? null;
  const newestIsMine = newest?.is_mine === true;
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

  return (
    <div className="flex flex-col gap-3">
      {/* No "Open chat" here. A verified community BROADCASTS — announcements
          out to followers — and does not host a conversation; chat is a chat
          room's feature. The link used to open /chat/c/<societyId>. */}
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
            // Two anonymous messages both carry a NULL author_id, so a plain
            // equality would group them as "the same person" — which is both
            // wrong and a hint about authorship. Anonymous messages never group.
            const sameAuthor =
              prev != null &&
              !a.is_anonymous &&
              !prev.is_anonymous &&
              prev.author_id != null &&
              prev.author_id === a.author_id;
            return (
              <AnnouncementCard
                key={a.id}
                a={a}
                canManage={canManage}
                canReveal={canReveal}
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

          {/* fix-049: the same composer the chat surfaces use.
              UAT-04 turns the anonymous option ON here. This channel is no
              longer a one-way officer notice board — members post in it — and
              the whole point of letting a member raise something with their
              society is that they can do it without their name on it. Only the
              president, the owner or an admin can look behind that, and only by
              the explicit reveal action. */}
          <ChatComposer
            placeholder={
              canPostAnonymously && anon
                ? "Post anonymously"
                : "Post to the channel"
            }
            capabilities={{ poll: true, media: true, anonymous: canPostAnonymously }}
            anonymous={anon}
            onToggleAnonymous={() => setAnon((v) => !v)}
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
