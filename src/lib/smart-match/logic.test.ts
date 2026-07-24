import { describe, it, expect } from "vitest";
import {
  DISCOVER_MODES,
  POST_MODES,
  DISCOVER_KINDS,
  isDiscoverMode,
  isPostMode,
  modeLabel,
  modeUsesTeamMembers,
} from "@/lib/smart-match/modes";
import {
  buildPostPayload,
  validatePostInput,
  safeUrl,
  validatePeopleNeeded,
  validateScheduledAt,
  normalizeSkills,
  nextApplicationStatus,
  canTransition,
} from "@/lib/smart-match/validate";
import { scorePost } from "@/lib/smart-match/score";
import { safeMatchingDisplay, teamSummary } from "@/lib/smart-match/display";
import type { SmartMatchPost, SmartMatchViewer } from "@/lib/smart-match/types";
import type { PostMode } from "@/lib/smart-match/modes";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------
function makePost(mode: PostMode, over: Partial<SmartMatchPost> = {}): SmartMatchPost {
  return {
    id: "p1",
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
    recruitmentUrl: null,
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
    createdAt: new Date("2026-07-21T00:00:00Z").toISOString(),
    ...over,
  };
}

const viewer: SmartMatchViewer = {
  department: "Computer Science",
  semester: 5,
  graduationYear: 2027,
  interests: ["nlp", "startups"],
  skills: ["react", "supabase"],
  degree: null,
};

