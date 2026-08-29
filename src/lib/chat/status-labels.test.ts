import { describe, expect, it } from "vitest";
import {
  activityLabel,
  conversationStatusLabel,
  deliveryLabel,
  exactMessageTime,
  relativeStamp,
} from "@/lib/chat/status-labels";

// A fixed local "now" so every case below is deterministic in any timezone.
const NOW = new Date(2026, 7, 29, 15, 0, 0); // 29 Aug 2026, 3:00pm local
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("relativeStamp", () => {
  it("reads as a sentence ending, not a compact badge", () => {
    expect(relativeStamp(ago(5 * 1000), NOW)).toBe("just now");
    expect(relativeStamp(ago(5 * MIN), NOW)).toBe("5m ago");
    expect(relativeStamp(ago(3 * HOUR), NOW)).toBe("3h ago");
  });

  it("uses calendar days, not 24-hour blocks, for yesterday", () => {
    // 4pm the previous day is 23 hours back but a different calendar day.
    const yesterday = new Date(2026, 7, 28, 16, 0, 0).toISOString();
    expect(relativeStamp(yesterday, NOW)).toBe("yesterday");
  });

  it("falls back to a date, adding the year only when it differs", () => {
    expect(relativeStamp(new Date(2026, 7, 20, 9, 0).toISOString(), NOW)).toBe(
      "Aug 20"
    );
    expect(relativeStamp(new Date(2025, 7, 20, 9, 0).toISOString(), NOW)).toBe(
      "Aug 20, 2025"
    );
  });

  it("treats a future timestamp (clock skew) as just now", () => {
    expect(relativeStamp(new Date(NOW.getTime() + 30_000).toISOString(), NOW)).toBe(
      "just now"
    );
  });
});

describe("activityLabel", () => {
  it("shows Active now inside the heartbeat window", () => {
    expect(activityLabel(ago(30 * 1000), NOW)).toBe("Active now");
    expect(activityLabel(ago(90 * 1000), NOW)).toBe("Active now");
  });

  it("counts minutes and hours within the same day", () => {
    expect(activityLabel(ago(25 * MIN), NOW)).toBe("Active 25m ago");
    expect(activityLabel(ago(4 * HOUR), NOW)).toBe("Active 4h ago");
  });

  it("says yesterday, then hides anything older", () => {
    expect(activityLabel(new Date(2026, 7, 28, 22, 0).toISOString(), NOW)).toBe(
      "Active yesterday"
    );
    expect(activityLabel(new Date(2026, 7, 25, 22, 0).toISOString(), NOW)).toBeNull();
  });

  it("shows nothing when activity status is unavailable or switched off", () => {
    // RLS returns no presence row for a user who disabled activity status, so
    // the timestamp arrives here as null — there is no other 'hidden' state.
    expect(activityLabel(null, NOW)).toBeNull();
    expect(activityLabel(undefined, NOW)).toBeNull();
  });
});

describe("deliveryLabel", () => {
  const sent = { createdAt: ago(5 * MIN), readAt: null };
  const read = { createdAt: ago(5 * MIN), readAt: ago(2 * MIN) };

  it("says Sent while the message is unread", () => {
    expect(deliveryLabel(sent, true, NOW)).toBe("Sent 5m ago");
  });

  it("says Seen, timed from the READ moment, once it is read", () => {
    expect(deliveryLabel(read, true, NOW)).toBe("Seen 2m ago");
  });

  it("never says Seen when the recipient disabled read receipts", () => {
    expect(deliveryLabel(read, false, NOW)).toBe("Sent 5m ago");
  });

  it("shows nothing when there is no outgoing message", () => {
    expect(deliveryLabel(null, true, NOW)).toBeNull();
  });
});

describe("conversationStatusLabel", () => {
  it("prefers my message's status over their activity", () => {
    expect(
      conversationStatusLabel(
        {
          lastOutgoing: { createdAt: ago(5 * MIN), readAt: ago(MIN) },
          showReadReceipts: true,
          lastActiveAt: ago(30 * 1000),
        },
        NOW
      )
    ).toBe("Seen 1m ago");
  });

  it("falls back to activity when I have not written anything", () => {
    expect(
      conversationStatusLabel(
        { lastOutgoing: null, showReadReceipts: true, lastActiveAt: ago(25 * MIN) },
        NOW
      )
    ).toBe("Active 25m ago");
  });

  it("shows nothing when both are unavailable", () => {
    expect(
      conversationStatusLabel(
        { lastOutgoing: null, showReadReceipts: true, lastActiveAt: null },
        NOW
      )
    ).toBeNull();
  });

  it("does not let activity stand in for a read receipt", () => {
    // Active right now, but the message is unread: it must still say Sent.
    expect(
      conversationStatusLabel(
        {
          lastOutgoing: { createdAt: ago(2 * MIN), readAt: null },
          showReadReceipts: true,
          lastActiveAt: ago(10 * 1000),
        },
        NOW
      )
    ).toBe("Sent 2m ago");
  });
});

describe("exactMessageTime", () => {
  it("is a bare clock time for today and dated before that", () => {
    const today = new Date();
    today.setHours(14, 5, 0, 0);
    expect(exactMessageTime(today.toISOString())).toMatch(/\d/);
    const yesterday = new Date(today.getTime() - 86_400_000);
    expect(exactMessageTime(yesterday.toISOString())).toMatch(/^Yesterday /);
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(exactMessageTime("not a date")).toBe("");
  });
});
