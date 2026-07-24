import { describe, it, expect } from "vitest";
import {
  INTENT_KINDS,
  INTENT_EVERY_NTH,
  KIND_CAPSULE,
  SWIPE_CTA,
  SWIPE_CONFIRMATION,
  buildSwipeDeck,
  interleave,
  intentSubtitle,
  isDeckEligible,
  isExpired,
  isIntentKind,
  scoreSocioCandidate,
  type DiscoverSwipeCard,
} from "@/lib/discover/cards";
import type { PostMode } from "@/lib/smart-match/modes";
import type { DiscoverProfile } from "@/lib/profile/types";
import type { SmartMatchPost, SmartMatchViewer } from "@/lib/smart-match/types";

const NOW = new Date("2026-07-24T12:00:00Z").getTime();
const ME = "me-1";

const viewer: SmartMatchViewer = {
  department: "Computer Science",
  semester: 5,
  graduationYear: 2027,
  interests: ["nlp", "startups"],
  skills: ["react", "supabase"],
};

function makePost(mode: PostMode, over: Partial<SmartMatchPost> = {}): SmartMatchPost {
  return {
    id: `${mode}-1`,
    mode,
    authorId: "a1",
    authorName: "Aisha",
    authorAvatar: null,
    authorUsername: "i221234",
    authorDepartment: "Computer Science",
    authorSemester: 5,
    authorGraduationYear: 2027,
    authorVerified: false,
    authorAura: 100,
    title: "Need a 4th",
    description: null,
    courseCode: null,
    degree: null,
    semester: null,
    peopleNeeded: null,
    skillsNeeded: [],
    interests: [],
    rolesNeeded: [],
    place: null,
    scheduledAt: null,
    hackathonName: null,
    hackathonUrl: null,
    meetingPreference: null,
    preferredCommitment: null,
    skillLevel: null,
    availability: null,
    portfolioUrl: null,
    deadline: null,
    expiresAt: null,
    societyId: null,
    societyName: null,
    eventId: null,
    eventTitle: null,
    teamMembers: [],
    teamMemberCount: 0,
    mutualCommunities: 0,
    applicationCount: 0,
    myApplicationStatus: null,
    myApplicationId: null,
    createdAt: new Date(NOW - 3600_000).toISOString(),
    ...over,
  };
}

function makeProfile(over: Partial<DiscoverProfile> = {}): DiscoverProfile {
  return {
    id: "s1",
    full_name: "Bilal",
    department: "Computer Science",
    semester: 5,
    bio: null,
    avatar_url: null,
    aura_score: 50,
    interests: ["nlp"],
    ...over,
  };
}

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => makeProfile({ id: `p${i}` }));

// ---------------------------------------------------------------------------
// The card model itself
// ---------------------------------------------------------------------------
describe("swipe card kinds", () => {
  it("offers exactly the five postable intents — SOCIO is not one of them", () => {
    expect(INTENT_KINDS).toEqual([
      "project_partner",
      "hackathon_team",
      "sports",
      "recruitment",
      "fyp_teammate",
    ]);
    expect(isIntentKind("socio")).toBe(false);
    expect(isIntentKind("contributor")).toBe(false);
    expect(isIntentKind("sports")).toBe(true);
  });

  it("gives every card kind a capsule and a swipe-right meaning", () => {
    for (const kind of ["socio", ...INTENT_KINDS] as const) {
      expect(KIND_CAPSULE[kind]).toBeTruthy();
      expect(SWIPE_CTA[kind]).toMatch(/^Swipe right to /);
    }
    // Each intent kind says what a right swipe DID, not just what it will do.
    for (const kind of INTENT_KINDS) expect(SWIPE_CONFIRMATION[kind]).toBeTruthy();
  });

  it("phrases the right swipe per kind, never generically", () => {
    expect(SWIPE_CTA.sports).toBe("Swipe right to play");
    expect(SWIPE_CTA.recruitment).toBe("Swipe right to apply");
    expect(SWIPE_CTA.fyp_teammate).toBe("Swipe right to discuss");
    expect(SWIPE_CTA.socio).toBe("Swipe right to connect");
  });
});

