"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Award,
  Trash2,
  Flag,
  HandHeart,
  Check,
  X,
  MessageCircle,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import { resolveHelpAuthor } from "@/lib/help/logic";
import type { HelpResponseRow } from "@/lib/help/types";
import {
  selectHelper,
  deleteResponse,
  acceptHelpOffer,
  declineHelpOffer,
  openHelpChat,
} from "@/app/(student)/help/actions";
import { HelpReportSheet } from "./help-report-sheet";

/**
 * One response in a request thread. Two overlapping owner tools:
 *  • Approve / decline — opens (or declines) a private chat with this helper.
 *    Approving reveals identity only through the chat, so an anonymous asker
 *    stays anonymous everywhere else.
 *  • Select & thank — the gratitude loop: marks the response as the one that
 *    solved it, resolves the request, and awards Aura.
 * The response's own author can delete it (until selected) or, once approved,
 * message the asker back. Everyone else can report it.
 */
export function HelpResponseCard({
  response,
  requestId,
  viewerCanSelect,
}: {
  response: HelpResponseRow;
  requestId: string;
  viewerCanSelect: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const author = response.author_is_op_anon
    ? { anonymous: true, name: "Original poster", href: null, avatarUrl: null }
    : resolveHelpAuthor({
        isAnonymous: false,
        authorId: response.author_id,
        authorName: response.author_name,
        authorUsername: response.author_username,
        authorAvatarUrl: response.author_avatar_url,
      });

  const isOwner = response.viewer_owns_request;
  const accepted = response.status === "accepted";
  const declined = response.status === "declined";
  const pendingOffer = response.status === "pending";

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function chat() {
    setError(null);
    start(async () => {
      const res = await openHelpChat(response.id);
      // Success redirects server-side; only an error returns here.
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div
      className={cn(
        "rounded-[14px] p-3.5",
        response.is_selected
          ? "bg-success/10 ring-1 ring-success/40"
          : accepted
            ? "bg-aura/10 ring-1 ring-aura/30"
            : "glass"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
          {author.avatarUrl && (
            <AppImage src={author.avatarUrl} alt="" sizes="28px" />
          )}
        </span>
        {author.href ? (
          <Link href={author.href} className="truncate text-sm font-semibold text-fg">
            {author.name}
          </Link>
        ) : (
          <span className="truncate text-sm font-semibold text-fg">{author.name}</span>
        )}
        {response.kind === "offer" && !response.body && (
          <span className="flex items-center gap-1 text-xs text-aura">
            <HandHeart className="h-3.5 w-3.5" aria-hidden /> offered to help
          </span>
        )}
        {response.is_selected ? (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-xs font-semibold text-success">
            <Award className="h-3.5 w-3.5" aria-hidden /> Thanked
          </span>
        ) : accepted ? (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-aura/20 px-2 py-0.5 text-xs font-semibold text-aura">
            <Check className="h-3.5 w-3.5" aria-hidden /> Approved
          </span>
        ) : (
          <span className="ml-auto text-xs text-fg-muted">
            {timeAgo(response.created_at)}
          </span>
        )}
      </div>

      {response.body && (
        <p className="mt-2 whitespace-pre-wrap text-[15px] text-fg">
          {response.body}
        </p>
      )}

      {/* Action row */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {/* Owner: approve / decline a pending offer */}
        {isOwner && pendingOffer && (
          <>
            <button
              type="button"
              onClick={() => run(() => acceptHelpOffer(response.id, requestId))}
              disabled={pending}
              className="flex items-center gap-1.5 rounded-full bg-aura/15 px-3 py-1.5 text-xs font-semibold text-aura transition-colors disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" aria-hidden /> Approve &amp; chat
            </button>
            <button
              type="button"
              onClick={() => run(() => declineHelpOffer(response.id, requestId))}
              disabled={pending}
              className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-error disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Decline
            </button>
          </>
        )}

        {/* Either party can open the chat once approved */}
        {accepted && (isOwner || response.is_mine) && (
          <button
            type="button"
            onClick={chat}
            disabled={pending}
            className="gradient-brand flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Message
          </button>
        )}

        {declined && isOwner && (
          <span className="text-xs text-fg-muted">Declined</span>
        )}

        {/* Owner: mark this as the response that solved it (resolve + thank) */}
        {viewerCanSelect && !response.is_selected && (
          <button
            type="button"
            onClick={() => run(() => selectHelper(response.id, requestId))}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1.5 text-xs font-semibold text-success transition-colors disabled:opacity-60"
          >
            <Award className="h-3.5 w-3.5" aria-hidden /> Select &amp; thank
          </button>
        )}

        {/* Response author: delete their own (until selected) */}
        {response.is_mine && !response.is_selected && (
          <button
            type="button"
            onClick={() => run(() => deleteResponse(response.id, requestId))}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-error disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
          </button>
        )}

        {!response.is_mine && (
          <button
            type="button"
            onClick={() => setReporting(true)}
            className="ml-auto flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-error"
            aria-label="Report response"
          >
            <Flag className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-error">{error}</p>}

      <HelpReportSheet
        open={reporting}
        onClose={() => setReporting(false)}
        targetType="help_response"
        targetId={response.id}
        targetLabel="response"
      />
    </div>
  );
}
