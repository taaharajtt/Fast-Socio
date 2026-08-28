import { describe, expect, it, vi } from "vitest";
import {
  createDeckPager,
  restoreCard,
  type DiscoverDeckPage,
  type FetchDeckPage,
} from "@/lib/discover/deck-pager";
import type { DiscoverSwipeCard } from "@/lib/discover/cards";

// ---------------------------------------------------------------------------
// Regression tests for the Discover deck running dry after ~20-30 cards.
//
// The pager is the piece that turns "ask the server again" into "ask the server
// for the NEXT page", so these cover: multi-page traversal of both feeds,
// duplicates across pages, refill/persistence races, overlapping refills, and
// the loading-vs-exhausted distinction that "You're all caught up" hangs on.
// ---------------------------------------------------------------------------

function socioCard(id: string): DiscoverSwipeCard {
  return {
    kind: "socio",
    key: `socio:${id}`,
    id,
    score: 50,
    // Only `key`/`id` matter to the pager; the profile is opaque to it.
    profile: { id } as DiscoverSwipeCard extends { profile: infer P } ? P : never,
  };
}

function intentCard(id: string, createdAt: string): DiscoverSwipeCard {
  return {
    kind: "project_partner",
    key: `intent:${id}`,
    id,
    score: 50,
    reasons: [],
    post: { id, createdAt } as never,
  };
}

function page(over: Partial<DiscoverDeckPage> = {}): DiscoverDeckPage {
  return {
    cards: [],
    socioContinuation: { excludeIds: [] },
    intentContinuation: { cursor: null, cursorId: null },
    socioHasMore: false,
    intentHasMore: false,
    ...over,
  };
}

function socioPage(ids: string[], hasMore: boolean): DiscoverDeckPage {
  return page({
    cards: ids.map(socioCard),
    socioContinuation: { excludeIds: ids },
    socioHasMore: hasMore,
  });
}

/** Collect everything the pager emits across a refill. */
function collector() {
  const out: DiscoverSwipeCard[] = [];
  return { out, emit: (cards: DiscoverSwipeCard[]) => out.push(...cards) };
}

describe("createDeckPager — SOCIO paging", () => {
  it("traverses more than one page of profiles", async () => {
    const pages = [socioPage(["c", "d"], true), socioPage(["e", "f"], false)];
    const fetchPage = vi.fn<FetchDeckPage>(async () => pages.shift() ?? page());
    const pager = createDeckPager({
      initial: socioPage(["a", "b"], true),
      fetchPage,
      socioLimit: 2,
      intentLimit: 0,
    });

    const first = collector();
    await pager.refill(first.emit);
    expect(first.out.map((c) => c.id)).toEqual(["c", "d"]);
    expect(pager.isExhausted).toBe(false);

    const second = collector();
    await pager.refill(second.emit);
    expect(second.out.map((c) => c.id)).toEqual(["e", "f"]);
    expect(pager.isExhausted).toBe(true);
  });

  it("sends the accumulated exclusion set as continuation", async () => {
    const fetchPage = vi.fn<FetchDeckPage>(async () => socioPage(["c", "d"], true));
    const pager = createDeckPager({
      initial: socioPage(["a", "b"], true),
      fetchPage,
      intentLimit: 0,
    });

    await pager.refill(() => {});
    expect(fetchPage.mock.calls[0]![0].socioExclude).toEqual(["a", "b"]);

    await pager.refill(() => {});
    expect(fetchPage.mock.calls[1]![0].socioExclude).toEqual(["a", "b", "c", "d"]);
  });

  it("stops querying a source that reported exhaustion", async () => {
    const fetchPage = vi.fn<FetchDeckPage>(async () => socioPage(["c"], false));
    const pager = createDeckPager({
      initial: page({ socioHasMore: true, intentHasMore: true }),
      fetchPage,
    });
    await pager.refill(() => {});
    expect(fetchPage.mock.calls[0]![0].socioLimit).toBeGreaterThan(0);

    // The page above said socio has more (no) and intent has more (no).
    expect(pager.isExhausted).toBe(true);
  });

  it("does not loop passed profiles indefinitely within one session", async () => {
    // A server that keeps recycling the SAME passed profiles (exclusion set
    // truncated, say) must not keep the deck refilling forever.
    const fetchPage = vi.fn<FetchDeckPage>(async () => socioPage(["a", "b"], true));
    const pager = createDeckPager({
      initial: socioPage(["a", "b"], true),
      fetchPage,
      intentLimit: 0,
      maxEmptyRounds: 3,
    });

    for (let i = 0; i < 10; i++) await pager.refill(() => {});
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(pager.isExhausted).toBe(true);
  });
});

