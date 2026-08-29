import { describe, expect, it } from "vitest";
import {
  ACTIVITY_VISIBLE_TYPES,
  activityVisibleTypeList,
  isActivityVisibleType,
  notificationCategory,
  notificationView,
  SYSTEM_NOTIFICATION_TYPES,
  type ActivityCategory,
} from "./view";
import { NOTIFICATION_TYPES } from "./copy";

/**
 * The Notifications page shows nine categories and nothing else. Everything a
 * row needs — copy, category, icon-driving type, deep link — has to agree with
 * that one list, so the assertions below all hang off ACTIVITY_VISIBLE_TYPES.
 */

/** Payload carrying every id the destinations can read, so no href can fall back. */
const FULL_DATA: Record<string, unknown> = {
  post_id: "p",
  comment_id: "c",
  conversation_id: "conv",
  community_id: "com",
  event_id: "e",
  request_id: "r",
  level: 5,
  title: "The Rookie",
};

/** Types that must never appear on the Notifications page or the bell. */
const MUST_BE_HIDDEN = [
  // Direct messages, requests, accepts, and reactions.
  "message",
  "message_request",
  "message_request_accepted",
  "message_reaction",
  // Community / chatroom and event chat.
  "community_message",
  "event_message",
  // Society and community broadcasts.
  "society_announcement",
  "community_post",
  // Admin broadcast modal announcements.
  "announcement",
];

describe("Notifications surface allow-list", () => {
  it("hides every excluded notification type", () => {
    for (const type of MUST_BE_HIDDEN) {
      expect(isActivityVisibleType(type), `${type} must be hidden`).toBe(false);
      expect(activityVisibleTypeList()).not.toContain(type);
    }
  });

  it("shows one type for each of the nine categories", () => {
    const expected: Record<ActivityCategory, string> = {
      post_reacts: "post_like",
      comment_reacts: "comment_like",
      comments: "comment",
      discover: "match",
      event_decision: "event_approved",
      event_updates: "waitlist_promoted",
      help: "help_response",
      aura: "achievement",
      moderation: "appeal_result",
    };
    for (const [category, type] of Object.entries(expected)) {
      expect(isActivityVisibleType(type), `${type} must be visible`).toBe(true);
      expect(notificationCategory(type)).toBe(category);
    }
  });

  it("gives every visible type exactly one category", () => {
    const seen = new Set<ActivityCategory>();
    for (const type of ACTIVITY_VISIBLE_TYPES) {
      const category = notificationCategory(type);
      expect(category, `${type} needs a category`).not.toBeNull();
      seen.add(category!);
    }
    expect(seen.size).toBe(9);
  });

  it("categorises nothing that is not visible", () => {
    for (const type of NOTIFICATION_TYPES) {
      if (isActivityVisibleType(type)) continue;
      expect(notificationCategory(type), `${type} must have no category`).toBeNull();
    }
    expect(notificationCategory("some_future_type")).toBeNull();
  });

  it("only lists visible types as unbundleable system notifications", () => {
    for (const type of SYSTEM_NOTIFICATION_TYPES) {
      expect(isActivityVisibleType(type)).toBe(true);
    }
  });
});

describe("notificationView deep links", () => {
  it("routes every visible type to a real target with copy", () => {
    for (const type of ACTIVITY_VISIBLE_TYPES) {
      const { href, text } = notificationView(type, "Alice", FULL_DATA);
      expect(href, `${type} should not fall back`).not.toBe("/home");
      expect(href.startsWith("/")).toBe(true);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("still deep-links system types with no actor", () => {
    for (const type of SYSTEM_NOTIFICATION_TYPES) {
      const { href } = notificationView(type, null, FULL_DATA);
      expect(href.startsWith("/")).toBe(true);
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
});
