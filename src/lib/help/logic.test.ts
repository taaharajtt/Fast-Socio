import { describe, expect, it } from "vitest";
import {
  isHelpCategory,
  isHelpUrgency,
  normalizeUrgency,
  urgencyFromToggle,
  isUrgentRequest,
  urgencyRank,
  compareSocio,
  groupMyRequests,
  canTransition,
  canEditRequest,
  canResolve,
  canReopen,
  canSelectHelper,
  canRespond,
  canDeleteResponse,
  isHelpOfferStatus,
  canActOnOffer,
  offerUnlockedChat,
  canTransitionOffer,
  shouldMaskAuthor,
  resolveHelpAuthor,
  type HelpUrgency,
  type HelpStatus,
} from "./logic";

describe("category / urgency validation", () => {
  it("accepts only the six known categories", () => {
    expect(isHelpCategory("academic")).toBe(true);
    expect(isHelpCategory("advice")).toBe(true);
    expect(isHelpCategory("help")).toBe(true);
    expect(isHelpCategory("sports")).toBe(true);
    expect(isHelpCategory("events")).toBe(true);
    expect(isHelpCategory("lost_found")).toBe(true);
    // Retired phase-1 categories are no longer valid.
    expect(isHelpCategory("notes")).toBe(false);
    expect(isHelpCategory("campus_question")).toBe(false);
    expect(isHelpCategory("")).toBe(false);
    expect(isHelpCategory(42)).toBe(false);
  });

  it("validates and normalizes urgency", () => {
    expect(isHelpUrgency("urgent")).toBe(true);
    expect(isHelpUrgency("panic")).toBe(false);
    expect(normalizeUrgency("low")).toBe("low");
    expect(normalizeUrgency("nonsense")).toBe("normal");
    expect(normalizeUrgency(undefined)).toBe("normal");
  });

  it("maps the single urgent toggle onto the text column", () => {
    expect(urgencyFromToggle(true)).toBe("urgent");
    expect(urgencyFromToggle(false)).toBe("normal");
    expect(isUrgentRequest("urgent")).toBe(true);
    expect(isUrgentRequest("normal")).toBe(false);
    expect(isUrgentRequest("low")).toBe(false);
  });

  it("ranks urgent ahead of normal ahead of low", () => {
    expect(urgencyRank("urgent")).toBeLessThan(urgencyRank("normal"));
    expect(urgencyRank("normal")).toBeLessThan(urgencyRank("low"));
  });
});

describe("SOCIO feed ordering", () => {
  const mk = (urgency: HelpUrgency, created_at: string) => ({ urgency, created_at });

  it("floats urgent above non-urgent regardless of age", () => {
    const older_urgent = mk("urgent", "2026-01-01T00:00:00Z");
    const newer_normal = mk("normal", "2026-06-01T00:00:00Z");
    expect(compareSocio(older_urgent, newer_normal)).toBeLessThan(0);
  });

  it("breaks ties by most-recent first", () => {
    const newer = mk("normal", "2026-06-02T00:00:00Z");
    const older = mk("normal", "2026-06-01T00:00:00Z");
    expect(compareSocio(newer, older)).toBeLessThan(0);
    expect(compareSocio(older, newer)).toBeGreaterThan(0);
  });

  it("sorts a mixed list urgent-first then newest", () => {
    const rows = [
      mk("normal", "2026-06-01T00:00:00Z"),
      mk("urgent", "2026-05-01T00:00:00Z"),
      mk("normal", "2026-06-03T00:00:00Z"),
      mk("urgent", "2026-05-05T00:00:00Z"),
    ];
    const sorted = [...rows].sort(compareSocio).map((r) => `${r.urgency}@${r.created_at.slice(5, 10)}`);
    expect(sorted).toEqual([
      "urgent@05-05",
      "urgent@05-01",
      "normal@06-03",
      "normal@06-01",
    ]);
  });
});

describe("ME grouping", () => {
  const mk = (status: HelpStatus, response_count: number) => ({ status, response_count });

  it("splits into active, active-with-responses, and resolved", () => {
    const rows = [
      mk("open", 0),
      mk("open", 3),
      mk("resolved", 5),
      mk("open", 1),
    ];
    const g = groupMyRequests(rows);
    expect(g.active).toHaveLength(3);
    expect(g.withResponses).toHaveLength(2);
    expect(g.resolved).toHaveLength(1);
  });

  it("withResponses is a subset of active (never counts resolved)", () => {
    const rows = [mk("resolved", 9), mk("open", 0)];
    const g = groupMyRequests(rows);
    expect(g.withResponses).toHaveLength(0);
  });
});

describe("status transitions", () => {
  it("allows open<->resolved but nothing else", () => {
    expect(canTransition("open", "resolved")).toBe(true);
    expect(canTransition("resolved", "open")).toBe(true);
    expect(canTransition("open", "open")).toBe(false);
    expect(canTransition("resolved", "resolved")).toBe(false);
  });
});