describe("createDeckPager — opportunity paging", () => {
  it("advances the keyset cursor across more than one page", async () => {
    const pages = [
      page({
        cards: [intentCard("p3", "2026-08-03")],
        intentContinuation: { cursor: "2026-08-03", cursorId: "p3" },
        intentHasMore: true,
      }),
      page({
        cards: [intentCard("p4", "2026-08-02")],
        intentContinuation: { cursor: "2026-08-02", cursorId: "p4" },
        intentHasMore: false,
      }),
    ];
    const fetchPage = vi.fn<FetchDeckPage>(async () => pages.shift() ?? page());
    const pager = createDeckPager({
      initial: page({
        cards: [intentCard("p1", "2026-08-05"), intentCard("p2", "2026-08-04")],
        intentContinuation: { cursor: "2026-08-04", cursorId: "p2" },
        intentHasMore: true,
      }),
      fetchPage,
      socioLimit: 0,
    });

    const a = collector();
    await pager.refill(a.emit);
    expect(fetchPage.mock.calls[0]![0]).toMatchObject({
      intentCursor: "2026-08-04",
      intentCursorId: "p2",
    });
    expect(a.out.map((c) => c.id)).toEqual(["p3"]);

    const b = collector();
    await pager.refill(b.emit);
    expect(fetchPage.mock.calls[1]![0]).toMatchObject({
      intentCursor: "2026-08-03",
      intentCursorId: "p3",
    });
    expect(b.out.map((c) => c.id)).toEqual(["p4"]);
    expect(pager.isExhausted).toBe(true);
  });

  it("keeps advancing when eligibility filtering emptied a page", async () => {
    // The page's cards were all filtered out server-side, but the cursor still
    // came back from the last RAW row: the next request must move past it
    // rather than re-reading the same window.
    const pages = [
      page({
        cards: [],
        intentContinuation: { cursor: "2026-08-03", cursorId: "p9" },
        intentHasMore: true,
      }),
      page({
        cards: [intentCard("p10", "2026-08-01")],
        intentContinuation: { cursor: "2026-08-01", cursorId: "p10" },
        intentHasMore: false,
      }),
    ];
    const fetchPage = vi.fn<FetchDeckPage>(async () => pages.shift() ?? page());
    const pager = createDeckPager({
      initial: page({
        intentContinuation: { cursor: "2026-08-04", cursorId: "p2" },
        intentHasMore: true,
      }),
      fetchPage,
      socioLimit: 0,
    });

    await pager.refill(() => {});
    const got = collector();
    await pager.refill(got.emit);
    expect(fetchPage.mock.calls[1]![0].intentCursorId).toBe("p9");
    expect(got.out.map((c) => c.id)).toEqual(["p10"]);
  });
});

describe("createDeckPager — dedupe", () => {
  it("emits only cards unseen this session when pages overlap", async () => {
    const fetchPage = vi.fn<FetchDeckPage>(async () =>
      // "b" was already in the initial page; "c" is new.
      socioPage(["b", "c"], false)
    );
    const pager = createDeckPager({
      initial: socioPage(["a", "b"], true),
      fetchPage,
      intentLimit: 0,
    });

    const got = collector();
    await pager.refill(got.emit);
    expect(got.out.map((c) => c.id)).toEqual(["c"]);
  });
});

