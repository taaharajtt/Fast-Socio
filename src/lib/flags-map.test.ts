import { describe, expect, it } from "vitest";
import {
  CONSERVATIVE_FLAG_DEFAULTS,
  conservativeFlags,
  mapFlagsResponse,
  type FeatureKey,
} from "./flags-map";

const KEYS: FeatureKey[] = ["discover", "events", "leaderboard"];

describe("mapFlagsResponse", () => {
  it("reads the flags the RPC returned", () => {
    expect(
      mapFlagsResponse(KEYS, {
        discover: true,
        events: false,
        leaderboard: true,
      })
    ).toEqual({ discover: true, events: false, leaderboard: true });
  });

  // The point of batching is that ONE call answers for several keys, so the
  // response must be demultiplexed by key rather than positionally.
  it("keys the result by flag, not by order", () => {
    const out = mapFlagsResponse(["leaderboard", "discover"], {
      discover: false,
      leaderboard: true,
    })!;
    expect(out.leaderboard).toBe(true);
    expect(out.discover).toBe(false);
  });

  // REGRESSION GUARD. This used to return all-true on an unusable payload,
  // which meant one bad read could dark-launch every gated feature at once.
  // It must now signal "escalate to the fallback" instead of inventing answers.
  it("returns null for an unusable payload instead of failing open", () => {
    for (const bad of [null, undefined, "", 0, "unexpected", [], NaN]) {
      expect(mapFlagsResponse(KEYS, bad)).toBeNull();
    }
  });

  it("treats a missing key in a valid response as off", () => {
    expect(mapFlagsResponse(KEYS, { discover: true })).toEqual({
      discover: true,
      events: false,
      leaderboard: false,
    });
  });

  it("does not confuse an empty object with a failed read", () => {
    // `{}` is a VALID response meaning "no such flags" -> all off.
    // `null` is a FAILED read -> escalate. These must not collapse together.
    expect(mapFlagsResponse(KEYS, {})).toEqual({
      discover: false,
      events: false,
      leaderboard: false,
    });
    expect(mapFlagsResponse(KEYS, null)).toBeNull();
  });

  it("coerces the truthiness Postgres jsonb may return", () => {
    expect(
      mapFlagsResponse(KEYS, { discover: 1, events: 0, leaderboard: null })
    ).toEqual({ discover: true, events: false, leaderboard: false });
  });

  it("returns an empty object for no keys", () => {
    expect(mapFlagsResponse([], {})).toEqual({});
  });
});

describe("conservativeFlags", () => {
  it("answers only for the keys asked about", () => {
    expect(Object.keys(conservativeFlags(KEYS)).sort()).toEqual(
      ["discover", "events", "leaderboard"].sort()
    );
  });

  it("returns the shipped default for each key", () => {
    const out = conservativeFlags(["discover", "communities"]);
    expect(out.discover).toBe(CONSERVATIVE_FLAG_DEFAULTS.discover);
    expect(out.communities).toBe(CONSERVATIVE_FLAG_DEFAULTS.communities);
  });

  // The defaults are "what is already shipped and on in production", NOT a
  // blanket true. If a future flag gates something unreleased it must be added
  // to the map as false — the Record<FeatureKey, boolean> type makes omitting
  // it a compile error, and this test documents the intent behind that.
  it("never invents a value for a key with no declared default", () => {
    const out = conservativeFlags(["nope" as FeatureKey]);
    expect(out["nope" as FeatureKey]).toBe(false);
  });

  it("covers every declared FeatureKey so a new flag cannot be forgotten", () => {
    for (const [key, value] of Object.entries(CONSERVATIVE_FLAG_DEFAULTS)) {
      expect(typeof value, `${key} must declare an explicit default`).toBe(
        "boolean"
      );
    }
    expect(Object.keys(CONSERVATIVE_FLAG_DEFAULTS).sort()).toEqual([
      "communities",
      "discover",
      "events",
      "leaderboard",
    ]);
  });
});
