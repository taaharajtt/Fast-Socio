"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Trash2 } from "lucide-react";
import {
  deleteDiscoverGroupChat,
  leaveDiscoverGroupChat,
} from "@/app/(student)/discover/discover-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * The one destructive control in a Discover team room's header.
 *
 * The owner sees Delete — it takes the room and its history with it for every
 * member. Everyone else sees Leave, which removes only their own seat. Never
 * both: an owner leaving would orphan the room, so they are told to delete it
 * instead (fix-019's stated default — no ownership transfer in this pass).
 *
 * Either way it is an explicit confirm step rather than firing on the first tap,
 * the same shape as the delete confirm on /discover/post.
 */
export function DiscoverGroupMenu({
  communityId,
  isOwner,
  groupName,
}: {
  communityId: string;
  isOwner: boolean;
  groupName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function act() {
    setError(null);
    start(async () => {
      const res = isOwner
        ? await deleteDiscoverGroupChat(communityId)
        : await leaveDiscoverGroupChat(communityId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirming(false);
      // Out of the thread, and the inbox re-fetches without this room.
      router.replace("/chat");
      router.refresh();
    });
  }

  const Icon = isOwner ? Trash2 : LogOut;

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={isOwner ? "Delete group" : "Leave group"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-error/10 hover:text-error"
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </button>

      <ConfirmDialog
        open={confirming}
        title={isOwner ? "Delete this group?" : `Leave ${groupName}?`}
        description={
          isOwner
            ? "The room and every message in it are removed for everyone on the team. This can’t be undone. Your Discover post stays filled."
            : "You’ll stop receiving its messages and it disappears from your chat list. The group carries on without you."
        }
        confirmLabel={isOwner ? "Delete group" : "Leave group"}
        pendingLabel={isOwner ? "Deleting…" : "Leaving…"}
        onConfirm={act}
        onCancel={() => setConfirming(false)}
        pending={pending}
        error={error}
      />
    </>
  );
}
