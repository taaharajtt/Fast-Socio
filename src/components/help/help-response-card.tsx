"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Award,
  Trash2,
  Flag,
  CornerDownRight,
  VenetianMask,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import { resolveHelpResponseAuthor } from "@/lib/help/logic";
import type { HelpResponseRow } from "@/lib/help/types";
import {
  selectHelper,
  deleteResponse,
  replyToResponse,
} from "@/app/(student)/help/actions";
import { HelpReportSheet } from "./help-report-sheet";
import { HelpAnonBadge } from "./help-anon-badge";

/**
 * One response in a request thread. What renders depends on who's looking — and
 * the DB view (mig 0109) only ever hands this component a row the viewer is
 * allowed to see (the seeker, this response's own author, or an admin):
 *  • Seeker: select & thank (the gratitude loop → resolve + Aura, awards the
 *    helper only), and reply to this helper. No DMs — responses/replies are
 *    the only communication channel.
 *  • Helper (own response): delete it (until selected), and read the seeker's
 *    reply to them.
 * An anonymous helper is shown as "Anonymous helper · School · Nth Semester";
 * the seeker still selects/thanks by response id, so anonymity never blocks it.
 */
export function HelpResponseCard({
  response,
  requestId,
  viewerCanSelect,
  viewerCanReply,
}: {
  response: HelpResponseRow;
  requestId: string;
  viewerCanSelect: boolean;
  viewerCanReply: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState(response.seeker_reply ?? "");

  const author = resolveHelpResponseAuthor({
    authorIsAnon: response.author_is_anon,
    authorId: response.author_id,
    authorName: response.author_name,
    authorUsername: response.author_username,
    authorAvatarUrl: response.author_avatar_url,
    authorSchool: response.author_school,
    authorSemester: response.author_semester,
  });

  const isOwner = response.viewer_owns_request;

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function sendReply() {
    setError(null);
    start(async () => {
      const res = await replyToResponse(response.id, requestId, replyText);
      if (!res.ok) setError(res.error);
      else {
        setReplyOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div
      className={cn(
        "py-3.5",
        response.is_selected && "bg-success/5"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-elevated">
          {author.anonymous ? (
            <VenetianMask className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
          ) : (
            author.avatarUrl && (
              <AppImage src={author.avatarUrl} alt="" sizes="28px" />
            )
          )}
        </span>
        <div className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {author.href ? (
              <Link href={author.href} className="block truncate text-sm font-semibold text-fg">
                {author.name}
              </Link>
            ) : (
              <span className="block truncate text-sm font-semibold text-fg">
                {author.name}
              </span>
            )}
            {response.is_anonymous && !author.anonymous && <HelpAnonBadge />}
          </span>
          {author.meta && (
            <span className="block truncate text-xs text-fg-muted">{author.meta}</span>
          )}
        </div>
        {response.is_selected ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-xs font-semibold text-success">
            <Award className="h-3.5 w-3.5" aria-hidden /> Thanked
          </span>
        ) : (
          <span className="shrink-0 text-xs text-fg-muted">
            {timeAgo(response.created_at)}
          </span>
        )}
      </div>

      {response.body && (
        <p className="mt-2 whitespace-pre-wrap text-[15px] text-fg">
          {response.body}
        </p>
      )}

      {/* Seeker's reply to this helper — visible to the two parties + admin. */}
      {response.seeker_reply && (
        <div className="mt-2.5 flex gap-2 rounded-[12px] bg-white/[0.04] p-2.5">
          <CornerDownRight
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-fg-muted">
              {isOwner ? "Your reply" : "Reply from the poster"}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg">
              {response.seeker_reply}
            </p>
          </div>
        </div>
      )}

      {/* Action row — the seeker gets exactly two actions here: select & thank,
          and reply. No DMs; responses/replies are the only communication. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {/* Seeker: mark this as the response that solved it (resolve + thank) */}
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

        {/* Seeker: reply to this helper */}
        {viewerCanReply && (
          <button
            type="button"
            onClick={() => setReplyOpen((v) => !v)}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-60"
          >
            <CornerDownRight className="h-3.5 w-3.5" aria-hidden />
            {response.seeker_reply ? "Edit reply" : "Reply"}
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

      {/* Seeker reply composer (compact) */}
      {viewerCanReply && replyOpen && (
        <div className="mt-2.5 rounded-[12px] bg-white/[0.04] p-2.5">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value.slice(0, 1000))}
            placeholder="Reply to this helper…"
            rows={2}
            className="w-full resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReplyOpen(false)}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={sendReply}
              disabled={pending}
              className="gradient-brand ml-auto rounded-full px-4 py-1.5 text-xs font-semibold text-white active:scale-95 disabled:opacity-50"
            >
              {pending ? "…" : "Send reply"}
            </button>
          </div>
        </div>
      )}

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
