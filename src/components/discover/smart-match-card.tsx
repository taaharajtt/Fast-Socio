"use client";

import Link from "next/link";
import { Check, MessageCircle, ExternalLink, Users } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { GlassCard, VerifiedBadge } from "@/components/ui";
import { MatchReasonChips } from "@/components/discover/match-reason-chips";
import { modeMeta } from "@/lib/smart-match/modes";
import { safeMatchingDisplay, displayableUrl } from "@/lib/smart-match/display";
import type { ScoredPost } from "@/lib/smart-match/types";

/**
 * One opportunity card. Everything shown is the author's own published content
 * plus privacy-safe reason chips; no gender/location/raw-request leaks. The CTA
 * reflects the viewer's application state for this post.
 */
export function SmartMatchCard({
  post,
  busy,
  onApply,
  onMessage,
  onCancel,
}: {
  post: ScoredPost;
  busy: boolean;
  onApply: (post: ScoredPost) => void;
  onMessage: (authorId: string) => void;
  onCancel: (applicationId: string) => void;
}) {
  const meta = modeMeta(post.mode);
  const rows = safeMatchingDisplay(post.mode, post);
  const link = displayableUrl(post.hackathonUrl);

  return (
    <GlassCard className="space-y-3 p-4">
      {/* Author */}
      <div className="flex items-center gap-2.5">
        <Link
          href={`/profile/${post.authorId}`}
          className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-bg-elevated"
        >
          {post.authorAvatar && (
            <AppImage src={post.authorAvatar} alt={post.authorName ?? ""} sizes="36px" />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-sm font-semibold">
            {post.authorName ?? "Student"}
            {post.authorVerified && <VerifiedBadge size={14} />}
          </p>
          <p className="truncate text-[11px] text-fg-muted">
            {[post.authorDepartment, post.authorSemester ? `Sem ${post.authorSemester}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {/* Title + description */}
      <div>
        <p className="text-[15px] font-semibold leading-snug">{post.title}</p>
        {post.description && (
          <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{post.description}</p>
        )}
      </div>

      <MatchReasonChips reasons={post.reasons} />

      {/* Mode-specific meta rows */}
      {rows.length > 0 && (
        <ul className="space-y-1 text-[13px] text-fg-muted">
          {rows.map((r) => (
            <li key={r.key}>{r.label}</li>
          ))}
        </ul>
      )}

      {/* Team members (Project / Hackathon) */}
      {post.teamMembers.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] text-fg-muted">
            <Users className="h-3.5 w-3.5" aria-hidden /> Team
          </span>
          <div className="flex">
            {post.teamMembers.slice(0, 5).map((m, i) => (
              <span
                key={m.id}
                className="relative h-6 w-6 overflow-hidden rounded-full bg-bg-elevated ring-2 ring-card"
                style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 5 - i }}
                title={m.username ? `@${m.username}` : undefined}
              >
                {m.avatarUrl && <AppImage src={m.avatarUrl} alt="" sizes="24px" />}
              </span>
            ))}
          </div>
        </div>
      )}

      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1 text-xs font-medium text-aura"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Hackathon page
        </a>
      )}

      {/* CTA */}
      <Cta post={post} meta={meta.cta} busy={busy} onApply={onApply} onMessage={onMessage} onCancel={onCancel} />
    </GlassCard>
  );
}

function Cta({
  post,
  meta,
  busy,
  onApply,
  onMessage,
  onCancel,
}: {
  post: ScoredPost;
  meta: string;
  busy: boolean;
  onApply: (post: ScoredPost) => void;
  onMessage: (authorId: string) => void;
  onCancel: (applicationId: string) => void;
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

  // null or cancelled → can apply.
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onApply(post)}
      className="w-full rounded-full bg-accent py-2.5 text-sm font-semibold text-white active:scale-95"
    >
      {meta}
    </button>
  );
}
