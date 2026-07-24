import type { DiscoverProfile } from "@/lib/profile/types";
import { scorePost } from "@/lib/smart-match/score";
import type {
  MatchReason,
  SmartMatchPost,
  SmartMatchViewer,
} from "@/lib/smart-match/types";

// ===========================================================================
// Discover is ONE swipe deck.
//
// There are no tabs, no filter chips and no browsable list: a person card and
// an opportunity card are the same kind of object — something you swipe right
// to act on, or left to dismiss. This module is the pure half of that: the card
// union every surface renders, the ranking, and the interleave that keeps SOCIO
// prominent while opportunities surface between people.
//
// Pure + deterministic (`now` is injected) so ordering, exclusions and CTA copy
// are all unit-testable, and it can only ever shape data the caller already
// fetched through a DB-gated read.
// ===========================================================================

/** The five things a student can post. SOCIO is not posted — it IS you. */
export const INTENT_KINDS = [
  "project_partner",
  "hackathon_team",
  "sports",
  "recruitment",
  "fyp_teammate",
] as const;

export type IntentKind = (typeof INTENT_KINDS)[number];

export type SwipeCardKind = "socio" | IntentKind;

export function isIntentKind(x: unknown): x is IntentKind {
  return typeof x === "string" && (INTENT_KINDS as readonly string[]).includes(x);
}

export type DiscoverSwipeCard =
  | {
      kind: "socio";
      /** Stable dedupe/react key across top-ups. */
      key: string;
      id: string;
      score: number;
      profile: DiscoverProfile;
    }
  | {
      kind: IntentKind;
      key: string;
      id: string;
      score: number;
      reasons: MatchReason[];
      post: SmartMatchPost;
    };

/** Short type capsule shown at the top of every card. */
export const KIND_CAPSULE: Record<SwipeCardKind, string> = {
  socio: "SOCIO",
  project_partner: "Project Partner",
  hackathon_team: "Hackathon",
  sports: "Sports",
  recruitment: "Recruitment",
  fyp_teammate: "FYP",
};

/**
 * What a right swipe MEANS on this card, in the card's own words. The deck
 * shows it so the gesture is never ambiguous — you always know whether you're
 * liking a person or applying to a thing.
 */
export const SWIPE_CTA: Record<SwipeCardKind, string> = {
  socio: "Swipe right to connect",
  project_partner: "Swipe right to request",
  hackathon_team: "Swipe right to join",
  sports: "Swipe right to play",
  recruitment: "Swipe right to apply",
  fyp_teammate: "Swipe right to discuss",
};

/** Past-tense confirmation after a right swipe. */
export const SWIPE_CONFIRMATION: Record<IntentKind, string> = {
  project_partner: "Request sent",
  hackathon_team: "Request sent",
  sports: "You're in — the host will confirm",
  recruitment: "Application sent",
  fyp_teammate: "Request sent",
};

/**
 * SOCIO leads, opportunities punctuate: every third slot goes to the best
 * remaining intent card. Two of every three cards stay people, so the deck
 * still reads as the founder's original experience with campus opportunities
 * woven through it rather than bolted beside it.
 */
export const INTENT_EVERY_NTH = 3;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** True when a post has aged out — belt-and-braces over the RPC's own filter. */
export function isExpired(post: SmartMatchPost, now: number): boolean {
  return post.expiresAt != null && new Date(post.expiresAt).getTime() <= now;
}

/**
 * True when an intent post has no business being in the deck: you already
 * responded, it's your own, or it has aged out. (Closed/blocked/banned are
 * already excluded by the feed RPC; re-checking expiry here keeps a long-lived
 * client honest.)
 */
export function isDeckEligible(
  post: SmartMatchPost,
  viewerId: string | null,
  now: number
): boolean {
  if (post.authorId === viewerId) return false;
  if (isExpired(post, now)) return false;
  if (post.myApplicationStatus === "pending" || post.myApplicationStatus === "accepted")
    return false;
  return isIntentKind(post.mode);
}

