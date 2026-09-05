import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMUNITY_UPDATE_TYPES,
  SOCIAL_NOTIFICATION_TYPES,
  communityUpdateTypeList,
  isActionableUpdate,
  isCommunityUpdateType,
  notificationDomain,
} from "./updates";
import {
  ACTIVITY_VISIBLE_TYPES,
  isNotificationType,
  notificationCopy,
  notificationHref,
  type NotificationType,
} from "@/lib/notifications/copy";

const ROOT = process.cwd();
// The EFFECTIVE definition, which 0195 replaced 0192's copy of. Parsing an
// older file would assert against a superseded list — the exact "the file that
// defines a function is not the one running" trap this repo keeps hitting.
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/0195_notification_domain_routing.sql"),
  "utf8"
);

/**
 * The Community update domain, asserted on both sides of the boundary.
 *
 * The database's copy (`public.community_update_types()`) is what the badge and
 * the list actually query; the TypeScript copy is what the UI reasons about.
 * Neither can import the other, so this parses the migration and compares them.
 * A type added to one and forgotten in the other fails here rather than
 * silently under- or over-counting in production.
 */
function migrationTypes(): string[] {
  const body = MIGRATION.split("create or replace function public.community_update_types()")[1]
    ?.split("$$;")[0] ?? "";
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("the domain is defined once", () => {
  it("matches the database's community_update_types()", () => {
    expect([...migrationTypes()].sort()).toEqual(
      [...COMMUNITY_UPDATE_TYPES].sort()
    );
  });

  it("only contains types the notification system can actually emit", () => {
    for (const type of COMMUNITY_UPDATE_TYPES) {
      expect(isNotificationType(type)).toBe(true);
    }
  });

  it("contains NOTHING the Activity surface also renders", () => {
    // The overlap policy INVERTED by migration 0192: the two surfaces now
    // partition the notification space instead of sharing it, so a row belongs
    // to exactly one inbox and cannot be counted twice.
    for (const type of COMMUNITY_UPDATE_TYPES) {
      expect(ACTIVITY_VISIBLE_TYPES as readonly string[]).not.toContain(type);
    }
  });

  it("gives every type real copy and a real destination", () => {
    for (const type of COMMUNITY_UPDATE_TYPES) {
      const text = notificationCopy(type as NotificationType, "Alice", {
        community_name: "Robotics",
        community_id: "c1",
        event_id: "e1",
        title: "Open Mic",
      });
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain("undefined");
      const href = notificationHref(type as NotificationType, {
        community_id: "c1",
        event_id: "e1",
      });
      expect(href.startsWith("/")).toBe(true);
    }
  });
});

describe("what the always-community list must never contain", () => {
  // Migration 0192 routes these by SUBJECT, not by type: the same `post_like`
  // is an Update on a community post and a Notification on a feed post. Putting
  // them in the always-community list would drag every feed like into Updates,
  // so their absence here is the thing worth asserting.
  const FORBIDDEN = [
    "post_like",
    "comment_like",
    "comment",
    "comment_reply",
    "mention",
    // Admin broadcasts are a cold-open modal, not an inbox row.
    "announcement",
    // Chat. Migration 0192 put these four here and that was the bug: private
    // conversation traffic rendered on a community screen and counted towards
    // the Community dock badge. See notifications/domain.test.ts for the full
    // fence around the regression.
    "message",
    "message_request",
    "message_request_accepted",
    "message_reaction",
  ];

  for (const type of FORBIDDEN) {
    it(`excludes ${type}`, () => {
      expect(isCommunityUpdateType(type)).toBe(false);
      expect(communityUpdateTypeList()).not.toContain(type);
      expect(migrationTypes()).not.toContain(type);
    });
  }

  it("routes the generic social types by subject instead", () => {
    for (const type of SOCIAL_NOTIFICATION_TYPES) {
      // In a space -> Updates. On the open feed -> Notifications.
      expect(notificationDomain(type, { communityId: "c1" })).toBe(
        "community_updates"
      );
      expect(notificationDomain(type, { eventId: "e1" })).toBe(
        "community_updates"
      );
      expect(notificationDomain(type, {})).toBe("general_notifications");
      expect(
        notificationDomain(type, { communityId: null, eventId: null })
      ).toBe("general_notifications");
    }
  });

  it("sends every always-community type to Updates whatever its subject", () => {
    for (const type of COMMUNITY_UPDATE_TYPES) {
      expect(notificationDomain(type, {})).toBe("community_updates");
    }
  });

  it("leaves genuinely unrelated types on Notifications", () => {
    for (const type of ["match", "help_response", "achievement", "appeal_result"]) {
      expect(notificationDomain(type, {})).toBe("general_notifications");
      expect(notificationDomain(type, { communityId: "c1" })).toBe(
        "general_notifications"
      );
    }
  });

  it("has no notion of 'a new community was created' or 'a new event exists'", () => {
    // There is no type for either, on either side — the badge cannot count them
    // because nothing emits a per-user record for them.
    expect(
      COMMUNITY_UPDATE_TYPES.filter((t) => t === ("community_created" as never))
    ).toEqual([]);
    expect(MIGRATION).not.toContain("community_created");
    expect(MIGRATION).not.toContain("event_created");
  });
});

describe("required triggers are all represented", () => {
  const REQUIRED: [string, string][] = [
    ["a join request to approve", "community_join_request"],
    ["a post awaiting moderation", "community_post_review"],
    ["your join request approved", "community_join_approved"],
    ["your join request rejected", "community_join_rejected"],
    ["your community approved", "community_approved"],
    ["your community rejected", "community_rejected"],
    ["your event approved", "event_approved"],
    ["your event rejected", "event_rejected"],
    ["an announcement in a space you follow", "society_announcement"],
    ["a material change to an event you joined", "event_updated"],
    ["an upcoming-event reminder", "event_reminder"],
    ["a community chat-room message", "community_message"],
    ["an event chat message", "event_message"],
    ["a post in a community", "community_post"],
    ["a waitlist promotion", "waitlist_promoted"],
  ];

  for (const [label, type] of REQUIRED) {
    it(label, () => {
      expect(isCommunityUpdateType(type)).toBe(true);
      expect(migrationTypes()).toContain(type);
    });
  }
});

describe("actionable marking", () => {
  it("marks manager work as action needed", () => {
    expect(isActionableUpdate("community_join_request")).toBe(true);
    expect(isActionableUpdate("community_post_review")).toBe(true);
    expect(isActionableUpdate("event_post_request")).toBe(true);
  });

  it("does not mark news as action needed", () => {
    expect(isActionableUpdate("society_announcement")).toBe(false);
    expect(isActionableUpdate("event_reminder")).toBe(false);
    expect(isActionableUpdate("community_approved")).toBe(false);
  });
});

describe("copy for the new types", () => {
  it("tells a rejected applicant what happened", () => {
    const text = notificationCopy("community_join_rejected", "Alice", {
      community_name: "Robotics",
    });
    expect(text).toContain("Robotics");
    expect(text.toLowerCase()).toContain("join request");
  });

  it("says WHAT changed about an event, not just that something did", () => {
    const data = { event_id: "e1", title: "Open Mic" };
    expect(
      notificationCopy("event_updated", null, { ...data, change: "cancelled" })
    ).toContain("cancelled");
    expect(
      notificationCopy("event_updated", null, { ...data, change: "rescheduled" })
    ).toContain("new time");
    expect(
      notificationCopy("event_updated", null, { ...data, change: "venue" })
    ).toContain("venue");
  });

  it("routes both new types at their subject", () => {
    expect(
      notificationHref("community_join_rejected", { community_id: "c1" })
    ).toBe("/communities/c1");
    expect(notificationHref("event_updated", { event_id: "e1" })).toBe(
      "/events/e1"
    );
  });
});
