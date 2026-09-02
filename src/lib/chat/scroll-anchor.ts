/**
 * When a conversation should follow new messages, and when it must not (UAT-06).
 *
 * THE RULE, in one sentence: auto-scroll only when the reader is already at the
 * bottom, or when the new message is their own.
 *
 * Everything else is a way of getting that wrong:
 *
 *  * Always scrolling yanks a reader out of the history they were reading — the
 *    single most common complaint about chat UIs, and unrecoverable, because the
 *    scroll position they lost is not recorded anywhere.
 *  * Never scrolling means a reader sitting at the bottom watches messages
 *    arrive below the fold.
 *  * Scrolling only on an EXACT bottom never fires: `scrollHeight` is
 *    fractional, momentum scrolling overshoots, and a virtual keyboard changes
 *    the client height mid-gesture. Hence a threshold, not an equality.
 *
 * Pure and DOM-free so the decision is testable without a browser; the caller
 * passes the three numbers it already has from the scroll container.
 */

export type ScrollMetrics = {
  /** Distance from the top of the content to the top of the viewport. */
  scrollTop: number;
  /** Height of the visible region. */
  clientHeight: number;
  /** Total height of the content. */
  scrollHeight: number;
};

/**
 * How close to the bottom still counts as "at the bottom".
 *
 * Roughly one short message bubble. Small enough that a reader who has scrolled
 * up to read something is not dragged back down; large enough to absorb
 * sub-pixel rounding, momentum overshoot and the one-or-two-pixel drift a
 * keyboard animation leaves behind.
 */
export const BOTTOM_THRESHOLD_PX = 80;

/** Pixels of content below the fold. Zero (or less) means pinned to the end. */
export function distanceFromBottom(m: ScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.scrollTop - m.clientHeight);
}

/** Is the reader effectively at the bottom of the thread? */
export function isNearBottom(
  m: ScrollMetrics,
  threshold = BOTTOM_THRESHOLD_PX
): boolean {
  return distanceFromBottom(m) <= threshold;
}

export type AutoScrollInput = {
  metrics: ScrollMetrics;
  /** True when the new message was sent by the person reading. */
  fromSelf: boolean;
  /** True for the first paint of a thread, which always opens at the latest. */
  initial?: boolean;
  threshold?: number;
};

/**
 * Should the thread scroll to the newest message?
 *
 * `fromSelf` overrides position deliberately: sending a message is an explicit
 * statement that you want to be at the bottom, and staying scrolled up after
 * pressing Send reads as the message having failed to send.
 */
export function shouldAutoScroll({
  metrics,
  fromSelf,
  initial = false,
  threshold = BOTTOM_THRESHOLD_PX,
}: AutoScrollInput): boolean {
  if (initial) return true;
  if (fromSelf) return true;
  return isNearBottom(metrics, threshold);
}

/**
 * Should the "new messages" pill be showing?
 *
 * The counterpart to not stealing the reader's position: if we decline to
 * scroll, something has to tell them there is something new below. It is hidden
 * the moment they reach the bottom, whether they tapped the pill or scrolled
 * there themselves.
 */
export function shouldShowNewMessagePill(
  m: ScrollMetrics,
  unseenBelow: number,
  threshold = BOTTOM_THRESHOLD_PX
): boolean {
  return unseenBelow > 0 && !isNearBottom(m, threshold);
}

/**
 * The scrollTop that puts the newest message at the bottom.
 *
 * Clamped at zero for a thread shorter than its viewport, where
 * `scrollHeight - clientHeight` is negative and would otherwise be handed to the
 * DOM as a nonsense target.
 */
export function bottomScrollTop(m: ScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.clientHeight);
}