describe("offer-approval lifecycle", () => {
  it("validates offer status", () => {
    expect(isHelpOfferStatus("pending")).toBe(true);
    expect(isHelpOfferStatus("accepted")).toBe(true);
    expect(isHelpOfferStatus("declined")).toBe(true);
    expect(isHelpOfferStatus("approved")).toBe(false);
  });

  it("only a pending offer can be acted on", () => {
    expect(canActOnOffer("pending")).toBe(true);
    expect(canActOnOffer("accepted")).toBe(false);
    expect(canActOnOffer("declined")).toBe(false);
  });

  it("an accepted offer has unlocked a chat", () => {
    expect(offerUnlockedChat("accepted")).toBe(true);
    expect(offerUnlockedChat("pending")).toBe(false);
    expect(offerUnlockedChat("declined")).toBe(false);
  });

  it("allows pending→accepted|declined and nothing else", () => {
    expect(canTransitionOffer("pending", "accepted")).toBe(true);
    expect(canTransitionOffer("pending", "declined")).toBe(true);
    expect(canTransitionOffer("accepted", "declined")).toBe(false);
    expect(canTransitionOffer("declined", "accepted")).toBe(false);
    expect(canTransitionOffer("accepted", "accepted")).toBe(false);
  });
});

describe("permission decisions", () => {
  const owner = { isOwner: true, isAdmin: false };
  const admin = { isOwner: false, isAdmin: true };
  const stranger = { isOwner: false, isAdmin: false };

  it("only the owner edits, and only while open", () => {
    expect(canEditRequest("open", owner)).toBe(true);
    expect(canEditRequest("resolved", owner)).toBe(false);
    expect(canEditRequest("open", admin)).toBe(false);
    expect(canEditRequest("open", stranger)).toBe(false);
  });

  it("owner or admin resolves an open request", () => {
    expect(canResolve("open", owner)).toBe(true);
    expect(canResolve("open", admin)).toBe(true);
    expect(canResolve("resolved", owner)).toBe(false);
    expect(canResolve("open", stranger)).toBe(false);
  });

  it("owner or admin reopens a resolved request", () => {
    expect(canReopen("resolved", owner)).toBe(true);
    expect(canReopen("resolved", admin)).toBe(true);
    expect(canReopen("open", owner)).toBe(false);
    expect(canReopen("resolved", stranger)).toBe(false);
  });

  it("only owner/admin selects a helper", () => {
    expect(canSelectHelper(owner)).toBe(true);
    expect(canSelectHelper(admin)).toBe(true);
    expect(canSelectHelper(stranger)).toBe(false);
  });

  it("a non-author signed-in student responds only to open requests", () => {
    expect(canRespond("open", { signedIn: true, isAuthor: false })).toBe(true);
    expect(canRespond("open", { signedIn: true, isAuthor: true })).toBe(false);
    expect(canRespond("resolved", { signedIn: true, isAuthor: false })).toBe(false);
    expect(canRespond("open", { signedIn: false, isAuthor: false })).toBe(false);
  });

  it("a response author deletes their own response unless selected", () => {
    expect(canDeleteResponse({ isResponseAuthor: true, isAdmin: false }, false)).toBe(true);
    expect(canDeleteResponse({ isResponseAuthor: true, isAdmin: false }, true)).toBe(false);
    expect(canDeleteResponse({ isResponseAuthor: false, isAdmin: false }, false)).toBe(false);
    // admins can remove even a selected response
    expect(canDeleteResponse({ isResponseAuthor: false, isAdmin: true }, true)).toBe(true);
  });
});

describe("anonymous display behavior", () => {
  it("masks only when anonymous and viewer is neither owner nor admin", () => {
    expect(shouldMaskAuthor(true, { isOwner: false, isAdmin: false })).toBe(true);
    expect(shouldMaskAuthor(true, { isOwner: true, isAdmin: false })).toBe(false);
    expect(shouldMaskAuthor(true, { isOwner: false, isAdmin: true })).toBe(false);
    expect(shouldMaskAuthor(false, { isOwner: false, isAdmin: false })).toBe(false);
  });

  it("renders Anonymous when the DB masked the fields to null", () => {
    const d = resolveHelpAuthor({
      isAnonymous: true,
      authorId: null,
      authorName: null,
      authorUsername: null,
      authorAvatarUrl: null,
    });
    expect(d.anonymous).toBe(true);
    expect(d.name).toBe("Anonymous");
    expect(d.href).toBeNull();
    expect(d.avatarUrl).toBeNull();
  });

  it("renders the real author (with a profile link) when visible", () => {
    const d = resolveHelpAuthor({
      isAnonymous: false,
      authorId: "abc",
      authorName: "Ayesha Khan",
      authorUsername: "i221234",
      authorAvatarUrl: "https://example.test/a.png",
    });
    expect(d.anonymous).toBe(false);
    expect(d.name).toBe("Ayesha Khan");
    expect(d.username).toBe("i221234");
    expect(d.href).toBe("/profile/abc");
  });

  it("owner viewing their OWN anonymous request sees themselves (not masked)", () => {
    const d = resolveHelpAuthor({
      isAnonymous: true,
      authorId: "me",
      authorName: "My Name",
      authorUsername: "i220001",
      authorAvatarUrl: null,
    });
    expect(d.anonymous).toBe(false);
    expect(d.name).toBe("My Name");
    expect(d.href).toBe("/profile/me");
  });
});
