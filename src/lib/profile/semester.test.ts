import { describe, expect, it } from "vitest";
import { deriveSemester } from "./semester";
import { ALUMNI_SEMESTER } from "./constants";

const roll = (batch: number) => `i${batch}0733`;

describe("deriveSemester", () => {
  // The reference table verified with the user. Fall starts 1 Aug, Spring 1 Jan.
  // Local-time constructors (month is 0-based) since deriveSemester reads the
  // local calendar — the campus clock, not UTC.
  const fall2026 = new Date(2026, 7, 1); // 1 Aug 2026
  const spring2026 = new Date(2026, 0, 1); // 1 Jan 2026

  it("matches the Fall 2026 allocation (22→Alumni, 23→7, 24→5, 25→3, 26→1)", () => {
    expect(deriveSemester(roll(22), fall2026)).toBe(ALUMNI_SEMESTER);
    expect(deriveSemester(roll(23), fall2026)).toBe(7);
    expect(deriveSemester(roll(24), fall2026)).toBe(5);
    expect(deriveSemester(roll(25), fall2026)).toBe(3);
    expect(deriveSemester(roll(26), fall2026)).toBe(1);
  });

  it("matches the Spring 2026 allocation (22→8, 23→6, 24→4, 25→2)", () => {
    expect(deriveSemester(roll(22), spring2026)).toBe(8);
    expect(deriveSemester(roll(23), spring2026)).toBe(6);
    expect(deriveSemester(roll(24), spring2026)).toBe(4);
    expect(deriveSemester(roll(25), spring2026)).toBe(2);
  });

  it("advances on 1 Aug and 1 Jan boundaries", () => {
    expect(deriveSemester(roll(24), new Date(2026, 6, 31, 23, 59))).toBe(4); // 31 Jul
    expect(deriveSemester(roll(24), new Date(2026, 7, 1, 0, 0))).toBe(5); // 1 Aug
    expect(deriveSemester(roll(24), new Date(2026, 11, 31, 23, 59))).toBe(5); // 31 Dec
    expect(deriveSemester(roll(24), new Date(2027, 0, 1, 0, 0))).toBe(6); // 1 Jan
  });

  it("treats batches 2021 and older as Alumni", () => {
    expect(deriveSemester(roll(21), fall2026)).toBe(ALUMNI_SEMESTER);
    expect(deriveSemester(roll(20), fall2026)).toBe(ALUMNI_SEMESTER);
    expect(deriveSemester(roll(18), fall2026)).toBe(ALUMNI_SEMESTER);
  });

  it("returns null for a batch that hasn't enrolled yet", () => {
    expect(deriveSemester(roll(27), fall2026)).toBeNull();
    expect(deriveSemester(roll(27), spring2026)).toBeNull();
  });

  it("returns null for unparseable or empty roll numbers", () => {
    expect(deriveSemester(null, fall2026)).toBeNull();
    expect(deriveSemester(undefined, fall2026)).toBeNull();
    expect(deriveSemester("", fall2026)).toBeNull();
    expect(deriveSemester("abc123", fall2026)).toBeNull();
  });

  it("is case-insensitive and tolerates collision suffixes", () => {
    expect(deriveSemester("I240733", fall2026)).toBe(5);
    expect(deriveSemester("i2407332", fall2026)).toBe(5); // suffixed on collision
  });

  it("handles the year-first roll format (24i5525)", () => {
    expect(deriveSemester("24i5525", fall2026)).toBe(5);
    expect(deriveSemester("25i4637", fall2026)).toBe(3);
    expect(deriveSemester("22i0001", fall2026)).toBe(ALUMNI_SEMESTER);
  });
});
