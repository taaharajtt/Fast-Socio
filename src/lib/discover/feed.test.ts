import { describe, it, expect } from "vitest";
import {
  DISCOVER_FILTERS,
  DEFAULT_DISCOVER_FILTER,
  FILTER_META,
  filterKinds,
  filterPostModes,
  filterIncludesSocio,
  isDiscoverFilter,
  matchesFilter,
} from "@/lib/discover/filters";
import {
  buildDiscoverFeed,
  isExpired,
  scoreSocioCandidate,
  SOCIO_CARDS_IN_MIXED_FEED,
} from "@/lib/discover/feed";
import { POST_MODES, type PostMode } from "@/lib/smart-match/modes";
import type { DiscoverProfile } from "@/lib/profile/types";
import type { SmartMatchPost, SmartMatchViewer } from "@/lib/smart-match/types";

const NOW = new Date("2026-07-24T12:00:00Z").getTime();

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

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
describe("discover filters", () => {
  it("defaults to For You, which admits every kind", () => {
    expect(DEFAULT_DISCOVER_FILTER).toBe("for_you");
    expect(DISCOVER_FILTERS[0]).toBe("for_you");
    expect(filterKinds("for_you")).toEqual(["socio", ...POST_MODES]);
    expect(filterIncludesSocio("for_you")).toBe(true);
  });

  it("maps each chip to exactly the kinds it admits", () => {
    expect(filterKinds("teams")).toEqual(["project_partner"]);
    expect(filterKinds("fyp")).toEqual(["fyp_teammate"]);
    expect(filterKinds("hackathons")).toEqual(["hackathon_team"]);
    expect(filterKinds("sports")).toEqual(["sports"]);
    expect(filterKinds("recruitment")).toEqual(["recruitment"]);
    expect(filterKinds("contributors")).toEqual(["contributor"]);
    expect(filterKinds("socio")).toEqual(["socio"]);
  });

  it("strips SOCIO out of the RPC's post-mode argument", () => {
    expect(filterPostModes("socio")).toEqual([]);
    expect(filterPostModes("for_you")).toEqual([...POST_MODES]);
    expect(filterPostModes("sports")).toEqual(["sports"]);
  });

  it("guards filter values and labels every chip", () => {
    expect(isDiscoverFilter("for_you")).toBe(true);
    expect(isDiscoverFilter("project_partner")).toBe(false);
    expect(isDiscoverFilter(null)).toBe(false);
    for (const f of DISCOVER_FILTERS) expect(FILTER_META[f].label).toBeTruthy();
  });

  it("matches a card kind against a chip", () => {
    expect(matchesFilter("teams", "project_partner")).toBe(true);
    expect(matchesFilter("teams", "sports")).toBe(false);
    expect(matchesFilter("for_you", "contributor")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Feed building
// ---------------------------------------------------------------------------
describe("buildDiscoverFeed", () => {
  const posts = POST_MODES.map((m) => makePost(m));

  it("mixes every kind into ONE list under For You", () => {
    const feed = buildDiscoverFeed({ filter: "for_you", viewer, posts, now: NOW });
    expect(feed).toHaveLength(POST_MODES.length);
    expect(new Set(feed.map((i) => i.kind)).size).toBe(POST_MODES.length);
  });

  it("narrows to one kind when a chip is active", () => {
    const feed = buildDiscoverFeed({ filter: "sports", viewer, posts, now: NOW });
    expect(feed.map((i) => i.kind)).toEqual(["sports"]);
  });

  it("orders by score, best first", () => {
    const weak = makePost("project_partner", { id: "weak" });
    const strong = makePost("project_partner", {
      id: "strong",
      skillsNeeded: ["react", "supabase"],
      peopleNeeded: 1,
    });
    const feed = buildDiscoverFeed({
      filter: "teams",
      viewer,
      posts: [weak, strong],
      now: NOW,
    });
    expect(feed[0].key).toBe("post:strong");
    expect(feed[0].score).toBeGreaterThan(feed[1].score);
  });

  it("drops expired posts", () => {
    const dead = makePost("sports", {
      id: "dead",
      expiresAt: new Date(NOW - 1000).toISOString(),
    });
    const live = makePost("sports", {
      id: "live",
      expiresAt: new Date(NOW + 86_400_000).toISOString(),
    });
    expect(isExpired(dead, NOW)).toBe(true);
    expect(isExpired(live, NOW)).toBe(false);
    const feed = buildDiscoverFeed({
      filter: "sports",
      viewer,
      posts: [dead, live],
      now: NOW,
    });
    expect(feed.map((i) => i.key)).toEqual(["post:live"]);
  });

  it("keeps posts you already responded to, but lower down", () => {
    const fresh = makePost("project_partner", { id: "fresh" });
    const applied = makePost("project_partner", {
      id: "applied",
      myApplicationStatus: "pending",
    });
    const feed = buildDiscoverFeed({
      filter: "teams",
      viewer,
      posts: [applied, fresh],
      now: NOW,
    });
    expect(feed.map((i) => i.key)).toEqual(["post:fresh", "post:applied"]);
  });

  it("caps SOCIO cards in a mixed feed but not on the SOCIO chip", () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeProfile({ id: `s${i}` })
    );
    const mixed = buildDiscoverFeed({
      filter: "for_you",
      viewer,
      posts,
      socioCandidates: candidates,
      now: NOW,
    });
    expect(mixed.filter((i) => i.type === "socio")).toHaveLength(
      SOCIO_CARDS_IN_MIXED_FEED
    );

    const socioOnly = buildDiscoverFeed({
      filter: "socio",
      viewer,
      posts,
      socioCandidates: candidates,
      now: NOW,
    });
    expect(socioOnly).toHaveLength(10);
    expect(socioOnly.every((i) => i.type === "socio")).toBe(true);
  });

  it("is stable: equal scores never reshuffle between builds", () => {
    const a = makePost("project_partner", { id: "aaa" });
    const b = makePost("project_partner", { id: "bbb" });
    const first = buildDiscoverFeed({ filter: "teams", viewer, posts: [a, b], now: NOW });
    const second = buildDiscoverFeed({ filter: "teams", viewer, posts: [b, a], now: NOW });
    expect(first.map((i) => i.key)).toEqual(second.map((i) => i.key));
  });
});

// ---------------------------------------------------------------------------
// SOCIO cards
// ---------------------------------------------------------------------------
describe("scoreSocioCandidate", () => {
  it("explains a match with safe chips only", () => {
    const { reasons } = scoreSocioCandidate(
      viewer,
      makeProfile({ shared_interests: ["nlp"] })
    );
    const keys = reasons.map((r) => r.key);
    expect(keys).toContain("interests");
    expect(keys).toContain("dept");
    expect(keys).toContain("sem");
    const blob = JSON.stringify(reasons).toLowerCase();
    expect(blob).not.toContain("gender");
    expect(blob).not.toContain("bilal");
  });

  it("uses the RPC compatibility score when present", () => {
    const high = scoreSocioCandidate(viewer, makeProfile({ compatibility: 90 }));
    const low = scoreSocioCandidate(viewer, makeProfile({ compatibility: 20 }));
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.score).toBeLessThanOrEqual(100);
    expect(low.score).toBeGreaterThanOrEqual(0);
  });

  it("falls back to interest overlap without a compatibility score", () => {
    const shared = scoreSocioCandidate(viewer, makeProfile({ interests: ["nlp"] }));
    const none = scoreSocioCandidate(viewer, makeProfile({ interests: ["chess"] }));
    expect(shared.score).toBeGreaterThan(none.score);
  });
});
