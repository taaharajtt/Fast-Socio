import { describe, expect, it } from "vitest";
import {
  dropOptimistic,
  isOptimisticId,
  mergeMessage,
  mergeMessages,
  newestServerCursor,
  resolveOptimistic,
  sortMessages,
  type MergeableMessage,
} from "@/lib/chat/message-merge";

type M = MergeableMessage & {
  body?: string | null;
  attachment_url?: string | null;
};

const msg = (id: string, created_at: string, extra: Partial<M> = {}): M => ({
  id,
  created_at,
  sender_id: "me",
  ...extra,
});

const T0 = "2026-08-29T10:00:00.000Z";
const T1 = "2026-08-29T10:00:01.000Z";
const T2 = "2026-08-29T10:00:02.000Z";

describe("sortMessages", () => {
  it("orders chronologically", () => {
    const out = sortMessages([msg("c", T2), msg("a", T0), msg("b", T1)]);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks equal timestamps by id, so the order does not depend on arrival", () => {
    const viaRealtime = sortMessages([msg("b", T1), msg("a", T1)]);
    const viaCatchUp = sortMessages([msg("a", T1), msg("b", T1)]);
    expect(viaRealtime.map((m) => m.id)).toEqual(["a", "b"]);
    expect(viaCatchUp.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("mergeMessage", () => {
  it("drops a duplicate id and returns the same array reference", () => {
    const prev = [msg("a", T0)];
    expect(mergeMessage(prev, msg("a", T0))).toBe(prev);
  });

  it("inserts a late-delivered message in the right place, not at the end", () => {
    const prev = [msg("a", T0), msg("c", T2)];
    const out = mergeMessage(prev, msg("b", T1));
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("mergeMessages", () => {
  it("deduplicates a catch-up batch that overlaps what is on screen", () => {
    const prev = [msg("a", T0), msg("b", T1)];
    const out = mergeMessages(prev, [msg("b", T1), msg("c", T2)]);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when every row is already present", () => {
    const prev = [msg("a", T0), msg("b", T1)];
    expect(mergeMessages(prev, [msg("a", T0), msg("b", T1)])).toBe(prev);
  });

  it("deduplicates within the incoming batch itself", () => {
    const out = mergeMessages([], [msg("a", T0), msg("a", T0)]);
    expect(out).toHaveLength(1);
  });
});

describe("resolveOptimistic — the action response wins the race", () => {
  it("rebrands the bubble with its real id", () => {
    const prev = [msg("temp-1", T0, { body: "hi" })];
    const out = resolveOptimistic(prev, "temp-1", { id: "real-1", created_at: T1 });
    expect(out.map((m) => m.id)).toEqual(["real-1"]);
    expect(out[0].body).toBe("hi");
    expect(out[0].created_at).toBe(T1);
  });

  it("then drops the realtime INSERT that follows, as a plain id duplicate", () => {
    const resolved = resolveOptimistic([msg("temp-1", T0)], "temp-1", {
      id: "real-1",
      created_at: T1,
    });
    const out = mergeMessage(resolved, msg("real-1", T1));
    expect(out).toHaveLength(1);
  });
});

describe("resolveOptimistic — realtime wins the race", () => {
  it("removes the bubble instead of duplicating the row", () => {
    const withRealtimeRow = mergeMessage([msg("temp-1", T0)], msg("real-1", T1));
    const out = resolveOptimistic(withRealtimeRow, "temp-1", {
      id: "real-1",
      created_at: T1,
    });
    expect(out.map((m) => m.id)).toEqual(["real-1"]);
  });

  it("carries the local image preview onto the real row so it does not flash", () => {
    const bubble = msg("temp-1", T0, { _localSrc: "blob:preview" });
    const withRealtimeRow = mergeMessage([bubble], msg("real-1", T1));
    const out = resolveOptimistic(withRealtimeRow, "temp-1", {
      id: "real-1",
      created_at: T1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]._localSrc).toBe("blob:preview");
  });
});

describe("two identical messages sent quickly", () => {
  it("keeps both, paired to the right bubbles — the body-text match could not", () => {
    // Both bubbles carry the same text, which is exactly what used to make the
    // old `x.body === m.body` reconciliation pair row 2 with bubble 1.
    let list: M[] = [
      msg("temp-1", T0, { body: "ok" }),
      msg("temp-2", T0, { body: "ok" }),
    ];

    list = resolveOptimistic(list, "temp-1", { id: "real-1", created_at: T1 });
    list = resolveOptimistic(list, "temp-2", { id: "real-2", created_at: T2 });

    expect(list.map((m) => m.id)).toEqual(["real-1", "real-2"]);

    // The two realtime INSERTs then arrive, in either order, and change nothing.
    list = mergeMessage(list, msg("real-2", T2, { body: "ok" }));
    list = mergeMessage(list, msg("real-1", T1, { body: "ok" }));
    expect(list.map((m) => m.id)).toEqual(["real-1", "real-2"]);
  });

  it("survives realtime beating the second response", () => {
    let list: M[] = [
      msg("temp-1", T0, { body: "ok" }),
      msg("temp-2", T0, { body: "ok" }),
    ];
    // Socket delivers row 2 before its own action returned.
    list = mergeMessage(list, msg("real-2", T2, { body: "ok" }));
    list = resolveOptimistic(list, "temp-2", { id: "real-2", created_at: T2 });
    list = resolveOptimistic(list, "temp-1", { id: "real-1", created_at: T1 });
    expect(list.map((m) => m.id)).toEqual(["real-1", "real-2"]);
  });
});

describe("dropOptimistic", () => {
  it("removes a failed bubble and leaves everything else", () => {
    const out = dropOptimistic([msg("a", T0), msg("temp-1", T1)], "temp-1");
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });
});

describe("newestServerCursor", () => {
  it("is null for an empty conversation, so the caller fetches the latest page", () => {
    expect(newestServerCursor([])).toBeNull();
  });

  it("ignores optimistic bubbles, whose clock may run ahead of the database", () => {
    const cursor = newestServerCursor([
      msg("real-1", T1),
      msg("temp-1", "2030-01-01T00:00:00.000Z"),
    ]);
    expect(cursor).toEqual({ createdAt: T1, id: "real-1" });
  });

  it("breaks a timestamp tie by id, so an equal-timestamp row is not skipped", () => {
    const cursor = newestServerCursor([msg("a", T1), msg("b", T1)]);
    expect(cursor).toEqual({ createdAt: T1, id: "b" });
  });

  it("is null when only unsent bubbles are on screen", () => {
    expect(newestServerCursor([msg("temp-1", T0)])).toBeNull();
  });
});

describe("isOptimisticId", () => {
  it("recognises the temp prefix and nothing else", () => {
    expect(isOptimisticId("temp-abc")).toBe(true);
    expect(isOptimisticId("00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});
