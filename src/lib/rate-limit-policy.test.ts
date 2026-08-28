import { describe, it, expect } from "vitest";
import {
  RATE_LIMITS,
  DISCOVER_SWIPE_BURST,
  createBurstWindow,
  interpretRateLimitRpc,
  isAllowed,
  limitedMessage,
  type RateLimitResult,
} from "./rate-limit-policy";

const SECOND = 1000;

/** Drive a window at a fixed cadence, returning every result. */
function swipeAt(
  win: ReturnType<typeof createBurstWindow>,
  count: number,
  startMs: number,
  gapMs: number
): RateLimitResult[] {
  return Array.from({ length: count }, (_, i) =>
    win.attempt(startMs + i * gapMs)
  );
}

describe("the hourly Discover quotas are gone", () => {
  it("no longer defines like/pass buckets", () => {
    expect(RATE_LIMITS).not.toHaveProperty("like");
    expect(RATE_LIMITS).not.toHaveProperty("pass");
  });

  it("allows well over 100 likes in one sitting", () => {
    const win = createBurstWindow(DISCOVER_SWIPE_BURST);
    // 150 likes at a brisk-but-human 1.5 cards/second.
    const results = swipeAt(win, 150, 0, 666);
    expect(results.filter((r) => r.status === "allowed")).toHaveLength(150);
    expect(results.some((r) => r.status === "limited")).toBe(false);
  });

  it("allows well over 300 passes in one sitting", () => {
    const win = createBurstWindow(DISCOVER_SWIPE_BURST);
    const results = swipeAt(win, 350, 0, 666);
    expect(results.filter((r) => r.status === "allowed")).toHaveLength(350);
  });

  it("lets a full deck through even at a sustained fast pace", () => {
    // 500 cards at exactly the guard's own sustained rate (2/second) — the
    // whole point is that traversal is never the thing that gets blocked.
    const win = createBurstWindow(DISCOVER_SWIPE_BURST);
    const results = swipeAt(win, 500, 0, 500);
    expect(results.every((r) => r.status === "allowed")).toBe(true);
  });
});

describe("the swipe burst guard", () => {
  it("is 20 requests per 10 seconds, shared by likes and passes", () => {
    expect(DISCOVER_SWIPE_BURST).toEqual({
      action: "discoverSwipe",
      max: 20,
      windowSeconds: 10,
    });
  });

  it("allows normal rapid manual swiping", () => {
    // Flurries of 10 cards at 2.5/second, with a 3s pause to read the next one.
    const win = createBurstWindow(DISCOVER_SWIPE_BURST);
    const results: RateLimitResult[] = [];
    let t = 0;
    for (let burst = 0; burst < 6; burst++) {
      for (let i = 0; i < 10; i++) {
        results.push(win.attempt(t));
        t += 400;
      }
      t += 3 * SECOND; // pause to read the next card
    }
    expect(results.every((r) => r.status === "allowed")).toBe(true);
  });

  it("pins where the ceiling actually sits, so the trade-off is explicit", () => {
    // The guard is a SLIDING window, so the honest description of the policy is
    // "2 swipes per second sustained, indefinitely". These two cases bracket it.
    const sustained = createBurstWindow(DISCOVER_SWIPE_BURST);
    expect(
      swipeAt(sustained, 200, 0, 500).every((r) => r.status === "allowed")
    ).toBe(true);

    // Above that rate the window fills and the guard engages. 3/second is
    // faster than a drag-and-release gesture sustains, but it IS reachable by
    // holding an arrow key or by a client emitting duplicates - which is the
    // behaviour the guard is meant to damp.
    const faster = createBurstWindow(DISCOVER_SWIPE_BURST);
    const results = swipeAt(faster, 60, 0, 333);
    expect(results.some((r) => r.status === "limited")).toBe(true);
    // ...and it damps rather than locks out: the user keeps making progress at
    // the sustained rate instead of being stopped.
    expect(
      results.filter((r) => r.status === "allowed").length
    ).toBeGreaterThan(35);
  });

  it("rejects an extreme burst", () => {
    // 40 events in the same instant: a duplicate-event storm or a script.
    const win = createBurstWindow(DISCOVER_SWIPE_BURST);
    const results = swipeAt(win, 40, 0, 0);
    expect(results.filter((r) => r.status === "allowed")).toHaveLength(20);
    expect(results.filter((r) => r.status === "limited")).toHaveLength(20);
  });

  it("rejects only temporarily, and says how long", () => {
    const win = createBurstWindow(DISCOVER_SWIPE_BURST);
    swipeAt(win, 20, 0, 0);
    const denied = win.attempt(1 * SECOND);
    expect(denied.status).toBe("limited");
    if (denied.status === "limited") {
      expect(denied.retryAfterSeconds).toBe(9);
    }
  });

  it("resets when the window rolls forward", () => {
    const win = createBurstWindow(DISCOVER_SWIPE_BURST);
    swipeAt(win, 20, 0, 0);
    expect(win.attempt(5 * SECOND).status).toBe("limited");
    // Just past the 10s window, every earlier event has aged out.
    expect(win.attempt(10 * SECOND + 1).status).toBe("allowed");
    expect(win.size(10 * SECOND + 1)).toBe(1);
  });

  it("frees slots gradually as individual events age out", () => {
    const win = createBurstWindow(DISCOVER_SWIPE_BURST);
    // 20 events spread over the first 2 seconds.
    swipeAt(win, 20, 0, 100);
    expect(win.attempt(3 * SECOND).status).toBe("limited");
    // At t=10.05s the first event (t=0) has expired, so exactly one slot is free.
    expect(win.attempt(10 * SECOND + 50).status).toBe("allowed");
    expect(win.attempt(10 * SECOND + 51).status).toBe("limited");
  });

  it("cannot be bypassed by concurrent requests", async () => {
    // The SQL takes an advisory lock so the count+insert is atomic; the
    // reference window is synchronous for the same reason. Fire 100 attempts
    // from interleaved async tasks at one instant and assert the cap holds.
    const win = createBurstWindow(DISCOVER_SWIPE_BURST);
    const results = await Promise.all(
      Array.from({ length: 100 }, async () => {
        await Promise.resolve();
        return win.attempt(0);
      })
    );
    expect(results.filter((r) => r.status === "allowed")).toHaveLength(20);
    expect(results.filter((r) => r.status === "limited")).toHaveLength(80);
    expect(win.size(0)).toBe(20);
  });
});

