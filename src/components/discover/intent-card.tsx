"use client";

import { CalendarClock, ExternalLink, MapPin, Users, Zap } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { VerifiedBadge } from "@/components/ui";
import { MODE_META } from "@/lib/smart-match/modes";
import { safeMatchingDisplay, displayableUrl, formatWhen } from "@/lib/smart-match/display";
import { KIND_CAPSULE, SWIPE_CTA, type DiscoverSwipeCard } from "@/lib/discover/cards";
import type { MatchReason } from "@/lib/smart-match/types";

/**
 * An opportunity card, built to sit in the SAME deck as a person card: identical
 * frame, identical gestures, only the contents differ. Where a SOCIO card leads
 * with a photo, an intent card leads with what's being asked for — because that,
 * not the face, is what you're deciding about.
 *
 * Everything rendered is the author's own published content plus privacy-safe
 * reason chips; the author preview is limited to the fields the feed RPC already
 * gated behind their own visibility switches.
 */
export function IntentCardBody({
  card,
  children,
}: {
  card: Extract<DiscoverSwipeCard, { kind: Exclude<DiscoverSwipeCard["kind"], "socio"> }>;
  children?: React.ReactNode;
}) {
  const post = card.post;
  const meta = MODE_META[post.mode];
  const Icon = meta.icon;
  const rows = safeMatchingDisplay(post.mode, post);
  const link = displayableUrl(post.hackathonUrl);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-3xl border border-white/[0.06] bg-card">
      {/* Type capsule — the first thing you read on every card in the deck. */}
      <div className="flex items-center justify-between px-5 pt-5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-accent-light">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {KIND_CAPSULE[card.kind]}
        </span>
        {post.peopleNeeded != null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-fg-muted">
            <Users className="h-3 w-3" aria-hidden />
            {post.peopleNeeded} needed
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5 pt-4">
        <h2 className="text-[21px] font-bold leading-tight">{post.title}</h2>

        {/* Author preview */}
        <div className="flex items-center gap-2.5">
          <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
            {post.authorAvatar && (
              <AppImage
                src={post.authorAvatar}
                alt={post.authorName ?? ""}
                sizes="32px"
                draggable={false}
              />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 truncate text-[13px] font-semibold">
              {post.authorName ?? "Student"}
              {post.authorVerified && <VerifiedBadge size={13} />}
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
          {post.authorAura > 0 && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/30 px-2 py-1">
              <Zap className="h-3 w-3 text-gold-text" aria-hidden />
              <span className="text-[11px] font-semibold text-gold-text">
                {post.authorAura.toLocaleString()}
              </span>
            </span>
          )}
        </div>

        {post.description && (
          <p className="line-clamp-3 text-[15px] leading-snug text-fg-muted">
            {post.description}
          </p>
        )}

        <ReasonChips reasons={card.reasons} />

        {/* Sports plans live or die on where and when. */}
        {(post.place || post.scheduledAt) && (
          <div className="flex flex-wrap gap-3 text-[13px] font-medium">
            {post.place && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-aura" aria-hidden />
                {post.place}
              </span>
            )}
            {post.scheduledAt && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 text-aura" aria-hidden />
                {formatWhen(post.scheduledAt)}
              </span>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <ul className="space-y-1 text-[13px] text-fg-muted">
            {rows.slice(0, 3).map((r) => (
              <li key={r.key}>{r.label}</li>
            ))}
          </ul>
        )}

        {post.teamMembers.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-fg-muted">Already on the team</span>
            <div className="flex">
              {post.teamMembers.slice(0, 5).map((m, i) => (
                <span
                  key={m.id}
                  className="relative h-6 w-6 overflow-hidden rounded-full bg-bg-elevated ring-2 ring-card"
                  style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 5 - i }}
                  title={m.username ? `@${m.username}` : undefined}
                >
                  {m.avatarUrl && (
                    <AppImage src={m.avatarUrl} alt="" sizes="24px" draggable={false} />
                  )}
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
            onPointerDownCapture={(e) => e.stopPropagation()}
            className="inline-flex w-fit items-center gap-1 text-xs font-medium text-aura"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Event page
          </a>
        )}

        <span className="flex-1" />

        {/* What a right swipe means here — never leave the gesture ambiguous. */}
        <p className="text-center text-[12px] font-semibold text-fg-disabled">
          {SWIPE_CTA[card.kind]}
        </p>
      </div>
      {children}
    </div>
  );
}

function ReasonChips({ reasons }: { reasons: MatchReason[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.slice(0, 3).map((r) => (
        <span
          key={r.key}
          className="rounded-full bg-aura/15 px-2.5 py-1 text-[11px] font-medium text-aura"
        >
          {r.label}
        </span>
      ))}
    </div>
  );
}
