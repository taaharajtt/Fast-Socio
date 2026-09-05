import { describe, expect, it } from "vitest";
import { isCommunityUpdateType } from "@/lib/community/updates";
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

/**
 * Types that must never appear on the Notifications page or the bell.
 *
 * MIGRATION 0192 MOVED THE WHOLE SPACE DOMAIN OUT. Room and event messages,
 * society broadcasts, community posts, the community/society/event lifecycle
 * and direct messages are all Community → Updates now, so the Notifications
 * page must not render or count any of them. UAT-18's opposite decision (which
 * this list used to encode) is superseded: back then Updates did not exist, so
 * excluding them meant they appeared nowhere at all.
 */
const MUST_BE_HIDDEN = [
  // Direct chat, now owned by Updates as well as the Chat badge.
  "message",
  "message_request",
  "message_request_accepted",
  "message_reaction",
  // Space conversation.
  "community_message",
  "event_message",
  "society_announcement",
  "community_post",
  // Space lifecycle and decisions.
  "community_post_review",
  "community_post_approved",
  "community_post_rejected",
  "community_join_request",
  "community_join_approved",
  "community_join_rejected",
  "community_approved",
  "community_rejected",
  "society_role",
  "society_role_removed",
  "event_post_request",
  // Events.
  "event_approved",
  "event_rejected",
  "event_reminder",
  "event_updated",
  "waitlist_promoted",
  "event_organizer_added",
  "event_organizer_removed",
  // Admin broadcast modal announcements.
  "announcement",
];

/** What genuinely remains on the general Notifications page. */
const MUST_BE_VISIBLE = [
  "post_like",
  "comment",
  "comment_reply",
  "mention",
  "match",
  "help_response",
  "achievement",
  "appeal_result",
];

describe("Notifications surface allow-list", () => {
  it("hides every excluded notification type", () => {
    for (const type of MUST_BE_HIDDEN) {
      expect(isActivityVisibleType(type), `${type} must be hidden`).toBe(false);
      expect(activityVisibleTypeList()).not.toContain(type);
    }
  });

  it("still shows the feed, Discover, Help, Aura and moderation surfaces", () => {
    for (const type of MUST_BE_VISIBLE) {
      expect(isActivityVisibleType(type), `${type} must be visible`).toBe(true);
      expect(activityVisibleTypeList()).toContain(type);
    }
  });

  it("shows one type for each category", () => {
    const expected: Record<ActivityCategory, string> = {
      post_reacts: "post_like",
      comment_reacts: "comment_like",
      comments: "comment",
      discover: "match",
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
    expect(seen.size).toBe(7);
  });

  it("categorises nothing that is not visible", () => {
    for (const type of NOTIFICATION_TYPES) {
      if (isActivityVisibleType(type)) continue;
      expect(notificationCategory(type), `${type} must have no category`).toBeNull();
    }
    expect(notificationCategory("some_future_type")).toBeNull();
  });

  it("gives every unbundleable system type a home on one surface or the other", () => {
    // This used to assert SYSTEM_NOTIFICATION_TYPES was a subset of the
    // Activity-visible list. Migration 0192 moved the space lifecycle to
    // Community Updates, so that is no longer the invariant — what still must
    // hold is that no system type is orphaned: each renders on exactly one of
    // the two surfaces.
    for (const type of SYSTEM_NOTIFICATION_TYPES) {
      const onActivity = isActivityVisibleType(type);
      const onUpdates = isCommunityUpdateType(type);
      expect(onActivity || onUpdates, `${type} renders nowhere`).toBe(true);
      expect(onActivity && onUpdates, `${type} renders on both`).toBe(false);
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
