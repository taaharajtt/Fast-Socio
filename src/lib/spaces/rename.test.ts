import { describe, it, expect } from "vitest";
import {
  canRenameCommunity,
  canRenameEvent,
  isUnchangedTitle,
  TITLE_RULES,
  validateTitle,
} from "./rename";

describe("title validation", () => {
  it("keeps the bounds the database enforces", () => {
    // communities.name CHECK (mig 0009); rename_event bounds (mig 0178).
    expect(TITLE_RULES.community).toMatchObject({ min: 2, max: 60 });
    expect(TITLE_RULES.society).toMatchObject({ min: 2, max: 60 });
    expect(TITLE_RULES.event).toMatchObject({ min: 2, max: 120 });
  });

  it("accepts a normal name and returns it trimmed", () => {
    const res = validateTitle("community", "  Robotics Club  ");
    expect(res).toEqual({ ok: true, value: "Robotics Club" });
  });

  it("measures the TRIMMED length, not what was typed", () => {
    // Six characters typed, one stored — must be rejected.
    expect(validateTitle("community", "     a     ").ok).toBe(false);
    // Exactly at the max after trimming — must be accepted.
    const atMax = ` ${"x".repeat(60)} `;
    expect(validateTitle("community", atMax)).toEqual({
      ok: true,
      value: "x".repeat(60),
    });
  });

  it("rejects empty, too-short and too-long titles with a usable message", () => {
    expect(validateTitle("community", "")).toEqual({
      ok: false,
      error: "Name must be 2–60 characters.",
    });
    expect(validateTitle("community", "x").ok).toBe(false);
    expect(validateTitle("community", "x".repeat(61)).ok).toBe(false);
    expect(validateTitle("event", "x".repeat(121))).toEqual({
      ok: false,
      error: "Title must be 2–120 characters.",
    });
  });

  it("allows an event title longer than a community name", () => {
    const long = "x".repeat(100);
    expect(validateTitle("event", long).ok).toBe(true);
    expect(validateTitle("community", long).ok).toBe(false);
  });

  it("treats a re-typed name as unchanged regardless of surrounding space", () => {
    expect(isUnchangedTitle("Chess Club", "  Chess Club ")).toBe(true);
    expect(isUnchangedTitle("Chess Club", "Chess Society")).toBe(false);
  });
});

describe("community / society rename authority", () => {
  // Mirrors rename_community (mig 0178), which is owner-or-admin and refuses
  // everyone else — uat18_verification.sql asserts that refusal.
  it("lets the owner rename", () => {
    expect(canRenameCommunity({ isOwner: true, isAdmin: false })).toBe(true);
  });

  it("lets an admin rename", () => {
    expect(canRenameCommunity({ isOwner: false, isAdmin: true })).toBe(true);
  });

  it("refuses an ordinary member", () => {
    expect(canRenameCommunity({ isOwner: false, isAdmin: false })).toBe(false);
  });

  it("refuses a society president — renaming is not part of profile editing", () => {
    // A president may rewrite category/bio/banner via upsert_society_profile,
    // but the name stays with the owner (UAT-04). If this test is ever changed,
    // rename_community must change first.
    expect(canRenameCommunity({ isOwner: false, isAdmin: false })).toBe(false);
  });
});

describe("event rename authority", () => {
  it("allows the host, a co-organizer and an admin", () => {
    const base = { isHost: false, isOrganizer: false, isAdmin: false };
    expect(canRenameEvent({ ...base, isHost: true })).toBe(true);
    expect(canRenameEvent({ ...base, isOrganizer: true })).toBe(true);
    expect(canRenameEvent({ ...base, isAdmin: true })).toBe(true);
  });

  it("refuses a plain attendee", () => {
    expect(
      canRenameEvent({ isHost: false, isOrganizer: false, isAdmin: false })
    ).toBe(false);
  });
});
