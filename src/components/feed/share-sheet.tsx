"use client";

import { useEffect, useState } from "react";
import { Check, Send } from "lucide-react";
import { GlassSheet } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import {
  listMatchedFriends,
  sharePostToFriend,
  type MatchedFriend,
} from "@/app/(student)/chat/actions";

export function ShareSheet({
  postId,
  open,
  onClose,
}: {
  postId: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <GlassSheet open={open} onClose={onClose}>
      {/* Mounts fresh each time the sheet opens, so state starts clean. */}
      <ShareSheetContent postId={postId} onClose={onClose} />
    </GlassSheet>
  );
}

function ShareSheetContent({
  postId,
  onClose,
}: {
  postId: string;
  onClose: () => void;
}) {
  const [friends, setFriends] = useState<MatchedFriend[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listMatchedFriends().then((f) => {
      if (active) setFriends(f);
    });
    return () => {
      active = false;
    };
  }, []);

  // UAT-008: send to a specific friend via the row's Send button, gracefully —
  // the row flips to "Sent", the sheet stays open so several friends can get it,
  // and a failure surfaces inline without losing the sheet.
  async function share(friend: MatchedFriend) {
    if (sentIds.has(friend.id) || busyId) return;
    setBusyId(friend.id);
    setError(null);
    const res = await sharePostToFriend(friend.id, postId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSentIds((prev) => new Set(prev).add(friend.id));
  }

  return (
    <div className="flex max-h-[70vh] flex-col">
      <h3 className="mb-3 text-lg font-bold">Share to a friend</h3>
      {/* Keeps finger-scrolling while the sheet panel claims the drag gesture. */}
      <div data-sheet-scroll className="min-h-0 flex-1 overflow-y-auto">
        {friends === null ? (
          <p className="py-6 text-center text-sm text-fg-muted">
            Loading your matches…
          </p>
        ) : friends.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">
            No matches yet — match with someone in Discover to share posts.
          </p>
        ) : (
          <ul className="space-y-1">
            {friends.map((f) => {
              const sent = sentIds.has(f.id);
              const sending = busyId === f.id;
              return (
                <li
                  key={f.id}
                  className="glass flex items-center gap-3 rounded-[var(--radius-sm)] p-3"
                >
                  <div className="glass relative h-10 w-10 shrink-0 overflow-hidden rounded-full">
                    {f.avatar_url ? (
                      <AppImage src={f.avatar_url} alt="" sizes="40px" />
                    ) : null}
                  </div>
                  <span className="flex-1 truncate text-sm font-medium">
                    {f.full_name ?? "Student"}
                  </span>
                  <button
                    type="button"
                    onClick={() => share(f)}
                    disabled={sent || sending}
                    aria-label={sent ? "Sent" : `Send to ${f.full_name ?? "friend"}`}
                    className={cn(
                      "flex h-9 min-w-[76px] items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors",
                      sent
                        ? "bg-aura/15 text-aura"
                        : "bg-aura text-white active:scale-95 disabled:opacity-60"
                    )}
                  >
                    {sent ? (
                      <>
                        <Check className="h-4 w-4" aria-hidden />
                        Sent
                      </>
                    ) : sending ? (
                      "Sending…"
                    ) : (
                      <>
                        <Send className="h-4 w-4" aria-hidden />
                        Send
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
      <button
        type="button"
        onClick={onClose}
        className="glass mt-3 w-full shrink-0 rounded-[var(--radius-sm)] px-4 py-3 text-sm font-medium text-fg"
      >
        Done
      </button>
    </div>
  );
}
