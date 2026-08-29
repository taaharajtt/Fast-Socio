import { describe, expect, it } from "vitest";
import {
  POLL_BACKOFF_MS,
  pollDelayMs,
  shouldPoll,
} from "@/lib/realtime/poll-backoff";

describe("pollDelayMs", () => {
  it("walks the 5s / 10s / 30s schedule", () => {
    expect(pollDelayMs(0)).toBe(5_000);
    expect(pollDelayMs(1)).toBe(10_000);
    expect(pollDelayMs(2)).toBe(30_000);
  });

  it("plateaus at the ceiling instead of growing without bound", () => {
    expect(pollDelayMs(3)).toBe(30_000);
    expect(pollDelayMs(50)).toBe(30_000);
    expect(pollDelayMs(50)).toBe(POLL_BACKOFF_MS[POLL_BACKOFF_MS.length - 1]);
  });

  it("clamps a negative attempt to the first step", () => {
    expect(pollDelayMs(-1)).toBe(5_000);
  });
});

describe("shouldPoll", () => {
  const base = { subscribed: false, visible: true, enabled: true };

  it("polls only while realtime is down, the tab is visible and it is enabled", () => {
    expect(shouldPoll(base)).toBe(true);
  });

  it("stops the moment realtime comes back", () => {
    expect(shouldPoll({ ...base, subscribed: true })).toBe(false);
  });

  it("never polls a hidden tab — nobody is looking, and it costs battery", () => {
    expect(shouldPoll({ ...base, visible: false })).toBe(false);
  });

  it("never polls when the consumer is disabled", () => {
    expect(shouldPoll({ ...base, enabled: false })).toBe(false);
  });
});
