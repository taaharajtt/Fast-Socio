import { describe, it, expect } from "vitest";
import {
  pacingBucket,
  isPacedViewer,
  pacedSlot,
  paceFemaleViewerDeck,
  paceCandidatesForViewer,
  FEMALE_RUN,
  OTHER_RUN,
} from "./gender-pacing";

/** A candidate stub: only the fields the pacer reads, plus a name to assert on. */
type C = { name: string; gender: string | null; tier?: number };

const f = (n: number, tier = 0): C => ({ name: `f${n}`, gender: "female", tier });
const m = (n: number, tier = 0): C => ({ name: `m${n}`, gender: "male", tier });

const names = (cs: readonly C[]) => cs.map((c) => c.name);
const buckets = (cs: readonly C[]) => cs.map((c) => pacingBucket(c.gender));

describe("pacingBucket", () => {
  it("recognises female regardless of case and padding", () => {
    expect(pacingBucket("female")).toBe("female");
    expect(pacingBucket("  FEMALE ")).toBe("female");
  });

  it("treats everything else as one 'other' bucket", () => {
    for (const g of [
      "male",
      "MALE",
      "prefer_not_to_say",
      "prefer not to say",
      "non-binary",
      "",
      "   ",
      null,
      undefined,
      "🙂",
    ]) {
      expect(pacingBucket(g)).toBe("other");
    }
  });
});

describe("isPacedViewer", () => {
  it("is true only for a female viewer", () => {
    expect(isPacedViewer("female")).toBe(true);
    expect(isPacedViewer("Female ")).toBe(true);
    for (const g of ["male", "prefer_not_to_say", null, undefined, "", "unknown"]) {
      expect(isPacedViewer(g)).toBe(false);
    }
  });
});

describe("pacedSlot", () => {
  it("gives female ranks the two leading slots of each cycle", () => {
    expect([1, 2, 3, 4, 5, 6].map((k) => pacedSlot("female", k))).toEqual([
      1, 2, 4, 5, 7, 8,
    ]);
  });

  it("gives other ranks the trailing slot of each cycle", () => {
    expect([1, 2, 3].map((j) => pacedSlot("other", j))).toEqual([3, 6, 9]);
  });

  it("can never collide across the two buckets", () => {
    const female = new Set(
      Array.from({ length: 200 }, (_, i) => pacedSlot("female", i + 1))
    );
    for (let j = 1; j <= 200; j++) {
      expect(female.has(pacedSlot("other", j))).toBe(false);
    }
  });

  it("uses a cycle of FEMALE_RUN + OTHER_RUN", () => {
    expect(FEMALE_RUN).toBe(2);
    expect(OTHER_RUN).toBe(1);
  });
});