describe("interpretRateLimitRpc", () => {
  it("maps an allowing row to allowed", () => {
    expect(
      interpretRateLimitRpc([{ allowed: true, retry_after_seconds: null }], null)
    ).toEqual({ status: "allowed" });
  });

  it("maps a rejecting row to limited, with the retry hint", () => {
    expect(
      interpretRateLimitRpc([{ allowed: false, retry_after_seconds: 7 }], null)
    ).toEqual({ status: "limited", retryAfterSeconds: 7 });
  });

  it("tolerates a bare object instead of a row array", () => {
    expect(
      interpretRateLimitRpc({ allowed: true, retry_after_seconds: null }, null)
    ).toEqual({ status: "allowed" });
  });

  it("rounds a fractional retry up, and drops a nonsensical one", () => {
    expect(
      interpretRateLimitRpc([{ allowed: false, retry_after_seconds: 2.1 }], null)
    ).toEqual({ status: "limited", retryAfterSeconds: 3 });
    expect(
      interpretRateLimitRpc([{ allowed: false, retry_after_seconds: 0 }], null)
    ).toEqual({ status: "limited" });
  });

  it("reports a DATABASE FAILURE as error, never as a rate-limit violation", () => {
    const res = interpretRateLimitRpc(null, { message: "connection reset" });
    expect(res.status).toBe("error");
    expect(res).not.toHaveProperty("retryAfterSeconds");
    if (res.status === "error") expect(res.message).toBe("connection reset");
  });

  it("reports an empty/garbled answer as error, not as limited", () => {
    for (const data of [null, undefined, [], [{}], "nope"]) {
      expect(interpretRateLimitRpc(data, null).status).toBe("error");
    }
  });

  it("gives an error a message even when the driver supplies none", () => {
    const res = interpretRateLimitRpc(null, {});
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.message.length).toBeGreaterThan(0);
  });
});

describe("isAllowed keeps spam-prone callers fail-closed", () => {
  it("denies on a limiter error, exactly as the old boolean did", () => {
    expect(isAllowed({ status: "allowed" })).toBe(true);
    expect(isAllowed({ status: "limited" })).toBe(false);
    expect(isAllowed({ status: "error", message: "boom" })).toBe(false);
  });
});

describe("limitedMessage", () => {
  it("says seconds for a short wait", () => {
    expect(limitedMessage({ status: "limited", retryAfterSeconds: 1 }, "x")).toBe(
      "Try again in 1 second."
    );
    expect(limitedMessage({ status: "limited", retryAfterSeconds: 9 }, "x")).toBe(
      "Try again in 9 seconds."
    );
  });

  it("says minutes for a long wait", () => {
    expect(
      limitedMessage({ status: "limited", retryAfterSeconds: 3600 }, "x")
    ).toBe("Try again in 60 minutes.");
  });

  it("falls back when the RPC gave no hint", () => {
    expect(limitedMessage({ status: "limited" }, "Too many reports.")).toBe(
      "Too many reports."
    );
  });
});

describe("stronger limits outside ordinary swiping are untouched", () => {
  it("keeps the message-request, report, chat and post-like quotas", () => {
    expect(RATE_LIMITS.messageRequest).toEqual({ max: 20, windowSeconds: 3600 });
    expect(RATE_LIMITS.report).toEqual({ max: 20, windowSeconds: 86400 });
    expect(RATE_LIMITS.chatSend).toEqual({ max: 120, windowSeconds: 60 });
    expect(RATE_LIMITS.postLike).toEqual({ max: 60, windowSeconds: 60 });
  });

  it("still rejects the 21st message request inside the hour", () => {
    const win = createBurstWindow({
      action: "messageRequest",
      ...RATE_LIMITS.messageRequest,
    });
    const results = swipeAt(win, 21, 0, 60 * SECOND);
    expect(results.filter((r) => r.status === "allowed")).toHaveLength(20);
    expect(results[20].status).toBe("limited");
  });

  it("still rejects the 21st report inside the day", () => {
    const win = createBurstWindow({ action: "report", ...RATE_LIMITS.report });
    const results = swipeAt(win, 21, 0, 60 * 60 * SECOND);
    expect(results.filter((r) => r.status === "allowed")).toHaveLength(20);
    expect(results[20].status).toBe("limited");
  });
});
