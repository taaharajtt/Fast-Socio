import { describe, expect, it } from "vitest";
import {
  BOTTOM_THRESHOLD_PX,
  bottomScrollTop,
  distanceFromBottom,
  isNearBottom,
  shouldAutoScroll,
  shouldShowNewMessagePill,
} from "@/lib/chat/scroll-anchor";

/** A container 600px tall holding `content` px, scrolled to `scrollTop`. */
const view = (scrollTop: number, scrollHeight = 5000, clientHeight = 600) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

const AT_BOTTOM = view(4400); // 5000 - 600
const SCROLLED_UP = view(1000);

describe("distance from the bottom", () => {
  it("is zero when pinned to the end", () => {
    expect(distanceFromBottom(AT_BOTTOM)).toBe(0);
  });

  it("never goes negative when the browser over-scrolls", () => {
    // iOS rubber-banding reports a scrollTop past the maximum; a negative
    // distance would make every downstream comparison behave oddly.
    expect(distanceFromBottom(view(4600))).toBe(0);
  });

  it("is the content below the fold otherwise", () => {
    expect(distanceFromBottom(SCROLLED_UP)).toBe(3400);
  });
});

describe("near-bottom tolerance", () => {
  it("does not require an exact bottom", () => {
    // The reason a threshold exists at all: fractional scrollHeight and
    // momentum overshoot mean an exact equality effectively never holds.
    expect(isNearBottom(view(4400 - (BOTTOM_THRESHOLD_PX - 1)))).toBe(true);
  });

  it("stops counting just past the threshold", () => {
    expect(isNearBottom(view(4400 - (BOTTOM_THRESHOLD_PX + 1)))).toBe(false);
  });

  it("treats a thread shorter than the viewport as at the bottom", () => {
    expect(isNearBottom(view(0, 200, 600))).toBe(true);
  });
});

describe("auto-scroll decision", () => {
  it("opens a thread at the latest message", () => {
    expect(
      shouldAutoScroll({ metrics: SCROLLED_UP, fromSelf: false, initial: true })
    ).toBe(true);
  });

  it("follows new messages while the reader is at the bottom", () => {
    expect(shouldAutoScroll({ metrics: AT_BOTTOM, fromSelf: false })).toBe(true);
  });

  it("does NOT steal the position of someone reading history", () => {
    // The behaviour UAT-06 is about. There is nowhere to restore a scroll
    // position from once it has been thrown away, so this must never fire.
    expect(shouldAutoScroll({ metrics: SCROLLED_UP, fromSelf: false })).toBe(
      false
    );
  });

  it("always follows the reader's OWN message", () => {
    // Pressing Send is an explicit request to be at the bottom; staying put
    // reads as the message having failed.
    expect(shouldAutoScroll({ metrics: SCROLLED_UP, fromSelf: true })).toBe(true);
  });
});

describe("new-message pill", () => {
  it("appears when a message arrives out of view", () => {
    expect(shouldShowNewMessagePill(SCROLLED_UP, 1)).toBe(true);
  });

  it("stays hidden when there is nothing new", () => {
    expect(shouldShowNewMessagePill(SCROLLED_UP, 0)).toBe(false);
  });

  it("stays hidden at the bottom, where the message is already visible", () => {
    expect(shouldShowNewMessagePill(AT_BOTTOM, 3)).toBe(false);
  });
});

describe("bottom target", () => {
  it("is the scrollable maximum", () => {
    expect(bottomScrollTop(view(0))).toBe(4400);
  });

  it("clamps to zero for a thread shorter than its viewport", () => {
    // 200 - 600 is negative; handing that to the DOM as a target is nonsense.
    expect(bottomScrollTop(view(0, 200, 600))).toBe(0);
  });
});
