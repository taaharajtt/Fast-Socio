import { describe, expect, it } from "vitest";
import {
  dropOptimistic,
  isOptimisticId,
  mergeMessage,
  mergeMessages,
  newestServerTimestamp,
  resolveOptimistic,
  sortMessages,
  type MergeableMessage,
} from "./message-merge";

const msg = (
  id: string,
  created_at: string,
  extra: Partial<MergeableMessage> = {}
): MergeableMessage => ({
  id,
  created_at,
  sender_id: "me",
  ...extra,
});

const T = (n: number) => `2026-08-23T10:00:0${n}.000Z`;

describe("sortMessages", () => {
  it("orders chronologically", () => {
    const out = sortMessages([msg("c", T(3)), msg("a", T(1)), msg("b", T(2))]);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks ties by id so equal timestamps are stable", () => {
    const out = sortMessages([msg("b", T(1)), msg("a", T(1))]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("mergeMessage", () => {
  it("inserts a new row in timestamp order, not at the end", () => {
    // The bug this replaces: `[...prev, m]` assumed events arrive in write
    // order, which stops being true the moment a reconnect catch-up races a
    // live event.
    const prev = [msg("a", T(1)), msg("c", T(3))];
    const out = mergeMessage(prev, msg("b", T(2)));
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("drops a duplicate id and keeps the array identity", () => {
    // Realtime INSERT and a catch-up fetch cover overlapping windows, so the
    // same row legitimately arrives twice.
    const prev = [msg("a", T(1))];
    expect(mergeMessage(prev, msg("a", T(1)))).toBe(prev);
  });
});

describe("mergeMessages", () => {
  it("folds a catch-up batch in, deduped and ordered", () => {
    const prev = [msg("a", T(1)), msg("b", T(2))];
    const out = mergeMessages(prev, [msg("b", T(2)), msg("d", T(4)), msg("c", T(3))]);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("is a no-op for an empty batch", () => {
    const prev = [msg("a", T(1))];
    expect(mergeMessages(prev, [])).toBe(prev);
  });
});

describe("resolveOptimistic", () => {
  it("rebrands the pending bubble with its real id", () => {
    const prev = [msg("temp-1", T(1), { body: "ok" })];
    const out = resolveOptimistic(prev, "temp-1", { id: "real-1", created_at: T(2) });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("real-1");
    expect(out[0].body).toBe("ok");
  });

  it("keeps the local image preview across the swap", () => {
    const prev = [msg("temp-1", T(1), { _localSrc: "blob:x" })];
    const out = resolveOptimistic(prev, "temp-1", { id: "real-1", created_at: T(1) });
    expect(out[0]._localSrc).toBe("blob:x");
  });

  it("drops the bubble if the realtime INSERT already landed", () => {
    // A fast socket can beat the send action's own round trip.
    const prev = [msg("temp-1", T(1)), msg("real-1", T(1))];
    const out = resolveOptimistic(prev, "temp-1", { id: "real-1", created_at: T(1) });
    expect(out.map((m) => m.id)).toEqual(["real-1"]);
  });

  it("never mis-pairs two identical messages sent back to back", () => {
    // The regression this whole change exists for: the old code matched a
    // bubble to its row by comparing BODY TEXT, so the second "ok" reconciled
    // onto the first bubble and left a duplicate on screen.
    let list: MergeableMessage[] = [
      msg("temp-1", T(1), { body: "ok" }),
      msg("temp-2", T(2), { body: "ok" }),
    ];
    list = resolveOptimistic(list, "temp-1", { id: "real-1", created_at: T(1) });
    list = resolveOptimistic(list, "temp-2", { id: "real-2", created_at: T(2) });
    expect(list.map((m) => m.id)).toEqual(["real-1", "real-2"]);
  });

  it("ignores an unknown temp id", () => {
    const prev = [msg("a", T(1))];
    expect(resolveOptimistic(prev, "temp-gone", { id: "x", created_at: T(2) })).toBe(prev);
  });
});

describe("dropOptimistic", () => {
  it("removes a failed send", () => {
    const out = dropOptimistic([msg("temp-1", T(1)), msg("a", T(2))], "temp-1");
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });
});

describe("newestServerTimestamp", () => {
  it("returns the newest server-backed timestamp", () => {
    expect(newestServerTimestamp([msg("a", T(1)), msg("b", T(3)), msg("c", T(2))])).toBe(
      T(3)
    );
  });

  it("ignores optimistic bubbles, whose clock is this device's", () => {
    // A temp row stamped from a fast local clock would otherwise become the
    // catch-up cursor and silently skip everything written in between.
    const out = newestServerTimestamp([msg("a", T(2)), msg("temp-1", T(9))]);
    expect(out).toBe(T(2));
  });

  it("is null for an empty or all-optimistic list", () => {
    expect(newestServerTimestamp([])).toBeNull();
    expect(newestServerTimestamp([msg("temp-1", T(1))])).toBeNull();
  });
});

describe("isOptimisticId", () => {
  it("recognises the temp- prefix the composer generates", () => {
    expect(isOptimisticId("temp-abc")).toBe(true);
    expect(isOptimisticId("8f0c-real-uuid")).toBe(false);
  });
});
