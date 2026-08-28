import { describe, it, expect } from "vitest";
import {
  matchScore,
  rawMatchScore,
  interestsTerm,
  sharedInterestCount,
  rollBatchYear,
  MATCH_WEIGHTS,
  MATCH_SCORE_MIN,
  MATCH_SCORE_MAX,
  type MatchScoreInput,
} from "./match-score";

/** A pair sharing nothing and matching on no categorical signal. */
const strangerA: MatchScoreInput = {
  interests: ["Cricket"],
  department: "Fast School of Computing",
  semester: 4,
  batchYear: 22,
};
const strangerB: MatchScoreInput = {
  interests: ["Poetry"],
  department: "Fast School of Computing",
  semester: 6,
  batchYear: 21,
};

describe("sharedInterestCount", () => {
  it("counts the intersection", () => {
    expect(sharedInterestCount(["a", "b", "c"], ["b", "c", "d"])).toBe(2);
  });

  it("is 0 for missing or empty input", () => {
    expect(sharedInterestCount(null, ["a"])).toBe(0);
    expect(sharedInterestCount(["a"], undefined)).toBe(0);
    expect(sharedInterestCount([], ["a"])).toBe(0);
  });

  it("does not count a duplicated tag twice", () => {
    expect(sharedInterestCount(["a", "a", "b"], ["a", "b"])).toBe(2);
  });
});

describe("interestsTerm", () => {
  it("gives 9 per shared interest up to the plateau of 6", () => {
    expect(interestsTerm(0)).toBe(0);
    expect(interestsTerm(1)).toBe(9);
    expect(interestsTerm(6)).toBe(54);
  });

  it("keeps rising past 6 but with diminishing returns", () => {
    expect(interestsTerm(12)).toBeCloseTo(59.5, 6);
    expect(interestsTerm(24)).toBeCloseTo(62.25, 6);
    expect(interestsTerm(30)).toBeGreaterThan(interestsTerm(24));
  });

  it("never reaches its 65-point ceiling, however many interests are ticked", () => {
    // The whole point: ticking all 40 interests must not max the dominant term.
    expect(interestsTerm(40)).toBeLessThan(65);
    expect(interestsTerm(1000)).toBeLessThan(65);
    expect(interestsTerm(40)).toBeLessThan(64);
  });

  it("is monotonically non-decreasing", () => {
    for (let s = 0; s < 60; s++) {
      expect(interestsTerm(s + 1)).toBeGreaterThanOrEqual(interestsTerm(s));
    }
  });
});

describe("matchScore weighting", () => {
  it("scores the worked example at 92", () => {
    // 8 shared interests, same semester, different school, same batch.
    const a: MatchScoreInput = {
      interests: ["a", "b", "c", "d", "e", "f", "g", "h"],
      department: "Fast School of Computing",
      semester: 4,
      batchYear: 22,
    };
    const b: MatchScoreInput = {
      interests: ["a", "b", "c", "d", "e", "f", "g", "h"],
      department: "Fast School of Management",
      semester: 4,
      batchYear: 22,
    };
    // interests 54 + 11*2/8 = 56.75, +13 semester, +12 school, +10 batch
    expect(rawMatchScore(a, b)).toBeCloseTo(91.75, 6);
    expect(matchScore(a, b)).toBe(92);
  });

  it("favours a DIFFERENT school over the same one", () => {
    const base: MatchScoreInput = { interests: ["a"], semester: 3, batchYear: 22 };
    const same = matchScore(
      { ...base, department: "X" },
      { ...base, department: "X" }
    );
    const cross = matchScore(
      { ...base, department: "X" },
      { ...base, department: "Y" }
    );
    expect(cross).toBeGreaterThan(same);
    expect(cross - same).toBe(12);
  });

  it("makes interests dominant — 65 of the 100 points", () => {
    // The three categorical signals sum to 35; the interests ceiling is 65, so the
    // weights still total 100 after the +15 opposite-gender term was removed.
    const allCategoricals =
      MATCH_WEIGHTS.sameSemester +
      MATCH_WEIGHTS.differentSchool +
      MATCH_WEIGHTS.sameBatch;
    expect(allCategoricals).toBe(35);
    const interestsCeiling =
      MATCH_WEIGHTS.interestsBase * MATCH_WEIGHTS.interestsPlateau +
      MATCH_WEIGHTS.interestsBonus;
    expect(interestsCeiling).toBe(65);
    expect(interestsCeiling + allCategoricals).toBe(100);
    // The term approaches its ceiling without ever reaching it.
    expect(interestsTerm(1e6)).toBeGreaterThan(interestsCeiling - 1);
    expect(interestsTerm(1e6)).toBeLessThan(interestsCeiling);
    // And every categorical signal combined is worth less than six shared interests.
    expect(interestsTerm(6)).toBeGreaterThan(allCategoricals);
  });

  it("awards nothing for a signal missing on either side", () => {
    const known: MatchScoreInput = {
      department: "X",
      semester: 4,
      batchYear: 22,
    };
    const unknown: MatchScoreInput = {
      department: null,
      semester: null,
      batchYear: null,
    };
    expect(rawMatchScore(known, unknown)).toBe(0);
  });

  it("does not read gender at all", () => {
    // The +15 "opposite gender" term is gone. Gender-aware behaviour lives only in
    // the pacing policy (gender-pacing.ts), which cannot touch the percentage.
    expect(Object.keys(MATCH_WEIGHTS)).not.toContain("oppositeGender");
    expect(JSON.stringify(MATCH_WEIGHTS)).not.toMatch(/gender/i);
  });

  it("scores identically whatever gender the two profiles carry", () => {
    const shape: MatchScoreInput = {
      interests: ["a", "b", "c"],
      department: "X",
      semester: 4,
      batchYear: 22,
    };
    const other: MatchScoreInput = {
      interests: ["a", "b", "c"],
      department: "Y",
      semester: 4,
      batchYear: 22,
    };
    const expected = matchScore(shape, other);
    // Gender is not even part of MatchScoreInput any more; smuggling one in
    // through a spread must still leave the score untouched.
    const genders = ["male", "female", "prefer_not_to_say", null, "??"];
    for (const ga of genders) {
      for (const gb of genders) {
        const a = { ...shape, gender: ga } as MatchScoreInput;
        const b = { ...other, gender: gb } as MatchScoreInput;
        expect(matchScore(a, b)).toBe(expected);
        expect(rawMatchScore(a, b)).toBe(rawMatchScore(shape, other));
      }
    }
  });
});

