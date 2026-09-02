import { describe, expect, it } from "vitest";
import {
  effectiveEnd,
  eventTimeState,
  hasEnded,
  nextBoundary,
  OPEN_ENDED_DURATION_MS,
} from "@/lib/events/time-state";

const at = (iso: string) => new Date(iso).getTime();

/**
 * UAT-10. Every assertion here is arithmetic on UTC instants, which is the
 * point: a `timestamptz` is a point in time and carries no zone, so the state
 * of an event must be identical for a viewer in Karachi, one in London during
 * British Summer Time, and a CI runner pinned to UTC. Timezone enters only at
 * DISPLAY (Asia/Karachi, stated in the UI).
 */
describe("event time state", () => {
  // 2026-10-04 18:00–20:00 PKT == 13:00–15:00Z (Pakistan does not observe DST).
  const event = {
    startsAt: "2026-10-04T13:00:00Z",
    endsAt: "2026-10-04T15:00:00Z",
  };

  it("is upcoming one second before the start", () => {
    expect(eventTimeState(event, at("2026-10-04T12:59:59Z"))).toBe("upcoming");
  });

  it("is live exactly AT the start", () => {
    // Inclusive start: at 18:00 the event is happening, not still upcoming.
    expect(eventTimeState(event, at("2026-10-04T13:00:00Z"))).toBe("live");
  });

  it("is live one second before the end", () => {
    expect(eventTimeState(event, at("2026-10-04T14:59:59Z"))).toBe("live");
  });

  it("is ended exactly AT the end", () => {
    // Exclusive end: the pair of rules above and here means no instant is both
    // live and ended, and none is neither.
    expect(eventTimeState(event, at("2026-10-04T15:00:00Z"))).toBe("ended");
  });

  it("agrees with hasEnded at every boundary", () => {
    expect(hasEnded(event, at("2026-10-04T14:59:59Z"))).toBe(false);
    expect(hasEnded(event, at("2026-10-04T15:00:00Z"))).toBe(true);
  });
});

describe("open-ended events", () => {
  const open = { startsAt: "2026-10-04T13:00:00Z", endsAt: null };

  it("is LIVE at its start rather than instantly ended", () => {
    // The regression this exists for: the old helper used `ends_at ?? starts_at`
    // as the end, so an event with no end time read as over the moment it began.
    expect(eventTimeState(open, at("2026-10-04T13:00:01Z"))).toBe("live");
  });

  it("ends after the default duration rather than never", () => {
    const end = at("2026-10-04T13:00:00Z") + OPEN_ENDED_DURATION_MS;
    expect(eventTimeState(open, end - 1)).toBe("live");
    expect(eventTimeState(open, end)).toBe("ended");
  });

  it("treats a missing endsAt key the same as an explicit null", () => {
    expect(effectiveEnd({ startsAt: "2026-10-04T13:00:00Z" })).toBe(
      effectiveEnd(open)
    );
  });
});

describe("malformed ranges", () => {
  it("never lets an event end before it starts", () => {
    const inverted = {
      startsAt: "2026-10-04T13:00:00Z",
      endsAt: "2026-10-04T11:00:00Z",
    };
    expect(effectiveEnd(inverted)).toBeGreaterThan(at("2026-10-04T13:00:00Z"));
    expect(eventTimeState(inverted, at("2026-10-04T13:30:00Z"))).toBe("live");
  });

  it("treats an unparseable start as upcoming rather than crashing", () => {
    expect(eventTimeState({ startsAt: "not a date" }, Date.now())).toBe(
      "upcoming"
    );
    expect(nextBoundary({ startsAt: "not a date" }, Date.now())).toBeNull();
  });
});

describe("boundary scheduling", () => {
  const event = {
    startsAt: "2026-10-04T13:00:00Z",
    endsAt: "2026-10-04T15:00:00Z",
  };

  it("points an upcoming event at its start", () => {
    expect(nextBoundary(event, at("2026-10-04T09:00:00Z"))).toBe(
      at("2026-10-04T13:00:00Z")
    );
  });

  it("points a live event at its end", () => {
    expect(nextBoundary(event, at("2026-10-04T14:00:00Z"))).toBe(
      at("2026-10-04T15:00:00Z")
    );
  });

  it("gives an ended event nothing to wait for", () => {
    // What stops the client scheduling a timer forever on a past event.
    expect(nextBoundary(event, at("2026-10-05T00:00:00Z"))).toBeNull();
  });
});

describe("viewers outside Pakistan, including across a DST change", () => {
  // The same instant expressed three ways. If any of these disagreed, the state
  // would depend on where the reader is standing — which is the class of bug
  // UAT-10 asks about.
  const event = {
    startsAt: "2026-10-04T13:00:00Z",
    endsAt: "2026-10-04T15:00:00Z",
  };

  it("resolves identically however the instant is written", () => {
    const sameInstant = [
      "2026-10-04T14:30:00Z", // UTC
      "2026-10-04T19:30:00+05:00", // PKT (no DST)
      "2026-10-04T15:30:00+01:00", // London, British Summer Time
      "2026-10-04T07:30:00-07:00", // US Pacific, daylight time
    ].map(at);

    for (const now of sameInstant) {
      expect(new Set(sameInstant).size).toBe(1); // they really are one instant
      expect(eventTimeState(event, now)).toBe("live");
    }
  });

  it("is unaffected by a DST transition in the viewer's zone", () => {
    // Europe/London leaves BST on 2026-10-25. An event before and after that
    // date is evaluated by the same UTC arithmetic either way.
    const before = {
      startsAt: "2026-10-20T13:00:00Z",
      endsAt: "2026-10-20T15:00:00Z",
    };
    const after = {
      startsAt: "2026-11-03T13:00:00Z",
      endsAt: "2026-11-03T15:00:00Z",
    };
    expect(eventTimeState(before, at("2026-10-20T14:00:00Z"))).toBe("live");
    expect(eventTimeState(after, at("2026-11-03T14:00:00Z"))).toBe("live");
  });
});
