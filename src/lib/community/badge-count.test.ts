import { describe, expect, it } from "vitest";
import { fetchCommunityBadge, sumBadge } from "./badge-count";

/**
 * The product rule under test: the Community badge counts grouped
 * Community/Event/Broadcast ITEMS, never raw messages.
 *
 * The grouping itself (one item per community needing management, one item per
 * broadcasting space) happens in SQL — `community_badge_count()`, migration
 * 0170 — so what is asserted here is the contract on this side of it: the
 * breakdown sums into the rendered total, every kind contributes, and a bad or
 * missing answer produces no badge rather than a wrong one.
 */

function rpcClient(data: unknown, error: unknown = null) {
  return { rpc: async () => ({ data, error }) } as never;
}

describe("sumBadge", () => {
  it("sums every item kind into the rendered total", () => {
    const badge = sumBadge({
      manage: 2,
      joined: 1,
      communities: 1,
      events: 3,
      broadcasts: 2,
      approvals: 1,
    });
    expect(badge.total).toBe(10);
  });

  it("counts one community needing management as 1 and two as 2", () => {
    expect(sumBadge({ manage: 1 }).total).toBe(1);
    expect(sumBadge({ manage: 2 }).total).toBe(2);
  });

  it("takes the grouped broadcast count as given — one item per space", () => {
    // Twenty announcements from one society reach this helper as `1`; the
    // collapse is the RPC's job and must not be re-derived from row counts.
    expect(sumBadge({ broadcasts: 1 }).total).toBe(1);
  });

  it("has no key for chat messages at all", () => {
    // A community chat message can only inflate the badge if some key carries
    // it. Passing one is silently ignored, which is the point.
    expect(sumBadge({ community_messages: 40 }).total).toBe(0);
  });

  it("treats a missing kind as zero", () => {
    expect(sumBadge({ events: 2 })).toMatchObject({
      manage: 0,
      events: 2,
      total: 2,
    });
  });

  it("never renders NaN or a negative from a miscoded answer", () => {
    const badge = sumBadge({ manage: "oops", joined: -4, events: 2.7 });
    expect(badge.manage).toBe(0);
    expect(badge.joined).toBe(0);
    expect(badge.events).toBe(2);
    expect(badge.total).toBe(2);
  });
});

describe("fetchCommunityBadge", () => {
  it("returns the summed breakdown from the RPC", async () => {
    const badge = await fetchCommunityBadge(
      rpcClient({
        manage: 1,
        joined: 0,
        communities: 2,
        events: 1,
        broadcasts: 1,
        approvals: 0,
      })
    );
    expect(badge.total).toBe(5);
    expect(badge.manage).toBe(1);
  });

  it("shows no badge when the RPC is missing — never a guess", async () => {
    // Without migration 0170 there is no seen model, so any invented number
    // would point students at surfaces they have already read.
    const badge = await fetchCommunityBadge(
      rpcClient(null, { message: "function does not exist" })
    );
    expect(badge.total).toBe(0);
  });

  it("shows no badge when the call throws", async () => {
    const badge = await fetchCommunityBadge({
      rpc: async () => {
        throw new Error("network");
      },
    } as never);
    expect(badge.total).toBe(0);
  });
});