describe("matchScore contract", () => {
  it("never returns 0 or 100", () => {
    expect(matchScore(strangerA, strangerB)).toBe(MATCH_SCORE_MIN);
    const maxed: MatchScoreInput = {
      interests: Array.from({ length: 500 }, (_, i) => `i${i}`),
      department: "X",
      semester: 4,
      batchYear: 22,
    };
    const maxedOther: MatchScoreInput = { ...maxed, department: "Y" };
    const top = matchScore(maxed, maxedOther);
    expect(top).toBeLessThanOrEqual(MATCH_SCORE_MAX);
    expect(top).toBeGreaterThan(90);
  });

  it("stays within 5..99 across a wide sweep", () => {
    for (let s = 0; s < 50; s++) {
      for (const cross of [true, false]) {
        const score = matchScore(
          {
            interests: Array.from({ length: s }, (_, i) => `i${i}`),
            department: "X",
            semester: 4,
            batchYear: 22,
          },
          {
            interests: Array.from({ length: s }, (_, i) => `i${i}`),
            department: cross ? "Y" : "X",
            semester: 4,
            batchYear: 22,
          }
        );
        expect(score).toBeGreaterThanOrEqual(MATCH_SCORE_MIN);
        expect(score).toBeLessThanOrEqual(MATCH_SCORE_MAX);
      }
    }
  });

  it("is symmetric", () => {
    expect(matchScore(strangerA, strangerB)).toBe(matchScore(strangerB, strangerA));
    const a: MatchScoreInput = {
      interests: ["a", "b"],
      department: "X",
      semester: 2,
      batchYear: 23,
    };
    const b: MatchScoreInput = {
      interests: ["b", "c"],
      department: "Y",
      semester: 2,
      batchYear: 23,
    };
    expect(matchScore(a, b)).toBe(matchScore(b, a));
  });

  it("is deterministic", () => {
    const first = matchScore(strangerA, strangerB);
    for (let i = 0; i < 5; i++) {
      expect(matchScore(strangerA, strangerB)).toBe(first);
    }
  });

  it("returns an integer", () => {
    const score = matchScore(
      { interests: ["a", "b", "c", "d", "e", "f", "g"] },
      { interests: ["a", "b", "c", "d", "e", "f", "g"] }
    );
    expect(Number.isInteger(score)).toBe(true);
  });
});

describe("rollBatchYear", () => {
  it("parses the intake year from a roll number", () => {
    expect(rollBatchYear("i222015")).toBe(22);
    expect(rollBatchYear("22i2015")).toBe(22);
    expect(rollBatchYear("l211234")).toBe(21);
  });

  it("returns null when there is no year to read", () => {
    expect(rollBatchYear(null)).toBeNull();
    expect(rollBatchYear("")).toBeNull();
    expect(rollBatchYear("abc")).toBeNull();
  });
});
