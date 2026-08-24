import { describe, expect, it } from "vitest";
import { chatDayLabel, dayKey } from "@/lib/chat-day";

// A fixed "now" so these never depend on the day the suite runs.
const NOW = new Date(2026, 7, 24, 15, 0, 0); // 24 Aug 2026, local

function at(y: number, m: number, d: number, h = 12): string {
  return new Date(y, m, d, h).toISOString();
}

describe("chatDayLabel", () => {
  it("labels the current local day Today", () => {
    expect(chatDayLabel(at(2026, 7, 24, 0), NOW)).toBe("Today");
    expect(chatDayLabel(at(2026, 7, 24, 23), NOW)).toBe("Today");
  });

  it("labels the previous day Yesterday", () => {
    expect(chatDayLabel(at(2026, 7, 23), NOW)).toBe("Yesterday");
  });

  it("uses the weekday name within the last week", () => {
    // 20 Aug 2026 is a Thursday.
    expect(chatDayLabel(at(2026, 7, 20), NOW)).toBe("Thursday");
  });

  it("uses an ordinal full date beyond a week", () => {
    expect(chatDayLabel(at(2026, 7, 1), NOW)).toBe("1st August 2026");
    expect(chatDayLabel(at(2024, 7, 24), NOW)).toBe("24th August 2024");
    expect(chatDayLabel(at(2026, 6, 3), NOW)).toBe("3rd July 2026");
    expect(chatDayLabel(at(2026, 6, 13), NOW)).toBe("13th July 2026");
    expect(chatDayLabel(at(2026, 6, 22), NOW)).toBe("22nd July 2026");
  });

  it("does not claim a weekday for a future timestamp", () => {
    expect(chatDayLabel(at(2026, 7, 26), NOW)).toBe("26th August 2026");
  });

  it("returns empty for an unparseable timestamp", () => {
    expect(chatDayLabel("not-a-date", NOW)).toBe("");
  });
});

describe("dayKey", () => {
  it("splits either side of local midnight", () => {
    expect(dayKey(at(2026, 7, 24, 23))).not.toBe(dayKey(at(2026, 7, 25, 0)));
  });

  it("groups the same local day", () => {
    expect(dayKey(at(2026, 7, 24, 1))).toBe(dayKey(at(2026, 7, 24, 22)));
  });
});
