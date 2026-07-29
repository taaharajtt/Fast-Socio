import { describe, it, expect } from "vitest";
import {
  matchScore,
  rawMatchScore,
  interestsTerm,
  sharedInterestCount,
  rollBatchYear,
  MATCH_SCORE_MIN,
  MATCH_SCORE_MAX,
  type MatchScoreInput,
} from "./match-score";

/** A pair sharing nothing and matching on no categorical signal. */
const strangerA: MatchScoreInput = {
  interests: ["Cricket"],
  gender: "male",
  department: "Fast School of Computing",
  semester: 4,
  batchYear: 22,
};
const strangerB: MatchScoreInput = {
  interests: ["Poetry"],
  gender: "male",
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
  it("gives 7 per shared interest up to the plateau of 6", () => {
    expect(interestsTerm(0)).toBe(0);
    expect(interestsTerm(1)).toBe(7);
    expect(interestsTerm(6)).toBe(42);
  });

  it("keeps rising past 6 but with diminishing returns", () => {
    expect(interestsTerm(12)).toBeCloseTo(46, 6);
    expect(interestsTerm(24)).toBeCloseTo(48, 6);
    expect(interestsTerm(30)).toBeGreaterThan(interestsTerm(24));
  });

  it("never reaches its 50-point ceiling, however many interests are ticked", () => {
    // The whole point: ticking all 40 interests must not max the dominant term.
    expect(interestsTerm(40)).toBeLessThan(50);
    expect(interestsTerm(1000)).toBeLessThan(50);
    expect(interestsTerm(40)).toBeLessThan(49);
  });

  it("is monotonically non-decreasing", () => {
    for (let s = 0; s < 60; s++) {
      expect(interestsTerm(s + 1)).toBeGreaterThanOrEqual(interestsTerm(s));
    }
  });
});

describe("matchScore weighting", () => {
  it("scores the worked example at 94", () => {
    // 8 shared interests, opposite gender, same semester, different school, same batch.
    const a: MatchScoreInput = {
      interests: ["a", "b", "c", "d", "e", "f", "g", "h"],
      gender: "female",
      department: "Fast School of Computing",
      semester: 4,
      batchYear: 22,
    };
    const b: MatchScoreInput = {
      interests: ["a", "b", "c", "d", "e", "f", "g", "h"],
      gender: "male",
      department: "Fast School of Management",
      semester: 4,
      batchYear: 22,
    };
    // interests 42 + 8*2/8 = 44, +15 gender, +13 semester, +12 school, +10 batch
    expect(rawMatchScore(a, b)).toBeCloseTo(94, 6);
    expect(matchScore(a, b)).toBe(94);
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

  it("makes interests the dominant signal — roughly half the total weight", () => {
    // The four categorical signals sum to 50, and the interests term's ceiling is
    // also 50: interests alone carry half the scale, per the runbook's "roughly half".
    const allCategoricals = 15 + 13 + 12 + 10;
    expect(allCategoricals).toBe(50);
    // It approaches that ceiling without ever reaching it (asserted above), so the
    // dominance claim is "asymptotically equal to all categoricals combined".
    expect(interestsTerm(1000)).toBeGreaterThan(allCategoricals - 1);
    expect(interestsTerm(1000)).toBeLessThan(allCategoricals);
    // And no single categorical signal comes close to a solid interest overlap.
    expect(interestsTerm(6)).toBeGreaterThan(15 + 13 + 12);
  });

  it("awards nothing for a signal missing on either side", () => {
    const known: MatchScoreInput = {
      gender: "male",
      department: "X",
      semester: 4,
      batchYear: 22,
    };
    const unknown: MatchScoreInput = {
      gender: null,
      department: null,
      semester: null,
      batchYear: null,
    };
    expect(rawMatchScore(known, unknown)).toBe(0);
  });

  it("ignores a gender value that is neither male nor female", () => {
    const a: MatchScoreInput = { gender: "male" };
    const b: MatchScoreInput = { gender: "prefer not to say" };
    expect(rawMatchScore(a, b)).toBe(0);
  });
});

describe("matchScore contract", () => {
  it("never returns 0 or 100", () => {
    expect(matchScore(strangerA, strangerB)).toBe(MATCH_SCORE_MIN);
    const maxed: MatchScoreInput = {
      interests: Array.from({ length: 500 }, (_, i) => `i${i}`),
      gender: "female",
      department: "X",
      semester: 4,
      batchYear: 22,
    };
    const maxedOther: MatchScoreInput = { ...maxed, gender: "male", department: "Y" };
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
            gender: "male",
            department: "X",
            semester: 4,
            batchYear: 22,
          },
          {
            interests: Array.from({ length: s }, (_, i) => `i${i}`),
            gender: cross ? "female" : "male",
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
      gender: "female",
      department: "X",
      semester: 2,
      batchYear: 23,
    };
    const b: MatchScoreInput = {
      interests: ["b", "c"],
      gender: "male",
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