// ---------------------------------------------------------------------------
// Deck eligibility
// ---------------------------------------------------------------------------
describe("isDeckEligible", () => {
  it("keeps a fresh, open, someone-else's intent", () => {
    expect(isDeckEligible(makePost("sports"), ME, NOW)).toBe(true);
  });

  it("hides your own posts from your own deck", () => {
    const mine = makePost("sports", { authorId: ME });
    expect(isDeckEligible(mine, ME, NOW)).toBe(false);
  });

  it("hides posts you already responded to", () => {
    for (const status of ["pending", "accepted"] as const) {
      const post = makePost("sports", { myApplicationStatus: status });
      expect(isDeckEligible(post, ME, NOW)).toBe(false);
    }
    // A declined/cancelled response may be re-sent, so the card comes back.
    expect(
      isDeckEligible(makePost("sports", { myApplicationStatus: "declined" }), ME, NOW)
    ).toBe(true);
  });

  it("hides expired posts", () => {
    const dead = makePost("sports", {
      expiresAt: new Date(NOW - 1000).toISOString(),
    });
    expect(isExpired(dead, NOW)).toBe(true);
    expect(isDeckEligible(dead, ME, NOW)).toBe(false);
  });

  it("hides kinds that are not swipeable intents", () => {
    expect(isDeckEligible(makePost("contributor"), ME, NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Deck building + interleave
// ---------------------------------------------------------------------------
describe("buildSwipeDeck", () => {
  it("returns ONE mixed list containing both SOCIO and intent cards", () => {
    const deck = buildSwipeDeck({
      socio: people(6),
      posts: INTENT_KINDS.map((k) => makePost(k, { id: `${k}-x` })),
      viewer,
      viewerId: ME,
      now: NOW,
    });
    const kinds = new Set(deck.map((c) => c.kind));
    expect(kinds.has("socio")).toBe(true);
    expect(deck.some((c) => c.kind !== "socio")).toBe(true);
    // Nothing is dropped: 6 people + 5 intents.
    expect(deck).toHaveLength(11);
  });

  it("keeps SOCIO prominent — an intent lands only in every Nth slot", () => {
    const deck = buildSwipeDeck({
      socio: people(6),
      posts: INTENT_KINDS.map((k) => makePost(k, { id: `${k}-x` })),
      viewer,
      viewerId: ME,
      now: NOW,
    });
    // Slots 3, 6, 9 (1-indexed) are the intent slots.
    expect(deck[0].kind).toBe("socio");
    expect(deck[1].kind).toBe("socio");
    expect(deck[INTENT_EVERY_NTH - 1].kind).not.toBe("socio");
  });

  it("ranks intents by fit, best first", () => {
    const weak = makePost("project_partner", { id: "weak" });
    const strong = makePost("project_partner", {
      id: "strong",
      skillsNeeded: ["react", "supabase"],
      peopleNeeded: 1,
    });
    const deck = buildSwipeDeck({
      socio: [],
      posts: [weak, strong],
      viewer,
      viewerId: ME,
      now: NOW,
    });
    expect(deck[0].key).toBe("intent:strong");
    expect(deck[0].score).toBeGreaterThan(deck[1].score);
  });

  it("excludes own, expired and already-responded intents from the deck", () => {
    const deck = buildSwipeDeck({
      socio: [],
      posts: [
        makePost("sports", { id: "mine", authorId: ME }),
        makePost("sports", {
          id: "gone",
          expiresAt: new Date(NOW - 1).toISOString(),
        }),
        makePost("sports", { id: "done", myApplicationStatus: "pending" }),
        makePost("sports", { id: "live" }),
      ],
      viewer,
      viewerId: ME,
      now: NOW,
    });
    expect(deck.map((c) => c.key)).toEqual(["intent:live"]);
  });

  it("degrades to a pure SOCIO deck when nobody has posted an intent", () => {
    const deck = buildSwipeDeck({
      socio: people(4),
      posts: [],
      viewer,
      viewerId: ME,
      now: NOW,
    });
    expect(deck).toHaveLength(4);
    expect(deck.every((c) => c.kind === "socio")).toBe(true);
  });

  it("preserves the SOCIO RPC's own ordering", () => {
    const deck = buildSwipeDeck({
      socio: [makeProfile({ id: "first" }), makeProfile({ id: "second" })],
      posts: [],
      viewer,
      viewerId: ME,
      now: NOW,
    });
    expect(deck.map((c) => c.id)).toEqual(["first", "second"]);
  });

  it("is stable: the same inputs always produce the same order", () => {
    const args = {
      socio: people(5),
      posts: [makePost("sports", { id: "aaa" }), makePost("sports", { id: "bbb" })],
      viewer,
      viewerId: ME,
      now: NOW,
    };
    expect(buildSwipeDeck(args).map((c) => c.key)).toEqual(
      buildSwipeDeck(args).map((c) => c.key)
    );
  });
});

describe("interleave", () => {
  const socioCard = (i: number): DiscoverSwipeCard => ({
    kind: "socio",
    key: `socio:${i}`,
    id: `${i}`,
    score: 50,
    profile: makeProfile({ id: `${i}` }),
  });
  const intentCard = (i: number): DiscoverSwipeCard => ({
    kind: "sports",
    key: `intent:${i}`,
    id: `${i}`,
    score: 50,
    reasons: [],
    post: makePost("sports", { id: `${i}` }),
  });

  it("puts an intent in every Nth slot", () => {
    const out = interleave([0, 1, 2, 3].map(socioCard), [9, 8].map(intentCard));
    expect(out.map((c) => c.kind)).toEqual([
      "socio",
      "socio",
      "sports",
      "socio",
      "socio",
      "sports",
    ]);
  });

  it("drains whichever side is left over, losing nothing", () => {
    expect(interleave([socioCard(1)], [])).toHaveLength(1);
    expect(interleave([], [intentCard(1), intentCard(2)])).toHaveLength(2);
    expect(interleave([socioCard(1)], [intentCard(2)])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// SOCIO scoring + subtitles
// ---------------------------------------------------------------------------
describe("scoreSocioCandidate", () => {
  it("uses the RPC compatibility score when present", () => {
    expect(scoreSocioCandidate(viewer, makeProfile({ compatibility: 90 }))).toBe(90);
    expect(scoreSocioCandidate(viewer, makeProfile({ compatibility: 20 }))).toBe(20);
  });

  it("falls back to shared-interest overlap", () => {
    const shared = scoreSocioCandidate(viewer, makeProfile({ interests: ["nlp"] }));
    const none = scoreSocioCandidate(viewer, makeProfile({ interests: ["chess"] }));
    expect(shared).toBeGreaterThan(none);
  });

  it("stays within 0..100", () => {
    const s = scoreSocioCandidate(viewer, makeProfile({ compatibility: 999 }));
    expect(s).toBeLessThanOrEqual(100);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe("intentSubtitle", () => {
  function card(mode: PostMode, over: Partial<SmartMatchPost>): DiscoverSwipeCard {
    const post = makePost(mode, over);
    return {
      kind: mode as (typeof INTENT_KINDS)[number],
      key: `intent:${post.id}`,
      id: post.id,
      score: 50,
      reasons: [],
      post,
    };
  }

  it("leads with what matters for each kind", () => {
    expect(intentSubtitle(card("sports", { place: "Main ground", peopleNeeded: 3 }))).toBe(
      "Main ground · needs 3"
    );
    expect(
      intentSubtitle(card("hackathon_team", { hackathonName: "NaSCon", peopleNeeded: 1 }))
    ).toBe("NaSCon · needs 1 more");
    expect(
      intentSubtitle(card("recruitment", { societyName: "ACM", rolesNeeded: ["decor"] }))
    ).toBe("ACM · decor");
  });

  it("never leaks the author's identity", () => {
    const s = intentSubtitle(
      card("project_partner", { courseCode: "CS-302", authorName: "Aisha" })
    );
    expect(s.toLowerCase()).not.toContain("aisha");
  });
});
