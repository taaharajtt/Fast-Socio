"use client";

import {
  BookOpen,
  Building2,
  CalendarClock,
  Clock3,
  ExternalLink,
  GraduationCap,
  Handshake,
  MapPin,
  Sparkles,
  Tags,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { VerifiedBadge } from "@/components/ui";
import { MODE_META } from "@/lib/smart-match/modes";
import { safeMatchingDisplay, displayableUrl, formatWhen } from "@/lib/smart-match/display";
import { KIND_CAPSULE, SWIPE_CTA, type DiscoverSwipeCard } from "@/lib/discover/cards";
import type { DisplayRow, MatchReason } from "@/lib/smart-match/types";

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
  // "place"/"when" and "people" already have their own dedicated rows below
  // (the location/time strip and the top-right "N needed" pill) — dropping
  // them here avoids saying the same thing twice.
  const rows = safeMatchingDisplay(post.mode, post).filter(
    (r) => !["place", "when", "people"].includes(r.key)
  );
  const link = displayableUrl(post.hackathonUrl) ?? displayableUrl(post.portfolioUrl);

  return (
    <div className="relative h-full w-full rounded-3xl bg-gradient-to-br from-accent/70 via-aura/30 to-transparent p-[1.5px] shadow-[0_0_32px_-8px_rgba(124,58,237,0.35)]">
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[22px] bg-card">
        {/* Type capsule — the first thing you read on every card in the deck. */}
        <div className="flex items-center justify-between px-5 pt-5">
          <span className="gradient-brand inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[11px] font-bold uppercase tracking-wide text-white shadow-[0_2px_10px_-2px_rgba(124,58,237,0.6)]">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
              <Icon className="h-3 w-3" aria-hidden />
            </span>
            {KIND_CAPSULE[card.kind]}
          </span>
          {post.peopleNeeded != null && (
            <span className="gradient-cyan inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow-[0_2px_10px_-2px_rgba(59,130,246,0.5)]">
              <Users className="h-3 w-3" aria-hidden />
              {post.peopleNeeded} needed
            </span>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5 pt-4">
          <h2 className="text-[21px] font-bold leading-tight">{post.title}</h2>

          {/* Author preview */}
          <div className="flex items-center gap-2.5">
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-bg-elevated ring-2 ring-white/10">
              {post.authorAvatar && (
                <AppImage
                  src={post.authorAvatar}
                  alt={post.authorName ?? ""}
                  sizes="36px"
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

          <MetaRows rows={rows} />

          {post.skillsNeeded.length > 0 && (
            <SkillChips
              caption={
                post.mode === "contributor" ? "Skills offered" : "Skills needed"
              }
              skills={post.skillsNeeded}
            />
          )}

          {post.teamMembers.length > 0 && (
            <TeamRow members={post.teamMembers} />
          )}

          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onPointerDownCapture={(e) => e.stopPropagation()}
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-aura"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {post.mode === "contributor" ? "Portfolio" : "Event page"}
            </a>
          )}

          <span className="flex-1" />

          {/* What a right swipe means here — never leave the gesture ambiguous. */}
          <p className="flex items-center justify-center gap-1.5 text-center text-[12px] font-semibold text-fg-disabled">
            <Sparkles className="h-3.5 w-3.5 text-aura/70" aria-hidden />
            {SWIPE_CTA[card.kind]}
          </p>
        </div>
        {children}
      </div>
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
          className="gradient-cyan rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
        >
          {r.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta rows: `safeMatchingDisplay` returns ready-to-read strings like
// "Course: CS-302" or "3 on the team · needs 1 more" — this maps each row's
// key to an icon + short caption and, where the label already carries a
// "Caption: " prefix, strips it so the caption isn't repeated as the value.
// ---------------------------------------------------------------------------
const ROW_META: Record<string, { icon: LucideIcon; caption: string }> = {
  course: { icon: BookOpen, caption: "Course" },
  team: { icon: Users, caption: "Team status" },
  skills: { icon: Tags, caption: "Skills" },
  roles: { icon: Tags, caption: "Roles" },
  meet: { icon: Handshake, caption: "Meeting" },
  domain: { icon: Sparkles, caption: "Domain" },
  commit: { icon: Handshake, caption: "Commitment" },
  degree: { icon: GraduationCap, caption: "Degree" },
  hack: { icon: Sparkles, caption: "Hackathon" },
  deadline: { icon: CalendarClock, caption: "Deadline" },
  level: { icon: Sparkles, caption: "Skill level" },
  society: { icon: Building2, caption: "Society" },
  event: { icon: Building2, caption: "Event" },
  avail: { icon: Clock3, caption: "Availability" },
  interests: { icon: Sparkles, caption: "Interests" },
};

function rowValue(row: DisplayRow, caption: string): string {
  const prefix = new RegExp(`^${caption.split(" ")[0]}[a-z]*:\\s*`, "i");
  const stripped = row.label.replace(prefix, "");
  return stripped || row.label;
}

function MetaRows({ rows }: { rows: DisplayRow[] }) {
  // "skills"/"roles" already get their own chip row below when they carry the
  // needed/offered skills; recruitment's "roles" meta stays here since there
  // is no dedicated roles-chip row.
  const filtered = rows.filter((r) => r.key !== "skills");
  if (filtered.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
      {filtered.slice(0, 4).map((r) => {
        const meta = ROW_META[r.key] ?? { icon: Sparkles, caption: r.key };
        const Icon = meta.icon;
        return (
          <div key={r.key} className="flex items-start gap-2">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-fg-muted">
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                {meta.caption}
              </span>
              <span className="block truncate text-[13px] font-medium text-fg">
                {rowValue(r, meta.caption)}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SkillChips({ caption, skills }: { caption: string; skills: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
        {caption}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {skills.slice(0, 6).map((s) => (
          <span
            key={s}
            className="rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[12px] font-medium text-fg"
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function TeamRow({
  members,
}: {
  members: Array<{
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
  }>;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
        Already on the team
      </p>
      <div className="flex gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {members.slice(0, 5).map((m) => (
          <div key={m.id} className="flex w-12 shrink-0 flex-col items-center gap-1">
            <span className="relative h-10 w-10 overflow-hidden rounded-full bg-bg-elevated ring-2 ring-white/10">
              {m.avatarUrl && (
                <AppImage src={m.avatarUrl} alt="" sizes="40px" draggable={false} />
              )}
            </span>
            <span className="max-w-full truncate text-[10px] text-fg-muted">
              {m.fullName?.split(" ")[0] ?? (m.username ? `@${m.username}` : "Student")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
