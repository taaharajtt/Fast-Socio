import { describe, expect, it } from "vitest";
import {
  HISTORY_FETCH_SIZE,
  HISTORY_PAGE_SIZE,
  canLoadEarlier,
  oldestServerCursor,
  reconcileWithServerWindow,
  restoredScrollTop,
  takeHistoryPage,
} from "./history";
import { mergeMessages, newestServerCursor, sortMessages } from "./message-merge";
import { olderThanFilter } from "./keyset";

type Row = { id: string; created_at: string; body?: string };

/** `n` rows one minute apart, oldest first. `row-0` is the oldest. */
function rows(n: number, startMs = Date.UTC(2026, 0, 1)): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `row-${String(i).padStart(3, "0")}`,
    created_at: new Date(startMs + i * 60_000).toISOString(),
    body: `m${i}`,
  }));
}

/** What the database hands back for a page: newest-first, size + 1 rows. */
function serverPage(all: Row[], before: Row | null, fetch = HISTORY_FETCH_SIZE) {
  const older = before
    ? all.filter(
        (r) =>
          r.created_at < before.created_at ||
          (r.created_at === before.created_at && r.id < before.id)
      )
    : all;
  return [...older].reverse().slice(0, fetch);
}

describe("a page is the newest ten, in display order", () => {
  it("shows ten and reports more when an eleventh came back", () => {
    const page = takeHistoryPage(serverPage(rows(40), null));
    expect(page.items).toHaveLength(HISTORY_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it("returns them oldest-first even though the query was newest-first", () => {
    const page = takeHistoryPage(serverPage(rows(40), null));
    expect(page.items).toEqual(sortMessages(page.items));
    expect(page.items[0].id).toBe("row-030");
    expect(page.items[9].id).toBe("row-039");
  });

  it("is the LATEST ten, not the oldest ten", () => {
    // The bug this replaces: the loaders ordered ascending and took the first
    // 100, so a busy room opened on its first hundred messages and could never
    // reach the newest one.
    const page = takeHistoryPage(serverPage(rows(40), null));
    expect(page.items.at(-1)!.id).toBe("row-039");
  });

  it("reports no more when the extra probe row did not come back", () => {
    const page = takeHistoryPage(serverPage(rows(10), null));
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(false);
  });

  it("handles a thread shorter than one page", () => {
    const page = takeHistoryPage(serverPage(rows(3), null));
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(false);
  });

  it("handles an empty thread", () => {
    const page = takeHistoryPage<Row>([]);
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("fetches exactly one more than it shows", () => {
    expect(HISTORY_FETCH_SIZE).toBe(HISTORY_PAGE_SIZE + 1);
  });
});

describe("pressing the capsule walks backwards ten at a time", () => {
  it("loads the correct previous ten on each press, in order, with no gaps", () => {
    const all = rows(35);
    let onScreen = takeHistoryPage(serverPage(all, null)).items;
    expect(onScreen.map((m) => m.id)).toEqual(
      all.slice(25).map((m) => m.id)
    );

    for (const expectedStart of [15, 5]) {
      const cursor = oldestServerCursor(onScreen)!;
      const anchor = all.find((r) => r.id === cursor.id)!;
      const page = takeHistoryPage(serverPage(all, anchor));
      expect(page.items).toHaveLength(10);
      onScreen = mergeMessages(onScreen, page.items);
      expect(onScreen.map((m) => m.id)).toEqual(
        all.slice(expectedStart).map((m) => m.id)
      );
    }

    // 35 rows, 10 + 10 + 10 loaded: five left, so one more press exhausts it.
    const cursor = oldestServerCursor(onScreen)!;
    const anchor = all.find((r) => r.id === cursor.id)!;
    const last = takeHistoryPage(serverPage(all, anchor));
    expect(last.items).toHaveLength(5);
    expect(last.hasMore).toBe(false);
    onScreen = mergeMessages(onScreen, last.items);
    expect(onScreen).toHaveLength(35);
  });

  it("stays chronologically ordered after every prepend", () => {
    const all = rows(25);
    let onScreen = takeHistoryPage(serverPage(all, null)).items;
    for (let i = 0; i < 2; i++) {
      const anchor = all.find((r) => r.id === oldestServerCursor(onScreen)!.id)!;
      onScreen = mergeMessages(onScreen, takeHistoryPage(serverPage(all, anchor)).items);
      expect(onScreen).toEqual(sortMessages(onScreen));
    }
  });

  it("never serves the cursor row itself again", () => {
    const all = rows(25);
    const first = takeHistoryPage(serverPage(all, null)).items;
    const anchor = all.find((r) => r.id === oldestServerCursor(first)!.id)!;
    const second = takeHistoryPage(serverPage(all, anchor));
    expect(second.items.some((m) => m.id === anchor.id)).toBe(false);
  });

  it("cannot duplicate a row even if a page is served twice", () => {
    const all = rows(25);
    const first = takeHistoryPage(serverPage(all, null)).items;
    const anchor = all.find((r) => r.id === oldestServerCursor(first)!.id)!;
    const page = takeHistoryPage(serverPage(all, anchor)).items;

    const once = mergeMessages(first, page);
    const twice = mergeMessages(once, page);
    expect(twice).toHaveLength(once.length);
    expect(new Set(twice.map((m) => m.id)).size).toBe(twice.length);
  });
});

describe("the (created_at, id) tiebreaker", () => {
  const sameInstant = "2026-03-01T10:00:00.000Z";
  const tied: Row[] = [
    { id: "aaa", created_at: sameInstant },
    { id: "bbb", created_at: sameInstant },
    { id: "ccc", created_at: sameInstant },
  ];

  it("picks the lowest id as the oldest when timestamps are identical", () => {
    expect(oldestServerCursor(tied)).toEqual({
      createdAt: sameInstant,
      id: "aaa",
    });
  });

  it("pages through tied rows without repeating or skipping one", () => {
    // One row per page, so every step has to be decided by the id alone.
    let onScreen = takeHistoryPage([...tied].reverse(), 1).items;
    expect(onScreen.map((m) => m.id)).toEqual(["ccc"]);

    for (let i = 0; i < 2; i++) {
      const cursor = oldestServerCursor(onScreen)!;
      const older = tied.filter(
        (r) =>
          r.created_at < cursor.createdAt ||
          (r.created_at === cursor.createdAt && r.id < cursor.id)
      );
      const page = takeHistoryPage([...older].reverse(), 1);
      onScreen = mergeMessages(onScreen, page.items);
    }
    expect(onScreen.map((m) => m.id)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("asks the database for the same order it sorts by", () => {
    // The SQL half of the same rule: strictly-older over the pair.
    const filter = olderThanFilter({ createdAt: sameInstant, id: "bbb" });
    expect(filter).toBe(
      `created_at.lt."${sameInstant}",and(created_at.eq."${sameInstant}",id.lt."bbb")`
    );
  });

  it("quotes the values, because a timestamp contains a +", () => {
    const filter = olderThanFilter({
      createdAt: "2026-07-14T18:15:46.842105+00:00",
      id: "2548a34b-ec56-4f28-baef-8243dfd05dc9",
    });
    expect(filter).toContain('"2026-07-14T18:15:46.842105+00:00"');
    expect(filter).toContain('"2548a34b-ec56-4f28-baef-8243dfd05dc9"');
  });

  it("refuses a value that would break out of the literal", () => {
    expect(() =>
      olderThanFilter({ createdAt: '2026-01-01","x', id: "a" })
    ).toThrow();
  });
});

describe("the cursor is taken from server rows only", () => {
  it("ignores an optimistic bubble, whatever this device's clock says", () => {
    const withPending: Row[] = [
      { id: "temp-1", created_at: "1999-01-01T00:00:00.000Z" },
      ...rows(3),
    ];
    expect(oldestServerCursor(withPending)!.id).toBe("row-000");
  });

  it("is null when nothing server-backed is on screen", () => {
    expect(
      oldestServerCursor([{ id: "temp-1", created_at: "2026-01-01T00:00:00Z" }])
    ).toBeNull();
  });

  it("is the mirror of the catch-up cursor, not a duplicate of it", () => {
    const list = rows(5);
    expect(oldestServerCursor(list)!.id).toBe("row-000");
    expect(newestServerCursor(list)!.id).toBe("row-004");
  });
});

describe("scroll preservation", () => {
  it("compensates exactly for the height the prepend added", () => {
    // The reader was 500px down a 2000px list; ten older messages added 800px
    // above them, so their message is now at 1300.
    expect(
      restoredScrollTop({
        scrollTopBefore: 500,
        scrollHeightBefore: 2000,
        scrollHeightAfter: 2800,
      })
    ).toBe(1300);
  });

  it("does NOT send the reader to the newly loaded oldest message", () => {
    const restored = restoredScrollTop({
      scrollTopBefore: 500,
      scrollHeightBefore: 2000,
      scrollHeightAfter: 2800,
    });
    expect(restored).not.toBe(0);
  });

  it("does NOT send the reader to the bottom", () => {
    const after = 2800;
    const clientHeight = 600;
    const restored = restoredScrollTop({
      scrollTopBefore: 500,
      scrollHeightBefore: 2000,
      scrollHeightAfter: after,
    });
    expect(restored).not.toBe(after - clientHeight);
  });

  it("keeps a reader who was at the very top pinned to the same message", () => {
    expect(
      restoredScrollTop({
        scrollTopBefore: 0,
        scrollHeightBefore: 1000,
        scrollHeightAfter: 1800,
      })
    ).toBe(800);
  });

  it("holds a reader who was at the bottom in place, rather than following", () => {
    // At the bottom: scrollTop 1400 of a 2000px list in a 600px viewport.
    // After 800px of history the same message must still be at the bottom.
    const restored = restoredScrollTop({
      scrollTopBefore: 1400,
      scrollHeightBefore: 2000,
      scrollHeightAfter: 2800,
    });
    expect(restored).toBe(2200);
    expect(2800 - restored - 600).toBe(0);
  });

  it("clamps a nonsense measurement instead of handing the DOM a negative", () => {
    expect(
      restoredScrollTop({
        scrollTopBefore: 0,
        scrollHeightBefore: 2000,
        scrollHeightAfter: 100,
      })
    ).toBe(0);
  });
});

describe("repeated taps", () => {
  const cursor = { createdAt: "2026-01-01T00:00:00.000Z", id: "row-000" };

  it("allows the first press", () => {
    expect(canLoadEarlier({ status: "idle", inFlight: false, cursor })).toBe(true);
  });

  it("refuses a second press while the first is in flight", () => {
    expect(canLoadEarlier({ status: "idle", inFlight: true, cursor })).toBe(false);
    expect(canLoadEarlier({ status: "loading", inFlight: false, cursor })).toBe(
      false
    );
  });

  it("refuses once the history is exhausted", () => {
    expect(
      canLoadEarlier({ status: "exhausted", inFlight: false, cursor })
    ).toBe(false);
  });

  it("ALLOWS a press after a failure — that is the retry", () => {
    expect(canLoadEarlier({ status: "error", inFlight: false, cursor })).toBe(
      true
    );
  });

  it("refuses when there is no server-backed row to page from", () => {
    expect(canLoadEarlier({ status: "idle", inFlight: false, cursor: null })).toBe(
      false
    );
  });
});

describe("pagination and realtime overlapping", () => {
  it("does not duplicate a row that arrives by both routes", () => {
    const all = rows(25);
    const onScreen = takeHistoryPage(serverPage(all, null)).items;
    // A live INSERT lands while a history page is in flight...
    const live: Row = { id: "row-100", created_at: new Date(Date.UTC(2026, 0, 2)).toISOString() };
    const withLive = mergeMessages(onScreen, [live]);
    // ...and the history page happens to include it too (a catch-up window
    // overlapping the same rows).
    const anchor = all.find((r) => r.id === oldestServerCursor(onScreen)!.id)!;
    const page = takeHistoryPage(serverPage(all, anchor)).items;
    const merged = mergeMessages(withLive, [...page, live]);

    expect(merged.filter((m) => m.id === live.id)).toHaveLength(1);
    expect(new Set(merged.map((m) => m.id)).size).toBe(merged.length);
    expect(merged).toEqual(sortMessages(merged));
  });

  it("keeps a live message newest even after older history is prepended", () => {
    const all = rows(25);
    let onScreen = takeHistoryPage(serverPage(all, null)).items;
    const live: Row = { id: "zzz", created_at: new Date(Date.UTC(2026, 0, 3)).toISOString() };
    onScreen = mergeMessages(onScreen, [live]);
    const anchor = all.find((r) => r.id === oldestServerCursor(onScreen)!.id)!;
    onScreen = mergeMessages(onScreen, takeHistoryPage(serverPage(all, anchor)).items);
    expect(onScreen.at(-1)!.id).toBe("zzz");
  });
});

describe("a revalidation must not swallow loaded history", () => {
  it("keeps rows older than the server's window", () => {
    const all = rows(30);
    // The reader has paged back to row-010.
    const onScreen = all.slice(10);
    // A revalidation hands down only the newest ten.
    const server = all.slice(20);
    const next = reconcileWithServerWindow(onScreen, server);
    expect(next.map((m) => m.id)).toEqual(onScreen.map((m) => m.id));
  });

  it("lets the server win INSIDE its window, so an edit still lands", () => {
    const all = rows(30);
    const onScreen = all.slice(10);
    const edited = { ...all[25], body: "edited" };
    const server = all.slice(20).map((m) => (m.id === edited.id ? edited : m));
    const next = reconcileWithServerWindow(onScreen, server);
    expect(next.find((m) => m.id === edited.id)!.body).toBe("edited");
  });

  it("drops a row the server deleted from inside its window", () => {
    const all = rows(30);
    const onScreen = all.slice(10);
    const server = all.slice(20).filter((m) => m.id !== "row-025");
    const next = reconcileWithServerWindow(onScreen, server);
    expect(next.some((m) => m.id === "row-025")).toBe(false);
    // ...while the older history is untouched.
    expect(next.some((m) => m.id === "row-010")).toBe(true);
  });

  it("carries an in-flight optimistic bubble over", () => {
    const all = rows(15);
    const pending: Row = { id: "temp-9", created_at: new Date(Date.UTC(2026, 1, 1)).toISOString() };
    const next = reconcileWithServerWindow([...all, pending], all.slice(5));
    expect(next.some((m) => m.id === "temp-9")).toBe(true);
  });

  it("keeps the thread rather than blanking it on an empty revalidation", () => {
    const all = rows(12);
    expect(reconcileWithServerWindow(all, [])).toEqual(all);
  });

  it("stays sorted and deduplicated", () => {
    const all = rows(30);
    const next = reconcileWithServerWindow(all.slice(10), all.slice(20));
    expect(next).toEqual(sortMessages(next));
    expect(new Set(next.map((m) => m.id)).size).toBe(next.length);
  });
});
