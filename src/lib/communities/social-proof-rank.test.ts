import { describe, it, expect } from "vitest";
import {
  batchOf,
  firstName,
  rankProof,
  type ProofCandidate,
  type Viewer,
} from "@/lib/communities/social-proof-rank";

function person(over: Partial<ProofCandidate> & { id: string }): ProofCandidate {
  return {
    full_name: "Test Student",
    username: "24i0001",
    avatar_url: "https://example.test/a.jpg",
    department: "CS",
    degree: "BS",
    ...over,
  };
}

const viewer: Viewer = {
  matchedIds: new Set(["match-1"]),
  department: "CS",
  degree: "BS",
  batch: "24",
};

describe("batchOf", () => {
  it("reads the batch year from both roll shapes", () => {
    expect(batchOf("24i5525")).toBe("24");
    expect(batchOf("i240733")).toBe("24");
  });

  it("returns null for a non-roll or missing username", () => {
    expect(batchOf("ahmed")).toBeNull();
    expect(batchOf(null)).toBeNull();
  });
});

describe("rankProof", () => {
  it("puts a match above a programme mate, batchmate, and stranger", () => {
    const ranked = rankProof(
      [
        person({ id: "stranger", department: "EE", degree: "BS", username: "21i0001" }),
        person({ id: "batchmate", department: "EE", degree: "MS", username: "24i0002" }),
        person({ id: "programme", department: "CS", degree: "BS", username: "22i0003" }),
        person({ id: "match-1", department: "EE", degree: "MS", username: "20i0004" }),
      ],
      viewer,
      4
    );
    expect(ranked.map((p) => p.id)).toEqual([
      "match-1",
      "programme",
      "batchmate",
      "stranger",
    ]);
  });

  it("prefers a face over a blank avatar at equal closeness", () => {
    const ranked = rankProof(
      [
        person({ id: "blank", avatar_url: null }),
        person({ id: "has-photo" }),
      ],
      viewer,
      2
    );
    expect(ranked[0].id).toBe("has-photo");
  });

  it("keeps source order for ties, so the stack is stable across renders", () => {
    const ranked = rankProof(
      [person({ id: "a" }), person({ id: "b" }), person({ id: "c" })],
      viewer,
      3
    );
    expect(ranked.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("honours the limit", () => {
    const ranked = rankProof(
      [person({ id: "a" }), person({ id: "b" }), person({ id: "c" })],
      viewer,
      2
    );
    expect(ranked).toHaveLength(2);
  });

  it("ranks on department alone when the degree differs", () => {
    const ranked = rankProof(
      [
        person({ id: "other-dept", department: "EE", degree: "MS", username: "21i0001" }),
        person({ id: "same-dept", department: "CS", degree: "MS", username: "21i0002" }),
      ],
      viewer,
      2
    );
    expect(ranked[0].id).toBe("same-dept");
  });
});

describe("firstName", () => {
  it("takes the first word of a full name", () => {
    expect(firstName(person({ id: "x", full_name: "Ahmed Raza Khan" }))).toBe("Ahmed");
  });

  it("falls back to the roll number, then a generic label", () => {
    expect(firstName(person({ id: "x", full_name: null, username: "24i5525" }))).toBe(
      "24i5525"
    );
    expect(
      firstName(person({ id: "x", full_name: null, username: null }))
    ).toBe("A");
  });
});
