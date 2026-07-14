import { describe, expect, it } from "vitest";
import { notificationView, SYSTEM_NOTIFICATION_TYPES } from "./view";

// Deep-link coverage audit (Refactor Phase 7): every notification type the app
// can emit must resolve to a real target — never the "/home" fallback.
const ALL_TYPES: { type: string; data: Record<string, unknown> }[] = [
  { type: "match", data: { user_id: "u" } },
  { type: "message_request", data: {} },
  { type: "message", data: { conversation_id: "c" } },
  { type: "post_like", data: { post_id: "p" } },
  { type: "comment", data: { post_id: "p" } },
  { type: "community_approved", data: { community_id: "c" } },
  { type: "event_approved", data: { event_id: "e" } },
  { type: "community_post_approved", data: { community_id: "c" } },
  { type: "community_post_rejected", data: { community_id: "c" } },
  { type: "level_up", data: { level: 5 } },
  { type: "achievement", data: { title: "The Rookie" } },
  { type: "waitlist_promoted", data: { event_id: "e" } },
  { type: "event_reminder", data: { event_id: "e", kind: "1h" } },
];

describe("notificationView deep links", () => {
  it("routes every known type to a real target", () => {
    for (const { type, data } of ALL_TYPES) {
      const { href, text } = notificationView(type, "Alice", data);
      expect(href, `${type} should not fall back`).not.toBe("/home");
      expect(href.startsWith("/")).toBe(true);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("collapses grouped like/comment counts", () => {
    expect(notificationView("post_like", "Alice", {}, 1).text).toContain("Alice");
    expect(notificationView("post_like", "Alice", {}, 4).text).toContain(
      "and 3 others"
    );
    expect(notificationView("comment", "Bob", {}, 2).text).toContain(
      "and 1 other"
    );
  });

  it("keeps system types out of actor bundling but still deep-links", () => {
    for (const type of SYSTEM_NOTIFICATION_TYPES) {
      const { href } = notificationView(type, null, {
        event_id: "e",
        community_id: "c",
      });
      expect(href.startsWith("/")).toBe(true);
    }
  });
});
