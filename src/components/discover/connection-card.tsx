"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ExternalLink, Heart, Users } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { GlassCard, VerifiedBadge } from "@/components/ui";
import { MatchReasonChips } from "@/components/discover/match-reason-chips";
import {
  ConnectionCardActions,
  OwnPostActions,
} from "@/components/discover/connection-card-actions";
import { MODE_META } from "@/lib/smart-match/modes";
import { safeMatchingDisplay, displayableUrl } from "@/lib/smart-match/display";
import { recordSwipe } from "@/app/(student)/discover/actions";
import type { FeedItem } from "@/lib/discover/feed";
import type { SmartMatchPost } from "@/lib/smart-match/types";
import type { DiscoverProfile } from "@/lib/profile/types";
import type { MatchReason } from "@/lib/smart-match/types";

/**
 * One card in the unified Discover feed. Two shapes share one compact frame so
 * the feed stays scannable: an opportunity post (six kinds) and a SOCIO profile
 * card from the original swipe candidates. Everything rendered is either the
 * author's own published content or a privacy-safe reason chip.
 */
export function ConnectionCard({
  item,
  busy,
  ownPendingCount,
  onRespond,
  onMessage,
  onCancel,
  onEdit,
  onClose,
}: {
  item: FeedItem;
  busy: boolean;
  /** Set when the card is the viewer's own post → manage instead of respond. */
  ownPendingCount?: number | null;
  onRespond: (post: SmartMatchPost) => void;
  onMessage: (authorId: string) => void;
  onCancel: (responseId: string) => void;
  onEdit: (post: SmartMatchPost) => void;
  onClose: (postId: string) => void;
}) {
  if (item.type === "socio")
    return <SocioProfileCard profile={item.profile} reasons={item.reasons} />;

  const { post } = item;
  const meta = MODE_META[post.mode];
  const rows = safeMatchingDisplay(post.mode, post);
  const link =
    displayableUrl(post.hackathonUrl) ?? displayableUrl(post.portfolioUrl);
  const isMine = ownPendingCount != null;

  return (
    <GlassCard className="space-y-2.5 p-4">
      <KindBadge label={meta.label} icon={<meta.icon className="h-3 w-3" aria-hidden />} />

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
            {[
              post.authorDepartment,
              post.authorSemester ? `Sem ${post.authorSemester}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <div>
        <p className="text-[15px] font-semibold leading-snug">{post.title}</p>
        {post.description && (
          <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{post.description}</p>
        )}
      </div>

      {/* "Why this fits you" is meaningless on your own post. */}
      {!isMine && <MatchReasonChips reasons={item.reasons} />}

      {rows.length > 0 && (
        <ul className="space-y-0.5 text-[13px] text-fg-muted">
          {rows.slice(0, 4).map((r) => (
            <li key={r.key}>{r.label}</li>
          ))}
        </ul>
      )}

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
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          {post.mode === "contributor" ? "Portfolio" : "Event page"}
        </a>
      )}

      {isMine ? (
        <OwnPostActions
          busy={busy}
          pendingCount={ownPendingCount ?? 0}
          onEdit={() => onEdit(post)}
          onClose={() => onClose(post.id)}
        />
      ) : (
        <ConnectionCardActions
          post={post}
          busy={busy}
          onRespond={onRespond}
          onMessage={onMessage}
          onCancel={onCancel}
        />
      )}
    </GlassCard>
  );
}

function KindBadge({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-fg-muted">
      {icon}
      {label}
    </span>
  );
}

/**
 * A SOCIO candidate, rendered as a feed card. The swipe deck remains the full
 * experience (Open SOCIO Swipe); here you get the same decision in one tap,
 * writing through the SAME recordSwipe action, so likes and matches behave
 * identically whichever surface you use.
 */
function SocioProfileCard({
  profile,
  reasons,
}: {
  profile: DiscoverProfile;
  reasons: MatchReason[];
}) {
  const [liked, setLiked] = useState(false);
  const [matched, setMatched] = useState(false);
  const [pending, start] = useTransition();

  return (
    <GlassCard className="space-y-2.5 p-4">
      <KindBadge label="SOCIO" icon={<Heart className="h-3 w-3" aria-hidden />} />

      <div className="flex items-center gap-3">
        <Link
          href={`/profile/${profile.id}`}
          className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-bg-elevated"
        >
          {profile.avatar_url && (
            <AppImage src={profile.avatar_url} alt={profile.full_name ?? ""} sizes="48px" />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-[15px] font-semibold">
            {profile.full_name ?? "Student"}
            {profile.verified && <VerifiedBadge size={14} />}
          </p>
          <p className="truncate text-[11px] text-fg-muted">
            {[profile.department, profile.semester ? `Sem ${profile.semester}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {profile.bio && (
        <p className="line-clamp-2 text-sm text-fg-muted">{profile.bio}</p>
      )}

      <MatchReasonChips reasons={reasons} />

      <div className="flex items-center gap-2">
        <Link
          href={`/profile/${profile.id}`}
          className="glass flex-1 rounded-full py-2.5 text-center text-sm font-semibold"
        >
          View
        </Link>
        <button
          type="button"
          disabled={pending || liked}
          onClick={() =>
            start(async () => {
              const res = await recordSwipe(profile.id, "like");
              if (res.ok) {
                setLiked(true);
                setMatched(res.matched);
              }
            })
          }
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-accent py-2.5 text-sm font-semibold text-white active:scale-95 disabled:opacity-70"
        >
          <Heart className="h-4 w-4" aria-hidden />
          {matched ? "It's a match" : liked ? "Liked" : "Connect"}
        </button>
      </div>
    </GlassCard>
  );
}