describe("paceFemaleViewerDeck", () => {
  it("produces female, female, other repeating when inventory permits", () => {
    const ranked = [f(1), m(1), f(2), m(2), f(3), m(3), f(4), f(5), f(6)];
    expect(buckets(paceFemaleViewerDeck(ranked))).toEqual([
      "female",
      "female",
      "other",
      "female",
      "female",
      "other",
      "female",
      "female",
      "other",
    ]);
  });

  it("preserves ranking quality inside each bucket", () => {
    const ranked = [f(1), f(2), m(1), f(3), m(2), f(4), m(3), f(5), f(6), m(4)];
    const out = paceFemaleViewerDeck(ranked);
    expect(names(out.filter((c) => c.gender === "female"))).toEqual([
      "f1",
      "f2",
      "f3",
      "f4",
      "f5",
      "f6",
    ]);
    expect(names(out.filter((c) => c.gender === "male"))).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    expect(names(out)).toEqual([
      "f1",
      "f2",
      "m1",
      "f3",
      "f4",
      "m2",
      "f5",
      "f6",
      "m3",
      "m4",
    ]);
  });

  it("never drops, duplicates or mutates a candidate", () => {
    const ranked = [f(1), m(1), m(2), f(2), m(3)];
    const snapshot = names(ranked);
    const out = paceFemaleViewerDeck(ranked);
    expect(out).toHaveLength(ranked.length);
    expect(names(out).slice().sort()).toEqual(snapshot.slice().sort());
    expect(names(ranked)).toEqual(snapshot);
  });

  it("falls back gracefully when female inventory is scarce", () => {
    // One woman, five others: no hard filter, so the deck is still six cards.
    const out = paceFemaleViewerDeck([f(1), m(1), m(2), m(3), m(4), m(5)]);
    expect(names(out)).toEqual(["f1", "m1", "m2", "m3", "m4", "m5"]);
  });

  it("falls back gracefully when no female candidate exists at all", () => {
    const ranked = [m(1), m(2), m(3)];
    expect(names(paceFemaleViewerDeck(ranked))).toEqual(["m1", "m2", "m3"]);
  });

  it("falls back gracefully when other inventory is scarce", () => {
    // One man, five women: he takes slot 3, the women flow on unbroken.
    const out = paceFemaleViewerDeck([f(1), f(2), f(3), f(4), f(5), m(1)]);
    expect(names(out)).toEqual(["f1", "f2", "m1", "f3", "f4", "f5"]);
  });

  it("falls back gracefully when every candidate is female", () => {
    const ranked = [f(1), f(2), f(3), f(4)];
    expect(names(paceFemaleViewerDeck(ranked))).toEqual(["f1", "f2", "f3", "f4"]);
  });

  it("keeps every fresh candidate ahead of every recycled pass", () => {
    const ranked = [
      f(1, 0),
      m(1, 0),
      f(2, 0),
      f(3, 1),
      m(2, 1),
      f(4, 1),
      m(3, 1),
    ];
    const out = paceFemaleViewerDeck(ranked);
    expect(out.map((c) => c.tier)).toEqual([0, 0, 0, 1, 1, 1, 1]);
    // ...and the rhythm restarts inside the recycle round.
    expect(names(out)).toEqual(["f1", "f2", "m1", "f3", "f4", "m2", "m3"]);
  });

  it("treats prefer_not_to_say, null and unknown values as 'other', not a third lane", () => {
    const ranked: C[] = [
      { name: "pn", gender: "prefer_not_to_say" },
      { name: "nul", gender: null },
      { name: "odd", gender: "???" },
      f(1),
      f(2),
      f(3),
      f(4),
    ];
    const out = paceFemaleViewerDeck(ranked);
    expect(names(out)).toEqual(["f1", "f2", "pn", "f3", "f4", "nul", "odd"]);
  });

  it("is deterministic", () => {
    const ranked = [f(1), m(1), f(2), m(2), f(3)];
    const first = names(paceFemaleViewerDeck(ranked));
    for (let i = 0; i < 5; i++) {
      expect(names(paceFemaleViewerDeck(ranked))).toEqual(first);
    }
  });

  it("handles an empty deck", () => {
    expect(paceFemaleViewerDeck([])).toEqual([]);
  });
});

describe("paceCandidatesForViewer", () => {
  const ranked = [m(1), m(2), f(1), m(3), f(2), f(3)];

  it("paces a female viewer", () => {
    expect(names(paceCandidatesForViewer(ranked, "female"))).toEqual([
      "f1",
      "f2",
      "m1",
      "f3",
      "m2",
      "m3",
    ]);
  });

  it("leaves the ranking untouched for every other viewer", () => {
    for (const g of ["male", "prefer_not_to_say", null, undefined, "", "mystery"]) {
      expect(names(paceCandidatesForViewer(ranked, g))).toEqual(names(ranked));
    }
  });

  it("returns a copy, never the caller's array", () => {
    const out = paceCandidatesForViewer(ranked, "male");
    expect(out).not.toBe(ranked);
    expect(out).toEqual(ranked);
  });
});
