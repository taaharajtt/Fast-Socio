import type { DiscoverProfile } from "@/lib/profile/types";
import type { PostMode } from "@/lib/smart-match/modes";
import { scorePost } from "@/lib/smart-match/score";
import {
  matchesFilter,
  type DiscoverFilter,
} from "@/lib/discover/filters";
import type {
  MatchReason,
  SmartMatchPost,
  SmartMatchViewer,
} from "@/lib/smart-match/types";

// ===========================================================================
// The unified Discover feed, as a pure function.
//
// Discover is ONE list of mixed connection cards: opportunity posts (project,
// FYP, hackathon, sports, recruitment, contributor) and SOCIO profile cards
// from the founder's original swipe candidates. Everything is scored on the
// same 0–100 scale so a single sort produces a genuinely mixed, personalized
// feed rather than blocks of one kind.
//
// Pure + deterministic (`now` is injected) so ordering, filtering, expiry and
// reason chips are all unit-testable, and it can only ever surface data the
// caller already fetched through a DB-gated read.
// ===========================================================================

/** How many SOCIO profile cards may appear in a mixed ("For You") feed. */
export const SOCIO_CARDS_IN_MIXED_FEED = 4;

export type FeedItem =
  | {
      type: "post";
      kind: PostMode;
      key: string;
      score: number;
      reasons: MatchReason[];
      post: SmartMatchPost;
    }
  | {
      type: "socio";
      kind: "socio";
      key: string;
      score: number;
      reasons: MatchReason[];
      profile: DiscoverProfile;
    };

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Score one SOCIO candidate on the same scale as a post. `compatibility` is the
 * deterministic 0–100 the candidates RPC already computed; without it we fall
 * back to shared-interest overlap. Reasons stay privacy-safe — shared interests
 * and department only, never gender, never location.
 */
export function scoreSocioCandidate(
  viewer: SmartMatchViewer,
  profile: DiscoverProfile
): { score: number; reasons: MatchReason[] } {
  const shared =
    profile.shared_interests?.length
      ? profile.shared_interests
      : profile.interests.filter((i) =>
          viewer.interests.some((v) => norm(v) === norm(i))
        );

  const reasons: MatchReason[] = [];
  if (shared.length)
    reasons.push({
      key: "interests",
      label:
        shared.length === 1
          ? `Shared interest: ${shared[0]}`
          : `${shared.length} shared interests`,
    });
  if (
    viewer.department &&
    profile.department &&
    norm(viewer.department) === norm(profile.department)
  )
    reasons.push({ key: "dept", label: "Same department" });
  if (viewer.semester != null && profile.semester === viewer.semester)
    reasons.push({ key: "sem", label: "Same semester" });

  const base =
    typeof profile.compatibility === "number"
      ? profile.compatibility
      : 40 + Math.min(shared.length, 4) * 8;

  // Held a touch below an equally-strong opportunity post: SOCIO is a browse-
  // and-swipe experience, and the feed's job is opportunities first.
  const score = Math.max(0, Math.min(100, Math.round(base * 0.9)));
  return { score, reasons: reasons.slice(0, 4) };
}

/** True when a post has aged out (expired) — belt-and-braces over the RPC. */
export function isExpired(post: SmartMatchPost, now: number): boolean {
  return post.expiresAt != null && new Date(post.expiresAt).getTime() <= now;
}

/**
 * Build the ranked, filtered feed. Posts the RPC returned are already
 * eligibility-gated (blocks, bans, mutes, own posts); this drops anything
 * expired, applies the chip filter, scores every card, and interleaves.
 */
export function buildDiscoverFeed({
  filter,
  viewer,
  posts,
  socioCandidates = [],
  now = Date.now(),
}: {
  filter: DiscoverFilter;
  viewer: SmartMatchViewer;
  posts: SmartMatchPost[];
  socioCandidates?: DiscoverProfile[];
  now?: number;
}): FeedItem[] {
  const items: FeedItem[] = [];

  for (const post of posts) {
    if (!matchesFilter(filter, post.mode)) continue;
    if (isExpired(post, now)) continue;
    const { score, reasons } = scorePost(post.mode, viewer, post, now);
    items.push({
      type: "post",
      kind: post.mode,
      key: `post:${post.id}`,
      score,
      reasons,
      post,
    });
  }

  if (matchesFilter(filter, "socio")) {
    // In a mixed feed SOCIO is a garnish, not the meal; on the SOCIO filter it
    // is the whole list.
    const cap =
      filter === "socio" ? socioCandidates.length : SOCIO_CARDS_IN_MIXED_FEED;
    for (const profile of socioCandidates.slice(0, cap)) {
      const { score, reasons } = scoreSocioCandidate(viewer, profile);
      items.push({
        type: "socio",
        kind: "socio",
        key: `socio:${profile.id}`,
        score,
        reasons,
        profile,
      });
    }
  }

  // Stable ordering: score desc, then key so equal scores never reshuffle
  // between renders.
  return items.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