/**
 * Score one SOCIO candidate on the same 0–100 scale as an intent post, so a
 * single comparison can order the deck. `compatibility` is the deterministic
 * score the candidates RPC already computed; without it we fall back to
 * shared-interest overlap.
 */
export function scoreSocioCandidate(
  viewer: SmartMatchViewer,
  profile: DiscoverProfile
): number {
  const shared =
    profile.shared_interests?.length
      ? profile.shared_interests
      : profile.interests.filter((i) =>
          viewer.interests.some((v) => norm(v) === norm(i))
        );
  const base =
    typeof profile.compatibility === "number"
      ? profile.compatibility
      : 40 + Math.min(shared.length, 4) * 8;
  return Math.max(0, Math.min(100, Math.round(base)));
}

/**
 * Build the deck: rank each side independently, then interleave. Returns cards
 * in the exact order they will be swiped.
 */
export function buildSwipeDeck({
  socio,
  posts,
  viewer,
  viewerId = null,
  now = Date.now(),
}: {
  socio: DiscoverProfile[];
  posts: SmartMatchPost[];
  viewer: SmartMatchViewer;
  viewerId?: string | null;
  now?: number;
}): DiscoverSwipeCard[] {
  // SOCIO keeps the order get_discover_candidates gave it — that RPC already
  // encodes the founder's ranking (fresh first, passed people recycled last).
  const people: DiscoverSwipeCard[] = socio.map((profile) => ({
    kind: "socio",
    key: `socio:${profile.id}`,
    id: profile.id,
    score: scoreSocioCandidate(viewer, profile),
    profile,
  }));

  const intents: DiscoverSwipeCard[] = posts
    .filter((post) => isDeckEligible(post, viewerId, now))
    .map((post) => {
      const { score, reasons } = scorePost(post.mode, viewer, post, now);
      return {
        kind: post.mode as IntentKind,
        key: `intent:${post.id}`,
        id: post.id,
        score,
        reasons,
        post,
      };
    })
    // Best-fitting opportunity first; `key` breaks ties so the deck is stable
    // across re-renders and top-ups.
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  return interleave(people, intents);
}

/** SOCIO-led interleave: an intent lands in every INTENT_EVERY_NTH slot. */
export function interleave(
  people: DiscoverSwipeCard[],
  intents: DiscoverSwipeCard[]
): DiscoverSwipeCard[] {
  const out: DiscoverSwipeCard[] = [];
  let p = 0;
  let i = 0;
  while (p < people.length || i < intents.length) {
    const slotWantsIntent = (out.length + 1) % INTENT_EVERY_NTH === 0;
    if (slotWantsIntent && i < intents.length) out.push(intents[i++]);
    else if (p < people.length) out.push(people[p++]);
    else if (i < intents.length) out.push(intents[i++]);
  }
  return out;
}

/** Privacy-safe one-line meta for an intent card, by kind. */
export function intentSubtitle(card: DiscoverSwipeCard): string {
  if (card.kind === "socio") return "";
  const p = card.post;
  const parts: string[] = [];
  switch (card.kind) {
    case "project_partner":
      if (p.courseCode) parts.push(p.courseCode);
      if (p.peopleNeeded != null) parts.push(`needs ${p.peopleNeeded} more`);
      break;
    case "hackathon_team":
      if (p.hackathonName) parts.push(p.hackathonName);
      if (p.peopleNeeded != null) parts.push(`needs ${p.peopleNeeded} more`);
      break;
    case "sports":
      if (p.place) parts.push(p.place);
      if (p.peopleNeeded != null) parts.push(`needs ${p.peopleNeeded}`);
      break;
    case "recruitment":
      if (p.societyName) parts.push(p.societyName);
      else if (p.eventTitle) parts.push(p.eventTitle);
      if (p.rolesNeeded.length) parts.push(p.rolesNeeded.slice(0, 2).join(", "));
      break;
    case "fyp_teammate":
      if (p.interests.length) parts.push(p.interests.slice(0, 2).join(", "));
      if (p.degree) parts.push(p.degree);
      break;
  }
  return parts.join(" · ");
}