const NOW = new Date("2026-07-21T12:00:00Z").getTime();

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
describe("discover kinds", () => {
  it("keeps SOCIO as a first-class kind", () => {
    expect(DISCOVER_MODES[0]).toBe("socio");
    expect(DISCOVER_KINDS[0].mode).toBe("socio");
    expect(DISCOVER_KINDS[0].label).toBe("SOCIO");
    expect(modeLabel("socio")).toBe("SOCIO");
  });

  it("has exactly the six post kinds and drops the old ones", () => {
    expect(POST_MODES).toEqual([
      "project_partner",
      "fyp_teammate",
      "hackathon_team",
      "sports",
      "recruitment",
      "contributor",
    ]);
    for (const gone of ["date", "study", "event_buddy", "mentor", "commute"]) {
      expect(isPostMode(gone)).toBe(false);
      expect(isDiscoverMode(gone)).toBe(false);
    }
  });

  it("guards mode values", () => {
    expect(isDiscoverMode("socio")).toBe(true);
    expect(isDiscoverMode("recruitment")).toBe(true);
    expect(isDiscoverMode("nope")).toBe(false);
    expect(isPostMode("socio")).toBe(false);
  });

  it("Project, Hackathon, and FYP use team-member mentions", () => {
    expect(modeUsesTeamMembers("project_partner")).toBe(true);
    expect(modeUsesTeamMembers("hackathon_team")).toBe(true);
    expect(modeUsesTeamMembers("fyp_teammate")).toBe(true);
    expect(modeUsesTeamMembers("sports")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validation + payload
// ---------------------------------------------------------------------------
describe("payload building", () => {
  it("folds project fields onto the jsonb payload", () => {
    const payload = buildPostPayload("project_partner", {
      title: " Need a 4th ",
      course_code: "CS-302",
      team_members: ["ignored"],
      semester: "6",
      degree: "CS",
    });
    expect(payload.title).toBe("Need a 4th");
    expect(payload.course_code).toBe("CS-302");
    // 'mentions' fields never enter the payload.
    expect(payload.team_members).toBeUndefined();
    // Semester/degree are auto-bound from the profile, not a generic field
    // spec, so buildPostPayload folds them on as a project_partner special case.
    expect(payload.semester).toBe("6");
    expect(payload.degree).toBe("CS");
  });

  it("sanitizes hackathon_url to https-only", () => {
    expect(buildPostPayload("hackathon_team", { hackathon_url: "http://x.com" }).hackathon_url).toBeNull();
    expect(buildPostPayload("hackathon_team", { hackathon_url: "https://nascon.pk" }).hackathon_url).toBe(
      "https://nascon.pk/"
    );
  });

  it("carries the recruitment society/event anchor", () => {
    const p = buildPostPayload("recruitment", { title: "Volunteers", society_id: "soc-1" });
    expect(p.society_id).toBe("soc-1");
    expect(p.event_id).toBeNull();
  });
});

describe("required-field validation", () => {
  it("flags missing required project fields", () => {
    const r = validatePostInput("project_partner", { title: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("Course Name");
  });

  it("passes a complete project request", () => {
    const r = validatePostInput("project_partner", {
      title: "x",
      course_code: "CS-302",
    });
    expect(r.ok).toBe(true);
  });

  it("requires a society or event for recruitment", () => {
    const r = validatePostInput("recruitment", { title: "x", roles_needed: ["decor"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("Society or event");
    const ok = validatePostInput("recruitment", {
      title: "x",
      roles_needed: ["decor"],
      description: "Help us run the gala.",
      recruitment_url: "https://forms.google.com/x",
      people_needed: "5",
      deadline: "2026-08-01T00:00",
      society_id: "soc-1",
    });
    expect(ok.ok).toBe(true);
  });
});

describe("field validators", () => {
  it("accepts only https urls", () => {
    expect(safeUrl("https://devpost.com/x")).toBe("https://devpost.com/x");
    expect(safeUrl("http://devpost.com")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl("https://nohost")).toBeNull();
    expect(safeUrl("")).toBeNull();
  });

  it("bounds people_needed to 1..20", () => {
    expect(validatePeopleNeeded("1")).toEqual({ ok: true, value: 1 });
    expect(validatePeopleNeeded("")).toEqual({ ok: true, value: null });
    expect(validatePeopleNeeded("0").ok).toBe(false);
    expect(validatePeopleNeeded("21").ok).toBe(false);
    expect(validatePeopleNeeded("2.5").ok).toBe(false);
  });

  it("accepts empty or parseable scheduled_at", () => {
    expect(validateScheduledAt("")).toBe(true);
    expect(validateScheduledAt("2026-08-01T18:00")).toBe(true);
    expect(validateScheduledAt("not-a-date")).toBe(false);
  });

  it("normalizes skills: trim, dedupe (case-insensitive), cap", () => {
    expect(normalizeSkills("React, react , Node,")).toEqual(["React", "Node"]);
    expect(normalizeSkills(["a", "A", "b"])).toEqual(["a", "b"]);
    expect(normalizeSkills("x".repeat(0))).toEqual([]);
  });
});

describe("application status transitions", () => {
  it("only pending applications may change", () => {
    expect(nextApplicationStatus("pending", "accept")).toBe("accepted");
    expect(nextApplicationStatus("pending", "decline")).toBe("declined");
    expect(nextApplicationStatus("pending", "cancel")).toBe("cancelled");
    expect(nextApplicationStatus("accepted", "cancel")).toBeNull();
    expect(nextApplicationStatus("declined", "accept")).toBeNull();
    expect(canTransition("pending", "accept")).toBe(true);
    expect(canTransition("cancelled", "accept")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scoring + reasons
// ---------------------------------------------------------------------------
describe("scorePost", () => {
  it("rewards a skill the post needs with a safe reason chip", () => {
    const post = makePost("project_partner", { skillsNeeded: ["React", "Go"] });
    const { score, reasons } = scorePost("project_partner", viewer, post, NOW);
    expect(score).toBeGreaterThan(30);
    expect(reasons[0].key).toBe("skill");
    expect(reasons.some((r) => r.label.toLowerCase().includes("react"))).toBe(true);
  });

  it("leads FYP scoring with a shared domain and rewards same grad year", () => {
    const post = makePost("fyp_teammate", { interests: ["nlp", "vision"] });
    const { reasons } = scorePost("fyp_teammate", viewer, post, NOW);
    expect(reasons[0].key).toBe("domain");
    // Same graduating year should raise the score vs a different one.
    const otherYear = makePost("fyp_teammate", {
      interests: ["nlp", "vision"],
      authorGraduationYear: 2030,
    });
    expect(scorePost("fyp_teammate", viewer, post, NOW).score).toBeGreaterThan(
      scorePost("fyp_teammate", viewer, otherYear, NOW).score
    );
  });

  it("boosts a sports plan starting soon", () => {
    const soon = makePost("sports", {
      scheduledAt: new Date(NOW + 6 * 3600 * 1000).toISOString(),
    });
    const later = makePost("sports", {
      scheduledAt: new Date(NOW + 20 * 86400 * 1000).toISOString(),
    });
    expect(scorePost("sports", viewer, soon, NOW).score).toBeGreaterThan(
      scorePost("sports", viewer, later, NOW).score
    );
    expect(scorePost("sports", viewer, soon, NOW).reasons.some((r) => r.key === "when")).toBe(true);
  });

  it("pushes down posts you already applied to", () => {
    const fresh = makePost("project_partner", { skillsNeeded: ["react"] });
    const applied = makePost("project_partner", {
      skillsNeeded: ["react"],
      myApplicationStatus: "pending",
    });
    expect(scorePost("project_partner", viewer, applied, NOW).score).toBeLessThan(
      scorePost("project_partner", viewer, fresh, NOW).score
    );
  });

  it("flips the skill chip copy for a contributor card", () => {
    const post = makePost("contributor", { skillsNeeded: ["React"] });
    const { reasons } = scorePost("contributor", viewer, post, NOW);
    expect(reasons[0].key).toBe("skill");
    expect(reasons[0].label).toBe("Offers react");
    // A request card keeps the "they need it, you have it" framing.
    const req = makePost("project_partner", { skillsNeeded: ["React"] });
    expect(scorePost("project_partner", viewer, req, NOW).reasons[0].label).toContain(
      "need"
    );
  });

  it("recognizes a fillable role in hackathon + recruitment", () => {
    const hack = makePost("hackathon_team", { rolesNeeded: ["react", "pm"] });
    expect(scorePost("hackathon_team", viewer, hack, NOW).reasons[0].key).toBe("role");
    const rec = makePost("recruitment", { rolesNeeded: ["supabase"] });
    expect(scorePost("recruitment", viewer, rec, NOW).reasons[0].key).toBe("role");
  });

  it("clamps to 0..100 and caps reasons at 4", () => {
    const post = makePost("fyp_teammate", {
      skillsNeeded: ["react", "supabase"],
      interests: ["nlp", "startups"],
      peopleNeeded: 1,
      deadline: new Date(NOW + 2 * 86400 * 1000).toISOString(),
      authorVerified: true,
    });
    const { score, reasons } = scorePost("fyp_teammate", viewer, post, NOW);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(reasons.length).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
describe("safeMatchingDisplay", () => {
  it("summarizes team as 'N on the team · needs M more'", () => {
    const post = makePost("project_partner", { teamMemberCount: 3, peopleNeeded: 1 });
    expect(teamSummary(post)).toBe("4 on the team · needs 1 more");
  });

  it("never leaks author identity or sensitive fields into meta rows", () => {
    const post = makePost("recruitment", {
      societyName: "ACM",
      rolesNeeded: ["decor"],
      authorName: "Aisha",
    });
    const rows = safeMatchingDisplay("recruitment", post);
    const blob = JSON.stringify(rows).toLowerCase();
    expect(blob).not.toContain("aisha");
    expect(blob).not.toContain("gender");
    expect(rows.some((r) => r.label.includes("ACM"))).toBe(true);
  });

  it("reads a contributor card as an offer, never as a request", () => {
    const post = makePost("contributor", {
      title: "Photographer, free most evenings",
      skillsNeeded: ["photography"],
      rolesNeeded: ["media team"],
      availability: "weekends",
    });
    const rows = safeMatchingDisplay("contributor", post);
    const blob = JSON.stringify(rows).toLowerCase();
    expect(blob).toContain("photography");
    expect(blob).toContain("open to: media team");
    expect(blob).not.toContain("needs:");
  });

  it("shows the sport, place and time for a sports plan", () => {
    const post = makePost("sports", {
      title: "Football",
      place: "Main ground",
      scheduledAt: new Date("2026-07-22T18:00:00Z").toISOString(),
      skillLevel: "intermediate",
    });
    const rows = safeMatchingDisplay("sports", post);
    expect(rows.some((r) => r.label.includes("Main ground"))).toBe(true);
    expect(rows.some((r) => r.key === "when")).toBe(true);
    expect(rows.some((r) => r.label.toLowerCase().includes("intermediate"))).toBe(true);
  });
});
