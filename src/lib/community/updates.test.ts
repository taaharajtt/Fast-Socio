import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMUNITY_UPDATE_TYPES,
  communityUpdateTypeList,
  isActionableUpdate,
  isCommunityUpdateType,
} from "./updates";
import {
  ACTIVITY_VISIBLE_TYPES,
  isNotificationType,
  notificationCopy,
  notificationHref,
  type NotificationType,
} from "@/lib/notifications/copy";

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/0183_community_updates.sql"),
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

  it("only contains types the Activity surface also renders", () => {
    // The overlap policy: ONE record per event, shown on both surfaces, with
    // one shared read state. A community type Activity refuses to render would
    // be a badge item with no second home and an unclearable read state.
    for (const type of COMMUNITY_UPDATE_TYPES) {
      expect(ACTIVITY_VISIBLE_TYPES).toContain(type);
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

describe("what the badge must never count", () => {
  const FORBIDDEN = [
    // Raw chat — Chat has its own badge pointing at where the message lives.
    "community_message",
    "event_message",
    "message",
    "message_request",
    "message_reaction",
    // Someone posting in a space is a feed, not a task.
    "community_post",
    // Likes and social reactions.
    "post_like",
    "comment_like",
    "comment",
    "mention",
    // Platform-wide creation events have no per-user relevance at all, which is
    // what made the old `communities`/`events` counters meaningless.
    "announcement",
  ];

  for (const type of FORBIDDEN) {
    it(`excludes ${type}`, () => {
      expect(isCommunityUpdateType(type)).toBe(false);
      expect(communityUpdateTypeList()).not.toContain(type);
      expect(migrationTypes()).not.toContain(type);
    });
  }

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
