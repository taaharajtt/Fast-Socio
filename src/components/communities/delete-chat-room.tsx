"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deleteChatRoom } from "@/app/(student)/communities/actions";

/**
 * The Danger Zone at the bottom of a chat room's Manage tab (fix-030).
 *
 * Deleting takes the room, its whole history and everyone's membership with it,
 * so — unlike the Discover team room's single-tap confirm — this one makes you
 * TYPE THE ROOM'S NAME first. That is the same shape as the destructive confirm
 * used for irreversible actions elsewhere, deliberately raised a notch because
 * this one cannot be undone by anybody, including us.
 *
 * Owner-only. `delete_chat_room` (mig 0135) re-checks that server-side, so
 * hiding this is convenience, not the guard.
 */
export function DeleteChatRoom({
  communityId,
  name,
}: {
  communityId: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const confirmed = typed.trim() === name.trim();

  function remove() {
    if (!confirmed) return;
    setError(null);
    start(async () => {
      const res = await deleteChatRoom(communityId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.replace("/communities");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full bg-error/10 px-4 py-2 text-sm font-semibold text-error"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        Delete chat room
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-room-title"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="glass w-full max-w-md rounded-[20px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-error" aria-hidden />
              <span
                id="delete-room-title"
                className="text-base font-bold tracking-tight"
              >
                Delete this chat room?
              </span>
            </p>
            <p className="mt-1.5 text-sm text-fg-muted">
              The room, every message in it and everyone&apos;s membership are
              removed for good. This can&apos;t be undone.
            </p>

            <label
              htmlFor="confirm-room-name"
              className="mt-4 block text-xs font-medium text-fg-muted"
            >
              Type <span className="font-bold text-fg">{name}</span> to confirm
            </label>
            <input
              id="confirm-room-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1.5 h-10 w-full rounded-[10px] bg-bg-elevated px-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-error/40"
              placeholder={name}
            />

            {error && <p className="mt-2 text-xs font-medium text-error">{error}</p>}

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={!confirmed || pending}
                onClick={remove}
                className="w-full rounded-full bg-error px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Delete chat room"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="glass w-full rounded-full px-4 py-2.5 text-sm font-semibold text-fg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
