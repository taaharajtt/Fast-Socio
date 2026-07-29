import { describe, expect, it } from "vitest";
import {
  isSocietyCategory,
  isOfficerRole,
  roleRank,
  canManageSociety,
  canAssignRole,
  canRemoveRole,
  canResignRole,
  assignableRoles,
  canPostAnnouncement,
  canEditProfile,
  canModerateContent,
  ROLE_RANK,
  type Viewer,
} from "./logic";

const owner: Viewer = { role: "owner", isAdmin: false };
const president: Viewer = { role: "president", isAdmin: false };
const officer: Viewer = { role: "officer", isAdmin: false };
const moderator: Viewer = { role: "moderator", isAdmin: false };
const member: Viewer = { role: "member", isAdmin: false };
const outsider: Viewer = { role: null, isAdmin: false };
const admin: Viewer = { role: null, isAdmin: true };

describe("category / role validation", () => {
  it("accepts only known society categories", () => {
    expect(isSocietyCategory("academic")).toBe(true);
    expect(isSocietyCategory("tech")).toBe(true);
    expect(isSocietyCategory("groups")).toBe(false);
    expect(isSocietyCategory(null)).toBe(false);
    expect(isSocietyCategory(42)).toBe(false);
  });

  it("recognises officer roles but not owner/member", () => {
    expect(isOfficerRole("president")).toBe(true);
    expect(isOfficerRole("event_manager")).toBe(true);
    expect(isOfficerRole("owner")).toBe(false); // owner is implicit, not assignable
    expect(isOfficerRole("member")).toBe(false);
    expect(isOfficerRole("ceo")).toBe(false);
  });
});

describe("role hierarchy", () => {
  it("orders ranks owner > president > ... > member", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("president"));
    expect(roleRank("president")).toBeGreaterThan(roleRank("vice_president"));
    expect(roleRank("vice_president")).toBeGreaterThan(roleRank("officer"));
    expect(roleRank("officer")).toBeGreaterThan(roleRank("moderator"));
    expect(roleRank("moderator")).toBeGreaterThan(roleRank("member"));
  });

  it("treats null/undefined as rank 0", () => {
    expect(roleRank(null)).toBe(0);
    expect(roleRank(undefined)).toBe(0);
  });

  it("mirrors the DB rank table used by society_role_name_rank", () => {
    expect(ROLE_RANK.owner).toBe(100);
    expect(ROLE_RANK.president).toBe(90);
    expect(ROLE_RANK.member).toBe(10);
  });
});

describe("canManageSociety", () => {
  it("lets the owner and any officer in", () => {
    expect(canManageSociety(owner)).toBe(true);
    expect(canManageSociety(president)).toBe(true);
    expect(canManageSociety(officer)).toBe(true);
    expect(canManageSociety(moderator)).toBe(true);
  });

  it("keeps plain members and outsiders out; admins always in", () => {
    expect(canManageSociety(member)).toBe(false);
    expect(canManageSociety(outsider)).toBe(false);
    expect(canManageSociety(admin)).toBe(true);
  });

  it("lets any officer post announcements", () => {
    expect(canPostAnnouncement(officer)).toBe(true);
    expect(canPostAnnouncement(member)).toBe(false);
  });
});

describe("canEditProfile — society identity is president+ only", () => {
  it("admits the owner, a president and platform admins", () => {
    expect(canEditProfile(owner)).toBe(true);
    expect(canEditProfile(president)).toBe(true);
    expect(canEditProfile(admin)).toBe(true);
  });

  it("shuts out moderators and lower officers (mig 0120 enforces this too)", () => {
    expect(canEditProfile(moderator)).toBe(false);
    expect(canEditProfile(officer)).toBe(false);
    expect(canEditProfile(member)).toBe(false);
    expect(canEditProfile(outsider)).toBe(false);
  });
});

describe("canModerateContent — queues stay open to moderators", () => {
  it("admits every officer tier plus the owner and admins", () => {
    expect(canModerateContent(moderator)).toBe(true);
    expect(canModerateContent(officer)).toBe(true);
    expect(canModerateContent(owner)).toBe(true);
    expect(canModerateContent(admin)).toBe(true);
  });

  it("keeps plain members and outsiders out", () => {
    expect(canModerateContent(member)).toBe(false);
    expect(canModerateContent(outsider)).toBe(false);
  });
});

// fix-024 (mig 0131): appointment is the OWNER's alone. A president — who used
// to be able to appoint below their own rank — no longer can.
describe("canAssignRole — owner only", () => {
  it("admits the owner and platform admins", () => {
    expect(canAssignRole(owner)).toBe(true);
    expect(canAssignRole(admin)).toBe(true);
  });

  it("shuts out presidents, officers, members and outsiders", () => {
    expect(canAssignRole(president)).toBe(false);
    expect(canAssignRole(officer)).toBe(false);
    expect(canAssignRole(member)).toBe(false);
    expect(canAssignRole(outsider)).toBe(false);
  });
});

describe("canRemoveRole — owner only", () => {
  it("admits the owner and platform admins", () => {
    expect(canRemoveRole(owner)).toBe(true);
    expect(canRemoveRole(admin)).toBe(true);
  });

  it("a president can no longer demote anyone", () => {
    expect(canRemoveRole(president)).toBe(false);
    expect(canRemoveRole(officer)).toBe(false);
  });
});

describe("canResignRole", () => {
  it("an officer may step down from their own role", () => {
    expect(canResignRole({ ...officer, me: "u1" }, "u1")).toBe(true);
  });

  it("an officer may not remove somebody else", () => {
    expect(canResignRole({ ...officer, me: "u1" }, "u2")).toBe(false);
  });

  it("a plain member has no officer role to resign", () => {
    expect(canResignRole({ ...member, me: "u1" }, "u1")).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("gives the owner every officer role", () => {
    const roles = assignableRoles(owner);
    expect(roles).toContain("president");
    expect(roles).toContain("vice_president");
    expect(roles).toContain("moderator");
  });

  it("gives presidents/officers/members nothing, admins everything", () => {
    expect(assignableRoles(president)).toHaveLength(0);
    expect(assignableRoles(officer)).toHaveLength(0);
    expect(assignableRoles(member)).toHaveLength(0);
    expect(assignableRoles(admin).length).toBeGreaterThan(0);
  });
});
