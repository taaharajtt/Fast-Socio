import type { DiscoverSwipeCard } from "@/lib/discover/cards";

// ===========================================================================
// Deck continuation + refill coordination — the pure half of "the deck never
// runs out early".
//
// Discover has TWO independent server feeds (SOCIO candidates, opportunity
// posts) and one client deck. Neither feed used to carry continuation state
// across a top-up: the client re-asked for page one, filtered the answer
// against the cards it had already shown, kept nothing, and concluded it was
// "all caught up" after ~20-30 cards.
//
// This module owns the state that makes a top-up mean "the NEXT page":
//   * the SOCIO exclusion set (ids already delivered — see migration 0157),
//   * the opportunity keyset cursor `(created_at, id)`,
//   * per-source has-more flags, which are the ONLY authority on exhaustion,
//   * refill serialisation with a single-slot queue, so a refill requested
//     while one is in flight is deferred rather than dropped,
//   * an empty-round counter, so a server that keeps answering with cards we
//     have already seen cannot spin the client forever.
//
// Pure and dependency-free (the page fetch is injected) so every one of those
// behaviours is unit-testable without React, Next or a database.
// ===========================================================================

/** Continuation for the SOCIO candidate RPC: ids the client already holds. */
export type SocioContinuation = { excludeIds: string[] };

/** Keyset continuation for the opportunity feed. */
export type IntentContinuation = {
  cursor: string | null;
  cursorId: string | null;
};

/** One page of the deck, exactly as `getDiscoverSwipeDeck` returns it. */
export type DiscoverDeckPage = {
  cards: DiscoverSwipeCard[];
  socioContinuation: SocioContinuation;
  intentContinuation: IntentContinuation;
  socioHasMore: boolean;
  intentHasMore: boolean;
};

/** What the pager asks the server for. */
export type DeckPageRequest = {
  socioExclude: string[];
  intentCursor: string | null;
  intentCursorId: string | null;
  /** 0 means "this source is exhausted, don't query it". */
  socioLimit: number;
  intentLimit: number;
};

export type FetchDeckPage = (req: DeckPageRequest) => Promise<DiscoverDeckPage>;

export const EMPTY_DECK_PAGE: DiscoverDeckPage = {
  cards: [],
  socioContinuation: { excludeIds: [] },
  intentContinuation: { cursor: null, cursorId: null },
  socioHasMore: false,
  intentHasMore: false,
};

export type DeckPagerOptions = {
  initial: DiscoverDeckPage;
  fetchPage: FetchDeckPage;
  socioLimit?: number;
  intentLimit?: number;
  /**
   * How many consecutive refills may return nothing new before the pager
   * declares itself done. A server that keeps handing back cards this session
   * has already shown (a stale exclusion set, a cursor that cannot advance)
   * would otherwise be refilled against forever.
   */
  maxEmptyRounds?: number;
  /** Reported to the caller when a refill throws. */
  onError?: (error: unknown) => void;
};

export type DeckPager = {
  /**
   * Fetch the next page(s). `emit` is called once per completed round with the
   * cards that are new to this session, in deck order. Resolves when this call
   * AND anything it queued has finished, so awaiting it is a real barrier.
   */
  refill(emit: (cards: DiscoverSwipeCard[]) => void): Promise<void>;
  /** True while a fetch is in flight or a follow-up round is queued. */
  readonly isRefilling: boolean;
  /**
   * True only when both feeds have authoritatively reported exhaustion (or the
   * empty-round guard has tripped) AND nothing is in flight. This — never "the
   * local array is empty" — is what "You're all caught up" may key off.
   */
  readonly isExhausted: boolean;
  /** Mark a card as no longer shown, so a restore can re-add it cleanly. */
  forget(key: string): void;
  /** Test/debug view of the continuation the next refill would send. */
  peek(): DeckPageRequest;
};

export function createDeckPager({
  initial,
  fetchPage,
  socioLimit = 20,
  intentLimit = 40,
  maxEmptyRounds = 3,
  onError,
}: DeckPagerOptions): DeckPager {
  // Every card key handed to the deck this session. Passed profiles are
  // recycled by the RPC, so without this a session could loop them; combined
  // with the server-side exclusion set, the recycle round now runs at most once
  // per mounted session and then stops.
  const seen = new Set(initial.cards.map((c) => c.key));
  const excludeIds = new Set(initial.socioContinuation.excludeIds);
  let intentCursor = initial.intentContinuation.cursor;
  let intentCursorId = initial.intentContinuation.cursorId;
  let socioHasMore = initial.socioHasMore;
  let intentHasMore = initial.intentHasMore;

  let running: Promise<void> | null = null;
  let queued = false;
  let emptyRounds = 0;

  function request(): DeckPageRequest {
    return {
      socioExclude: [...excludeIds],
      intentCursor,
      intentCursorId,
      socioLimit: socioHasMore ? socioLimit : 0,
      intentLimit: intentHasMore ? intentLimit : 0,
    };
  }

  function exhausted(): boolean {
    return (!socioHasMore && !intentHasMore) || emptyRounds >= maxEmptyRounds;
  }

  async function round(emit: (cards: DiscoverSwipeCard[]) => void) {
    if (exhausted()) return;
    const req = request();
    let page: DiscoverDeckPage;
    try {
      page = await fetchPage(req);
    } catch (error) {
      // A failed round counts as empty: the deck stays refillable, but a
      // permanently failing endpoint cannot be hammered indefinitely.
      emptyRounds += 1;
      onError?.(error);
      return;
    }

    // Advance continuation only for the sources we actually asked about, so a
    // source that is already done can't have its flag resurrected by a page
    // that never queried it.
    if (req.socioLimit > 0) {
      for (const id of page.socioContinuation.excludeIds) excludeIds.add(id);
      socioHasMore = page.socioHasMore;
    }
    if (req.intentLimit > 0) {
      // The cursor comes from the LAST RAW row of the page, before eligibility
      // filtering, so filtered-out posts advance the cursor instead of being
      // re-fetched or causing the next page to skip real cards.
      if (page.intentContinuation.cursor) {
        intentCursor = page.intentContinuation.cursor;
        intentCursorId = page.intentContinuation.cursorId;
      }
      intentHasMore = page.intentHasMore;
    }

    const fresh = page.cards.filter((c) => !seen.has(c.key));
    for (const c of fresh) seen.add(c.key);
    if (fresh.length === 0) emptyRounds += 1;
    else emptyRounds = 0;
    if (fresh.length) emit(fresh);
  }

  async function drain(emit: (cards: DiscoverSwipeCard[]) => void) {
    do {
      queued = false;
      await round(emit);
    } while (queued && !exhausted());
    running = null;
  }

  return {
    refill(emit) {
      if (running) {
        // Don't drop the request — the swipe that triggered it may have been
        // the one that emptied the deck. Ask the in-flight run to go again.
        queued = true;
        return running;
      }
      if (exhausted()) return Promise.resolve();
      running = drain(emit);
      return running;
    },
    get isRefilling() {
      return running !== null;
    },
    get isExhausted() {
      return exhausted() && running === null;
    },
    forget(key) {
      seen.delete(key);
    },
    peek: request,
  };
}

/**
 * Put an optimistically-removed card back at the top of the deck. Used when a
 * swipe fails to persist: a card whose decision was never written must not be
 * counted as traversed, and must not be duplicated if it is somehow still in
 * the deck.
 */
export function restoreCard(
  deck: DiscoverSwipeCard[],
  card: DiscoverSwipeCard
): DiscoverSwipeCard[] {
  return deck.some((c) => c.key === card.key) ? deck : [card, ...deck];
}
