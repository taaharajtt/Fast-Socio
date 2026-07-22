import { describe, expect, it } from "vitest";
import {
  isSocietyCategory,
  isOfficerRole,
  roleRank,
  canManageSociety,
  canAssignRole,
  canRemoveRole,
  assignableRoles,
  canPostAnnouncement,
  canEditProfile,
  ROLE_RANK,
  type Viewer,
} from "./logic";

const owner: Viewer = { role: "owner", isAdmin: false };
const president: Viewer = { role: "president", isAdmin: false };
const officer: Viewer = { role: "officer", isAdmin: false };
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
  it("orders ranks owner > president > … > member", () => {
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
    expect(canManageSociety({ role: "moderator", isAdmin: false })).toBe(true);
  });

  it("keeps plain members and outsiders out; admins always in", () => {
    expect(canManageSociety(member)).toBe(false);
    expect(canManageSociety(outsider)).toBe(false);
    expect(canManageSociety(admin)).toBe(true);
  });

  it("gates announcements and profile edits the same way", () => {
    expect(canPostAnnouncement(officer)).toBe(true);
    expect(canPostAnnouncement(member)).toBe(false);
    expect(canEditProfile(president)).toBe(true);
    expect(canEditProfile(outsider)).toBe(false);
  });
});

describe("canAssignRole — never grant at or above your own rank", () => {
  it("admins can assign any officer role", () => {
    expect(canAssignRole(admin, "president")).toBe(true);
    expect(canAssignRole(admin, "moderator")).toBe(true);
  });

  it("owner (via president gate) can assign every officer role below owner", () => {
    // owner rank 100 > president 90, so owner may appoint a president.
    expect(canAssignRole(owner, "president")).toBe(true);
    expect(canAssignRole(owner, "officer")).toBe(true);
  });

  it("a president can assign below president but not a peer president", () => {
    expect(canAssignRole(president, "vice_president")).toBe(true);
    expect(canAssignRole(president, "officer")).toBe(true);
    expect(canAssignRole(president, "president")).toBe(false);
  });

  it("officers and members cannot assign roles at all", () => {
    expect(canAssignRole(officer, "moderator")).toBe(false);
    expect(canAssignRole(member, "moderator")).toBe(false);
    expect(canAssignRole(outsider, "officer")).toBe(false);
  });
});

describe("canRemoveRole", () => {
  it("president can remove someone strictly below them", () => {
    expect(canRemoveRole(president, "officer")).toBe(true);
    expect(canRemoveRole(president, "vice_president")).toBe(true);
  });

  it("president cannot remove a peer or the owner", () => {
    expect(canRemoveRole(president, "president")).toBe(false);
    expect(canRemoveRole(president, "owner")).toBe(false);
  });

  it("admin can remove anyone; officers cannot remove", () => {
    expect(canRemoveRole(admin, "president")).toBe(true);
    expect(canRemoveRole(officer, "moderator")).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("gives a president every role strictly below president", () => {
    const roles = assignableRoles(president);
    expect(roles).toContain("vice_president");
    expect(roles).toContain("officer");
    expect(roles).toContain("moderator");
    expect(roles).not.toContain("president");
  });

  it("gives officers/members nothing, admins everything", () => {
    expect(assignableRoles(officer)).toHaveLength(0);
    expect(assignableRoles(member)).toHaveLength(0);
    expect(assignableRoles(admin).length).toBeGreaterThan(0);
  });
});
