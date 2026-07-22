import { describe, expect, it } from "vitest";
import {
  CAMPUS_MAP_PLACES,
  searchPlaces,
  PLACE_TYPE_META,
  type PlaceType,
} from "./places";

/** First result id for a query (or undefined when nothing matches). */
const topHit = (q: string) => searchPlaces(q)[0]?.id;

describe("campus map places dataset", () => {
  it("has unique ids and in-bounds percentage coordinates", () => {
    const ids = CAMPUS_MAP_PLACES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CAMPUS_MAP_PLACES) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });

  it("has display metadata for every referenced type", () => {
    for (const p of CAMPUS_MAP_PLACES) {
      expect(PLACE_TYPE_META[p.type]).toBeDefined();
    }
  });
});

describe("searchPlaces", () => {
  it("returns the full list (source order) for an empty query", () => {
    expect(searchPlaces("")).toHaveLength(CAMPUS_MAP_PLACES.length);
    expect(searchPlaces("   ")[0].id).toBe(CAMPUS_MAP_PLACES[0].id);
  });

  it("finds places by name", () => {
    expect(topHit("C Block")).toBe("c-block");
    expect(topHit("Wisdom Tree")).toBe("wisdom-tree");
  });

  it("finds places by alias / keyword", () => {
    expect(topHit("cafe")).toBe("c-block-basement-cafe");
    expect(topHit("futsal")).toBe("futsal-ground");
    expect(topHit("masjid")).toBe("masjid");
    expect(topHit("lrc")).toBe("c-block-lrc");
  });

  it("ranks an exact name/alias above partial matches", () => {
    // "gate 1" should surface Gate 1 first even though many gates match "gate".
    expect(topHit("gate 1")).toBe("gate-1");
  });

  it("matches by type and only returns relevant places", () => {
    const parking = searchPlaces("parking");
    expect(parking.length).toBeGreaterThan(0);
    // Every hit genuinely mentions "parking" somewhere searchable (the five
    // parking areas by alias, plus Gate 3 whose description references it).
    const mentionsParking = (p: (typeof parking)[number]) =>
      [p.name, p.shortLabel, p.description, ...p.aliases]
        .join(" ")
        .toLowerCase()
        .includes("parking");
    expect(parking.every(mentionsParking)).toBe(true);
    // The parking type is well represented at the top of the ranking.
    expect(parking[0].type).toBe("parking");
  });

  it("returns nothing for a non-place query", () => {
    expect(searchPlaces("quantum tunnel")).toHaveLength(0);
  });

  it("searches within a pre-filtered corpus", () => {
    const gatesOnly = CAMPUS_MAP_PLACES.filter(
      (p) => p.type === ("gate" satisfies PlaceType)
    );
    // "cafe" isn't a gate, so within the gate corpus it finds nothing.
    expect(searchPlaces("cafe", gatesOnly)).toHaveLength(0);
    expect(searchPlaces("gate 3", gatesOnly)[0].id).toBe("gate-3");
  });
});
