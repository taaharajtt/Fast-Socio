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

/**
 * UAT-11 — the arrival orders that actually produce duplicates in the wild.
 *
 * These are written against the shared helpers now that the community room, the
 * society broadcast and the event thread use them too: each of those surfaces
 * previously had its own `prev.some(id) ? prev : [...prev, row]`, which
 * deduplicates but appends, so a catch-up read racing a live event rendered the
 * thread out of order.
 */
describe("UAT-11 realtime / optimistic races", () => {
  const row = (id: string, created_at: string, body = "hi") => ({
    id,
    created_at,
    sender_id: "me",
    body,
  });

  it("keeps two intentionally identical messages as two messages", () => {
    // The regression the id-based reconcile exists for: matching by BODY TEXT
    // collapsed "ok" sent twice into one bubble.
    const a = row("1", "2026-01-01T00:00:00.000Z", "ok");
    const b = row("2", "2026-01-01T00:00:01.000Z", "ok");
    const merged = mergeMessages([a], [b]);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("orders correctly when the catch-up read lands AFTER the live event", () => {
    const older = row("a", "2026-01-01T00:00:00.000Z");
    const newer = row("b", "2026-01-01T00:00:05.000Z");
    // Live event first (the newer row), then the catch-up delivering the older.
    const merged = mergeMessages(mergeMessage([], newer), [older]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("orders correctly when the same two arrive in the opposite order", () => {
    const older = row("a", "2026-01-01T00:00:00.000Z");
    const newer = row("b", "2026-01-01T00:00:05.000Z");
    const merged = mergeMessage(mergeMessages([], [older]), newer);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("is idempotent across a reconnect replay of an overlapping page", () => {
    // A catch-up after a dropped socket re-delivers rows already on screen.
    const page = [
      row("a", "2026-01-01T00:00:00.000Z"),
      row("b", "2026-01-01T00:00:01.000Z"),
      row("c", "2026-01-01T00:00:02.000Z"),
    ];
    const once = mergeMessages([], page);
    const twice = mergeMessages(once, page.slice(1));
    expect(twice).toHaveLength(3);
    expect(twice).toBe(once); // nothing new ⇒ same reference, no re-render
  });

  it("keeps rows sharing a timestamp stable whichever way they arrive", () => {
    // Two rows written in the same microsecond. Without the id tiebreak these
    // swap places depending on which route delivered them first.
    const ts = "2026-01-01T00:00:00.000Z";
    const x = row("x", ts);
    const y = row("y", ts);
    expect(mergeMessages([], [x, y]).map((m) => m.id)).toEqual(["x", "y"]);
    expect(mergeMessages([], [y, x]).map((m) => m.id)).toEqual(["x", "y"]);
  });

  it("works on a row with no sender_id at all", () => {
    // The broadcast surface has `author_id`, not `sender_id`. Requiring it in
    // the type is what kept these surfaces on their own append logic.
    const merged = mergeMessage([], {
      id: "ann-1",
      created_at: "2026-01-01T00:00:00.000Z",
      author_id: "someone",
    });
    expect(merged).toHaveLength(1);
  });
});
