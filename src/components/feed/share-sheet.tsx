"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassSheet } from "@/components/ui";
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
  const router = useRouter();
  const [friends, setFriends] = useState<MatchedFriend[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
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

  async function share(friend: MatchedFriend) {
    setBusyId(friend.id);
    setError(null);
    const res = await sharePostToFriend(friend.id, postId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSentTo(friend.full_name ?? "your friend");
    setTimeout(() => {
      onClose();
      router.push(`/chat/${res.conversationId}`);
    }, 900);
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold">Share to a friend</h3>
      {sentTo ? (
        <p className="text-sm text-aura">Shared with {sentTo}! Opening chat…</p>
      ) : friends === null ? (
        <p className="text-sm text-fg-muted">Loading your matches…</p>
      ) : friends.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No matches yet — match with someone in Discover to share posts.
        </p>
      ) : (
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {friends.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => share(f)}
              disabled={busyId !== null}
              className="glass flex w-full items-center gap-3 rounded-[var(--radius-sm)] p-3 text-left disabled:opacity-50"
            >
              <div className="glass h-10 w-10 shrink-0 overflow-hidden rounded-full">
                {f.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
              </div>
              <span className="flex-1 truncate text-sm font-medium">
                {f.full_name ?? "Student"}
              </span>
              {busyId === f.id && (
                <span className="text-xs text-fg-muted">Sending…</span>
              )}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
