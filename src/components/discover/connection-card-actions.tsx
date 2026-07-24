"use client";

import { Check, MessageCircle } from "lucide-react";
import { modeMeta } from "@/lib/smart-match/modes";
import type { SmartMatchPost } from "@/lib/smart-match/types";

/**
 * The CTA strip of a connection card. It is entirely driven by the viewer's own
 * relationship to the post: the kind-specific call to action ("Request to Join",
 * "I'm In", "Invite"…) only appears when there is nothing pending — otherwise
 * the card shows the response's state instead, so a card never invites you to
 * do something you've already done.
 */
export function ConnectionCardActions({
  post,
  busy,
  onRespond,
  onMessage,
  onCancel,
}: {
  post: SmartMatchPost;
  busy: boolean;
  onRespond: (post: SmartMatchPost) => void;
  onMessage: (authorId: string) => void;
  onCancel: (responseId: string) => void;
}) {
  const status = post.myApplicationStatus;

  if (status === "accepted") {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onMessage(post.authorId)}
        className="flex w-full items-center justify-center gap-1.5 rounded-full bg-accent py-2.5 text-sm font-semibold text-white active:scale-95"
      >
        <MessageCircle className="h-4 w-4" aria-hidden /> Message
      </button>
    );
  }

  if (status === "pending") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-full bg-white/[0.04] px-4 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-success">
          <Check className="h-4 w-4" aria-hidden /> Requested
        </span>
        {post.myApplicationId && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onCancel(post.myApplicationId!)}
            className="text-xs font-medium text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (status === "declined") {
    return (
      <p className="rounded-full bg-white/[0.04] py-2 text-center text-sm text-fg-disabled">
        Not selected
      </p>
    );
  }

  // null or cancelled → can respond.
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onRespond(post)}
      className="w-full rounded-full bg-accent py-2.5 text-sm font-semibold text-white active:scale-95"
    >
      {modeMeta(post.mode).cta}
    </button>
  );
}

/** Author view of their own card: manage it instead of responding to it. */
export function OwnPostActions({
  busy,
  pendingCount,
  onEdit,
  onClose,
}: {
  busy: boolean;
  pendingCount: number;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
        {pendingCount > 0
          ? `${pendingCount} pending request${pendingCount === 1 ? "" : "s"}`
          : "Your post · no requests yet"}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onEdit}
        className="glass rounded-full px-3.5 py-1.5 text-xs font-semibold"
      >
        Edit
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onClose}
        className="rounded-full px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
      >
        Close
      </button>
    </div>
  );
}
