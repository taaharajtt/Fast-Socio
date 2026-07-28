"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deleteDiscoverGroupChat } from "@/app/(student)/discover/discover-actions";

/**
 * Owner-only delete for a Discover team room, living in the thread header.
 *
 * Deleting takes the whole room and its history with it for every member, so
 * it gets an explicit confirm step rather than firing on the first tap — the
 * same shape as the delete confirm on /discover/post.
 */
export function DiscoverGroupMenu({ communityId }: { communityId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove() {
    setError(null);
    start(async () => {
      const res = await deleteDiscoverGroupChat(communityId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirming(false);
      router.replace("/chat");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Delete group"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-error/10 hover:text-error"
      >
        <Trash2 className="h-[18px] w-[18px]" aria-hidden />
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-group-title"
          onClick={() => !pending && setConfirming(false)}
        >
          <div
            className="glass w-full max-w-md rounded-[20px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-error" aria-hidden />
              <span id="delete-group-title" className="text-base font-bold tracking-tight">
                Delete this group?
              </span>
            </p>
            <p className="mt-1.5 text-sm text-fg-muted">
              The room and every message in it are removed for everyone on the
              team. This can&apos;t be undone. Your Discover post stays filled.
            </p>

            {error && <p className="mt-2 text-xs font-medium text-error">{error}</p>}

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={remove}
                className="w-full rounded-full bg-error px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Delete group"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
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
