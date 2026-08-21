"use client";

import { useEffect, useState } from "react";
import { Check, Send } from "lucide-react";
import { GlassSheet } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
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
    <GlassSheet
      open={open}
      onClose={onClose}
      label="Share to a friend"
      className="flex h-[60vh] max-h-[75vh] flex-col"
    >
      {/* Mounts fresh each time the sheet opens, so state starts clean. */}
      {open && <ShareSheetContent postId={postId} onClose={onClose} />}
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
    <div className="flex min-h-0 flex-1 flex-col">
      <h3 className="mb-3 shrink-0 text-lg font-bold">Share to a friend</h3>
      {/* Keeps finger-scrolling while the sheet panel claims the drag gesture. */}
      <div
        data-sheet-scroll
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {friends === null ? (
          <p className="py-6 text-center text-sm text-fg-muted">
            Loading your matches…
          </p>
        ) : friends.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">
            No matches yet — match with someone in Discover to share posts.
          </p>
        ) : (
          <ul className="divide-y divide-glass-border">
            {friends.map((f) => {
              const sent = sentIds.has(f.id);
              const sending = busyId === f.id;
              return (
                <li key={f.id} className="flex items-center gap-3 py-2.5">
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-card">
                    {resolveAvatarUrl(f.avatar_url, f.gender) ? (
                      <AppImage
                        src={resolveAvatarUrl(f.avatar_url, f.gender)!}
                        alt=""
                        sizes="40px"
                      />
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
                      "flex h-7 shrink-0 items-center justify-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors",
                      sent
                        ? "text-fg-muted"
                        : "text-aura active:scale-95 disabled:opacity-60"
                    )}
                  >
                    {sent ? (
                      <>
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        Sent
                      </>
                    ) : sending ? (
                      "Sending…"
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" aria-hidden />
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
        className="mt-3 w-full shrink-0 py-2.5 text-center text-sm font-medium text-fg-muted"
      >
        Done
      </button>
    </div>
  );
}
