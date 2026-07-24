import Link from "next/link";
import { MessageSquare, HandHeart, Check, Zap, VenetianMask } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import { CATEGORY_META, STATUS_META } from "@/lib/help/constants";
import { isUrgentRequest, resolveHelpAuthor } from "@/lib/help/logic";
import type { HelpRequestRow } from "@/lib/help/types";
import { HelpAnonBadge } from "./help-anon-badge";

/**
 * A single help request in a list (SOCIO or ME). Purely presentational: the
 * whole card is one link into the request thread — no inline actions. Seeker-only
 * controls (resolve/reopen/select/reply) and the respond composer all live on the
 * detail page, where the viewer's role is known. Anonymous asks show only school
 * and semester, never a name, avatar, or profile link.
 */
export function HelpCard({ req }: { req: HelpRequestRow }) {
  const cat = CATEGORY_META[req.category];
  const CatIcon = cat?.icon ?? HandHeart;
  const urgent = req.status === "open" && isUrgentRequest(req.urgency);
  const author = resolveHelpAuthor({
    isAnonymous: req.is_anonymous,
    authorId: req.author_id,
    authorName: req.author_name,
    authorUsername: req.author_username,
    authorAvatarUrl: req.author_avatar_url,
    authorSchool: req.author_school,
    authorSemester: req.author_semester,
  });

  return (
    <Link href={`/help/${req.id}`} className="block active:scale-[0.99]">
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

        {/* Title + preview */}
        <div className="mt-2.5">
          <h3 className="text-[15px] font-semibold leading-snug text-fg">
            {req.title}
          </h3>
          <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{req.body}</p>
        </div>

        {/* Author (or Anonymous) + counts */}
        <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
          <span className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-elevated">
            {author.anonymous ? (
              <VenetianMask className="h-3 w-3 text-fg-muted" aria-hidden />
            ) : (
              author.avatarUrl && (
                <AppImage src={author.avatarUrl} alt="" sizes="20px" />
              )
            )}
          </span>
          <span className="min-w-0 truncate">
            <span className="font-medium text-fg">{author.name}</span>
            {author.meta && <span className="text-fg-muted"> · {author.meta}</span>}
            {req.is_anonymous && !author.anonymous && (
              <span className="ml-1.5 inline-block align-middle">
                <HelpAnonBadge />
              </span>
            )}
          </span>
          {req.is_mine && (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              {req.response_count}
            </span>
          )}
        </div>
      </GlassCard>
    </Link>
  );
}
