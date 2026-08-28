import { describe, it, expect } from "vitest";
import { beginSwipe, endSwipe } from "./swipe-guard";
import { restoreCard } from "./deck-pager";
import type { DiscoverSwipeCard } from "./cards";

const card = (id: string): DiscoverSwipeCard =>
  ({
    kind: "socio",
    key: `socio:${id}`,
    id,
    score: 0,
    profile: { id } as DiscoverSwipeCard extends { profile: infer P } ? P : never,
  }) as DiscoverSwipeCard;

describe("beginSwipe", () => {
  it("lets the first event through and blocks the rest for that card", () => {
    const inFlight = new Set<string>();
    expect(beginSwipe(inFlight, "socio:a")).toBe(true);
    expect(beginSwipe(inFlight, "socio:a")).toBe(false);
    expect(beginSwipe(inFlight, "socio:a")).toBe(false);
  });

  it("does not block a different card", () => {
    const inFlight = new Set<string>();
    expect(beginSwipe(inFlight, "socio:a")).toBe(true);
    expect(beginSwipe(inFlight, "socio:b")).toBe(true);
  });

  it("collapses drag + button + keyboard on one card to a single submission", () => {
    // The three real inputs, all firing for the visible card before the first
    // server round-trip settles.
    const inFlight = new Set<string>();
    const submissions: string[] = [];
    const handler = (key: string) => {
      if (!beginSwipe(inFlight, key)) return;
      submissions.push(key);
    };
    handler("socio:top"); // drag release
    handler("socio:top"); // button tap
    handler("socio:top"); // ArrowRight
    expect(submissions).toEqual(["socio:top"]);
  });

  it("lets the card be acted on again once its submission settles", () => {
    // Undo puts a card back at the top; it must be swipeable a second time.
    const inFlight = new Set<string>();
    expect(beginSwipe(inFlight, "socio:a")).toBe(true);
    endSwipe(inFlight, "socio:a");
    expect(beginSwipe(inFlight, "socio:a")).toBe(true);
  });

  it("keeps the card excluded from top-ups while in flight", () => {
    // The set's other job: a refill must not re-append a card mid-submit.
    const inFlight = new Set<string>();
    beginSwipe(inFlight, "socio:a");
    const incoming = ["socio:a", "socio:b"];
    expect(incoming.filter((k) => !inFlight.has(k))).toEqual(["socio:b"]);
  });

  it("charges exactly one quota event per card under a duplicate storm", () => {
    // 50 duplicate events across 3 cards must produce 3 server calls, not 50.
    const inFlight = new Set<string>();
    let serverCalls = 0;
    for (let i = 0; i < 50; i++) {
      const key = `socio:${i % 3}`;
      if (beginSwipe(inFlight, key)) serverCalls += 1;
    }
    expect(serverCalls).toBe(3);
  });
});

describe("endSwipe", () => {
  it("is safe to call for a card that was never claimed", () => {
    const inFlight = new Set<string>();
    expect(() => endSwipe(inFlight, "socio:ghost")).not.toThrow();
    expect(inFlight.size).toBe(0);
  });
});

describe("a swipe that did not persist", () => {
  it("releases the card and puts it back at the top of the deck", () => {
    // Mirrors the deck's `restore` path: release the claim, re-add the card.
    const inFlight = new Set<string>();
    const top = card("a");
    const deck: DiscoverSwipeCard[] = [card("b"), card("c")];

    beginSwipe(inFlight, top.key);
    // ...server said no (burst guard, or a write failure)...
    endSwipe(inFlight, top.key);
    const restored = restoreCard(deck, top);

    expect(restored.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(inFlight.has(top.key)).toBe(false);
    // And it can be swiped again immediately.
    expect(beginSwipe(inFlight, top.key)).toBe(true);
  });

  it("does not duplicate a card that is somehow still in the deck", () => {
    const top = card("a");
    expect(restoreCard([top, card("b")], top).map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