describe("createDeckPager — refill coordination", () => {
  it("queues a refill requested while one is running instead of dropping it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const pages = [socioPage(["c"], true), socioPage(["d"], false)];
    const fetchPage = vi.fn<FetchDeckPage>(async () => {
      if (fetchPage.mock.calls.length === 1) await gate;
      return pages.shift() ?? page();
    });
    const pager = createDeckPager({
      initial: socioPage(["a"], true),
      fetchPage,
      intentLimit: 0,
    });

    const got = collector();
    const first = pager.refill(got.emit);
    // Second request lands mid-flight — it must not be silently discarded.
    const second = pager.refill(got.emit);
    release();
    await Promise.all([first, second]);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(got.out.map((c) => c.id)).toEqual(["c", "d"]);
  });

  it("a refill racing swipe persistence still runs after the swipe settles", async () => {
    // Models the client sequence: a refill starts as the deck drains, then the
    // last swipe finishes persisting and asks for another one.
    const pages = [socioPage(["c"], true), socioPage(["d"], false)];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchPage = vi.fn<FetchDeckPage>(async () => {
      if (fetchPage.mock.calls.length === 1) await gate;
      return pages.shift() ?? page();
    });
    const pager = createDeckPager({
      initial: socioPage(["a"], true),
      fetchPage,
      intentLimit: 0,
    });

    const got = collector();
    const inflight = pager.refill(got.emit);

    // "swipe persists", then the post-persist refill fires.
    await Promise.resolve();
    const afterSwipe = pager.refill(got.emit);
    release();
    await Promise.all([inflight, afterSwipe]);

    expect(got.out.map((c) => c.id)).toEqual(["c", "d"]);
    expect(pager.isRefilling).toBe(false);
  });

  it("reports refilling, not exhaustion, while a fetch is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchPage = vi.fn<FetchDeckPage>(async () => {
      await gate;
      return socioPage([], false);
    });
    const pager = createDeckPager({
      initial: socioPage(["a"], true),
      fetchPage,
      intentLimit: 0,
    });

    const running = pager.refill(() => {});
    expect(pager.isRefilling).toBe(true);
    // Deck may be locally empty here — but this is LOADING, not caught up.
    expect(pager.isExhausted).toBe(false);

    release();
    await running;
    expect(pager.isRefilling).toBe(false);
    expect(pager.isExhausted).toBe(true);
  });

  it("is not exhausted merely because the local deck emptied", () => {
    const pager = createDeckPager({
      initial: socioPage(["a"], true),
      fetchPage: async () => page(),
      intentLimit: 0,
    });
    expect(pager.isExhausted).toBe(false);
  });

  it("survives a failing fetch without spinning forever", async () => {
    const fetchPage = vi.fn<FetchDeckPage>(async () => {
      throw new Error("network");
    });
    const onError = vi.fn();
    const pager = createDeckPager({
      initial: socioPage(["a"], true),
      fetchPage,
      intentLimit: 0,
      maxEmptyRounds: 2,
      onError,
    });

    for (let i = 0; i < 5; i++) await pager.refill(() => {});
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(pager.isExhausted).toBe(true);
  });

  it("forget() lets a restored card be delivered again", async () => {
    const fetchPage = vi.fn<FetchDeckPage>(async () => socioPage(["a"], false));
    const pager = createDeckPager({
      initial: socioPage(["a"], true),
      fetchPage,
      intentLimit: 0,
    });

    pager.forget("socio:a");
    const got = collector();
    await pager.refill(got.emit);
    expect(got.out.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("restoreCard — failed swipe persistence", () => {
  it("puts a card whose swipe did not persist back on top", () => {
    const a = socioCard("a");
    const b = socioCard("b");
    expect(restoreCard([b], a).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("never duplicates a card that is already in the deck", () => {
    const a = socioCard("a");
    expect(restoreCard([a], a)).toHaveLength(1);
  });

  it("a restored card is still reachable — it was never traversed", async () => {
    // The full client contract: the swipe failed, the card came back, and a
    // later refill must not treat it as consumed.
    const a = socioCard("a");
    const pager = createDeckPager({
      initial: socioPage(["a", "b"], true),
      fetchPage: async () => socioPage(["c"], false),
      intentLimit: 0,
    });
    const deck = restoreCard([socioCard("b")], a);
    expect(deck.map((c) => c.id)).toEqual(["a", "b"]);

    const got = collector();
    await pager.refill(got.emit);
    // The refill appends only genuinely new cards; "a" stays where it is.
    expect(got.out.map((c) => c.id)).toEqual(["c"]);
  });
});

describe("createDeckPager — tiered SOCIO source", () => {
  it("keeps paging past a SHORT page so the recycle tier is reached", async () => {
    // Mirrors real prod data: one fresh candidate, then the recycle round only
    // opens once that candidate is excluded. Declaring exhaustion on the short
    // page would strand every passed profile.
    const pages = [socioPage(["r1", "r2"], true), socioPage([], false)];
    const fetchPage = vi.fn<FetchDeckPage>(async () => pages.shift() ?? page());
    const pager = createDeckPager({
      initial: socioPage(["fresh1"], true),
      fetchPage,
      socioLimit: 20,
      intentLimit: 0,
    });

    const got = collector();
    await pager.refill(got.emit);
    expect(got.out.map((c) => c.id)).toEqual(["r1", "r2"]);
    expect(pager.isExhausted).toBe(false);

    await pager.refill(() => {});
    expect(pager.isExhausted).toBe(true);
  });
});
