import { describe, expect, it } from "vitest";
import { fetchCommunityBadge, toCommunityBadge } from "./badge-count";

/**
 * The product rule under test: the Community badge is the number of UNREAD
 * COMMUNITY UPDATES — the exact rows /communities/updates renders — and never
 * anything else.
 *
 * The set itself is defined in SQL (`public.community_updates`, migration
 * 0183): which types count, whether an item is still live, and whether the
 * reader may still act on it. What is asserted here is the contract on this
 * side of the boundary — the payload becomes the rendered number, a bad answer
 * produces NO badge rather than a wrong one, and a pre-0183 database (0170's
 * grouped breakdown) resolves to zero instead of being mis-summed.
 */

function rpcClient(data: unknown, error: unknown = null) {
  return { rpc: async () => ({ data, error }) } as never;
}

describe("toCommunityBadge", () => {
  it("renders the unread update count", () => {
    expect(toCommunityBadge({ updates: 6, total: 6 })).toEqual({
      updates: 6,
      total: 6,
    });
  });

  it("renders no badge at zero", () => {
    expect(toCommunityBadge({ updates: 0, total: 0 }).total).toBe(0);
  });

  it("counts items, so two of the same kind are two", () => {
    // Two pending join requests in ONE community are two things to decide, and
    // the old badge collapsed them to one. The count is per ITEM now.
    expect(toCommunityBadge({ updates: 2 }).total).toBe(2);
  });

  it("never renders a negative, a fraction or a NaN", () => {
    expect(toCommunityBadge({ updates: -4 }).total).toBe(0);
    expect(toCommunityBadge({ updates: "oops" }).total).toBe(0);
    expect(toCommunityBadge({ updates: Number.NaN }).total).toBe(0);
    expect(toCommunityBadge({ updates: 2.7 }).total).toBe(2);
  });

  it("resolves a pre-0183 grouped payload to no badge", () => {
    // Migration 0170's shape. A client meeting an older database must show no
    // badge rather than a number computed from a different definition.
    const legacy = {
      manage: 3,
      joined: 1,
      communities: 12,
      events: 4,
      broadcasts: 2,
      approvals: 1,
    };
    expect(toCommunityBadge(legacy).total).toBe(0);
  });
});

describe("fetchCommunityBadge", () => {
  it("reads the RPC payload", async () => {
    const badge = await fetchCommunityBadge(rpcClient({ updates: 3, total: 3 }));
    expect(badge.total).toBe(3);
  });

  it("falls back to no badge when the RPC errors", async () => {
    const badge = await fetchCommunityBadge(
      rpcClient(null, { message: "function does not exist" })
    );
    expect(badge.total).toBe(0);
  });

  it("falls back to no badge when the call throws", async () => {
    const client = {
      rpc: async () => {
        throw new Error("network");
      },
    } as never;
    expect((await fetchCommunityBadge(client)).total).toBe(0);
  });
});
