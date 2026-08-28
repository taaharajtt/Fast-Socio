// ===========================================================================
// Client-side duplicate-submission guard for the swipe deck.
//
// One visible card can be acted on from three inputs at once: a drag release,
// a button tap, and a keyboard arrow. All three call the same handler, and the
// handler is async — it advances the deck optimistically and then awaits the
// server action. Between those two moments the card is no longer at the top of
// the deck, but a second event that was already queued still holds a reference
// to it, so the same card could be submitted twice: two writes, two burst-quota
// entries, and an undo stack that no longer matches what the user saw.
//
// The deck already tracked in-flight cards (to keep a refill from re-appending
// a card mid-submit). This makes that set the AUTHORITY on whether a swipe may
// start, in a form that can be unit-tested without React.
//
// NOTE: this is a UX guard, not a security control. Server Actions are
// reachable by direct POST, so the real protection against duplicate storms is
// the server-side burst limiter (`DISCOVER_SWIPE_BURST`).
// ===========================================================================

/**
 * Claim a card for submission. Returns true if the caller now owns it and
 * should proceed, false if a submission for that card is already in flight and
 * this event must be ignored.
 *
 * Call it FIRST in the swipe handler, before any optimistic UI change: an
 * ignored duplicate must not advance the deck, reset the undo timer, or
 * overwrite `lastSwiped`.
 */
export function beginSwipe(inFlight: Set<string>, key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

/** Release a card once its submission has settled, succeeded or failed. */
export function endSwipe(inFlight: Set<string>, key: string): void {
  inFlight.delete(key);
}
