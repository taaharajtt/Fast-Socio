"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageSquare, HandHeart, Check, Zap } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import { CATEGORY_META, STATUS_META } from "@/lib/help/constants";
import { isUrgentRequest, resolveHelpAuthor } from "@/lib/help/logic";
import type { HelpRequestRow } from "@/lib/help/types";
import { respondToHelp, resolveRequest } from "@/app/(student)/help/actions";

/**
 * A single help request in the list. Presentational, plus two owner/helper quick
 * actions that keep the surface a utility rather than a feed: a non-owner can
 * offer "I can help" without opening the thread, and the owner can resolve inline.
 */
export function HelpCard({ req }: { req: HelpRequestRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [offered, setOffered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cat = CATEGORY_META[req.category];
  const CatIcon = cat?.icon ?? HandHeart;
  const urgent = req.status === "open" && isUrgentRequest(req.urgency);
  const author = resolveHelpAuthor({
    isAnonymous: req.is_anonymous,
    authorId: req.author_id,
    authorName: req.author_name,
    authorUsername: req.author_username,
    authorAvatarUrl: req.author_avatar_url,
  });

  const meta = [
    req.course_code,
    req.department,
    req.semester ? `Sem ${req.semester}` : null,
  ].filter(Boolean);

  function offerHelp() {
    setError(null);
    start(async () => {
      const res = await respondToHelp(req.id, "", "offer");
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOffered(true);
      router.refresh();
    });
  }

  function markResolved() {
    setError(null);
    start(async () => {
      const res = await resolveRequest(req.id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <GlassCard
      radius="md"
      className={cn("p-4", urgent && "ring-1 ring-error/40")}
    >
      {/* Top row: URGENT capsule (boosted) + category + status + age */}
      <div className="flex flex-wrap items-center gap-1.5">
        {urgent && (
          <span className="flex items-center gap-1 rounded-full bg-error px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
            <Zap className="h-3 w-3" aria-hidden /> Urgent
          </span>
        )}
        <GlassChip tone="neutral" className="gap-1.5">
          <CatIcon className="h-3.5 w-3.5" aria-hidden />
          {cat?.short ?? req.category}
        </GlassChip>
        <GlassChip tone={STATUS_META[req.status].tone}>
          {req.status === "resolved" ? (
            <>
              <Check className="h-3 w-3" aria-hidden /> Resolved
            </>
          ) : (
            STATUS_META[req.status].label
          )}
        </GlassChip>
        <span className="ml-auto text-xs text-fg-muted">
          {timeAgo(req.created_at)}
        </span>
      </div>

      {/* Title + preview link into the thread */}
      <Link href={`/help/${req.id}`} className="mt-2.5 block">
        <h3 className="text-[15px] font-semibold leading-snug text-fg">
          {req.title}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{req.body}</p>
      </Link>

      {meta.length > 0 && (
        <p className="mt-2 truncate text-xs font-medium text-cyan">
          {meta.join(" · ")}
        </p>
      )}

      {/* Author + counts */}
      <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
        <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
          {author.avatarUrl && (
            <AppImage src={author.avatarUrl} alt="" sizes="20px" />
          )}
        </span>
        <span className="truncate">{author.name}</span>
        <span className="ml-auto flex items-center gap-1">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          {req.response_count}
        </span>
      </div>

      {/* CTA row: owner resolves; others offer help; everyone can View */}
      <div className="mt-3 flex items-center gap-2">
        {req.is_mine ? (
          req.status === "open" ? (
            <button
              type="button"
              onClick={markResolved}
              disabled={pending}
              className="flex-1 rounded-full bg-card px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
            >
              {pending ? "…" : "Mark resolved"}
            </button>
          ) : null
        ) : req.status === "open" ? (
          <button
            type="button"
            onClick={offerHelp}
            disabled={pending || offered}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition-all active:scale-95 disabled:opacity-60",
              offered
                ? "bg-success/15 text-success"
                : "gradient-brand text-white"
            )}
          >
            {offered ? (
              <>
                <Check className="h-4 w-4" aria-hidden /> Offered
              </>
            ) : (
              <>
                <HandHeart className="h-4 w-4" aria-hidden /> I can help
              </>
            )}
          </button>
        ) : null}
        <Link
          href={`/help/${req.id}`}
          className={cn(
            "rounded-full bg-card px-4 py-2 text-center text-sm font-medium text-fg-muted transition-colors hover:text-fg",
            !req.is_mine && req.status === "resolved" && "flex-1"
          )}
        >
          View
        </Link>
      </div>
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
    </GlassCard>
  );
}
