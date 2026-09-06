import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_NOTIFICATION_TYPES,
  COMMUNITY_UPDATE_TYPES,
  SOCIAL_NOTIFICATION_TYPES,
  chatNotificationTypeList,
  communityUpdateTypeList,
  isChatNotificationType,
  isCommunityUpdateType,
  notificationDomain,
} from "./domain";
import { ACTIVITY_VISIBLE_TYPES, isNotificationType } from "./copy";

const ROOT = process.cwd();
/** The EFFECTIVE definition. 0192's is superseded; parsing it would assert the
 *  very bug this file exists to prevent coming back. */
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/0195_notification_domain_routing.sql"),
  "utf8"
);

/** The literals inside one `create or replace function public.<name>()` body. */
function migrationList(fn: string): string[] {
  const body =
    MIGRATION.split(`create or replace function public.${fn}()`)[1]?.split(
      "$$;"
    )[0] ?? "";
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/**
 * THE REGRESSION THIS FILE EXISTS FOR.
 *
 * Migration 0192 put `message`, `message_request`, `message_request_accepted`
 * and `message_reaction` into the Community list. Private one-to-one and group
 * chat then rendered inside Community → Updates and counted towards the
 * Community dock badge — five unread DMs plus three community updates showed
 * as 8. Every assertion below is a fence around that.
 */
describe("direct messages are Chat, never Community", () => {
  for (const type of CHAT_NOTIFICATION_TYPES) {
    it(`routes ${type} to chat`, () => {
      expect(notificationDomain(type)).toBe("chat");
      expect(isChatNotificationType(type)).toBe(true);
    });

    it(`keeps ${type} out of the Community list, in code and in SQL`, () => {
      expect(isCommunityUpdateType(type)).toBe(false);
      expect(communityUpdateTypeList()).not.toContain(type);
      expect(migrationList("community_update_types")).not.toContain(type);
    });

    it(`keeps ${type} off the general Notifications page`, () => {
      // Neither surface may render it: Chat owns it three other ways already.
      expect(ACTIVITY_VISIBLE_TYPES as readonly string[]).not.toContain(type);
      expect(notificationDomain(type)).not.toBe("general_notifications");
    });
  }

  it("stays chat even when a payload happens to name a community", () => {
    // A crafted or mislinked subject must not smuggle a DM into Updates: the
    // chat type test runs BEFORE the community-by-subject test.
    expect(notificationDomain("message", { communityId: "c1" })).toBe("chat");
    expect(notificationDomain("message_reaction", { eventId: "e1" })).toBe(
      "chat"
    );
  });

  it("routes anything with a bare conversation subject to chat", () => {
    // The future-proofing clause: a generic type reused inside a Chat
    // conversation is Chat, without anyone having to remember to list it.
    expect(notificationDomain("some_future_dm_type", { conversationId: "v1" }))
      .toBe("chat");
    expect(notificationDomain("mention", { conversationId: "v1" })).toBe("chat");
  });

  it("still prefers Community when a row names BOTH a space and a conversation", () => {
    expect(
      notificationDomain("mention", { communityId: "c1", conversationId: "v1" })
    ).toBe("community_updates");
  });

  it("has the two lists disjoint on both sides of the boundary", () => {
    const chat = new Set(chatNotificationTypeList());
    for (const t of communityUpdateTypeList()) expect(chat.has(t)).toBe(false);
    const sqlCommunity = new Set(migrationList("community_update_types"));
    for (const t of migrationList("chat_notification_types")) {
      expect(sqlCommunity.has(t)).toBe(false);
    }
  });
});

describe("community conversation is still Community", () => {
  // The distinction the fix must NOT overshoot: these look like chat and are
  // not. They live on the room, the society and the event, they raise no Chat
  // badge, and they are addressed to a membership rather than to a person.
  for (const type of [
    "community_message",
    "event_message",
    "society_announcement",
  ]) {
    it(`keeps ${type} in Community Updates`, () => {
      expect(notificationDomain(type)).toBe("community_updates");
      expect(isCommunityUpdateType(type)).toBe(true);
      expect(migrationList("community_update_types")).toContain(type);
    });
  }

  it("does not route on the word 'message'", () => {
    expect(notificationDomain("message")).toBe("chat");
    expect(notificationDomain("community_message")).toBe("community_updates");
    expect(notificationDomain("event_message")).toBe("community_updates");
  });
});

describe("the lists mirror the database", () => {
  it("matches community_update_types()", () => {
    expect(migrationList("community_update_types").sort()).toEqual(
      [...COMMUNITY_UPDATE_TYPES].sort()
    );
  });

  it("matches chat_notification_types()", () => {
    expect(migrationList("chat_notification_types").sort()).toEqual(
      [...CHAT_NOTIFICATION_TYPES].sort()
    );
  });

  it("matches social_notification_types()", () => {
    expect(migrationList("social_notification_types").sort()).toEqual(
      [...SOCIAL_NOTIFICATION_TYPES].sort()
    );
  });

  it("only lists types the notification system can actually emit", () => {
    for (const type of [
      ...COMMUNITY_UPDATE_TYPES,
      ...CHAT_NOTIFICATION_TYPES,
      ...SOCIAL_NOTIFICATION_TYPES,
    ]) {
      expect(isNotificationType(type)).toBe(true);
    }
  });

  it("uses the same four domain names as the SQL", () => {
    for (const domain of [
      "community_updates",
      "chat",
      "general_notifications",
      "system",
    ]) {
      expect(MIGRATION).toContain(`'${domain}'`);
    }
  });
});

describe("the rest of the routing table", () => {
  it("routes space-scoped social activity to Updates and feed activity away", () => {
    for (const type of SOCIAL_NOTIFICATION_TYPES) {
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

  it("leaves platform-level activity on the Notifications page", () => {
    for (const type of [
      "match",
      "help_response",
      "achievement",
      "appeal_result",
      "aura_adjusted",
      "content_moderated",
    ]) {
      expect(notificationDomain(type)).toBe("general_notifications");
      // ...even if some payload happens to name a community.
      expect(notificationDomain(type, { communityId: "c1" })).toBe(
        "general_notifications"
      );
    }
  });

  it("keeps admin broadcasts in the modal domain", () => {
    expect(notificationDomain("announcement")).toBe("system");
    expect(ACTIVITY_VISIBLE_TYPES as readonly string[]).not.toContain(
      "announcement"
    );
    expect(isCommunityUpdateType("announcement")).toBe(false);
  });

  it("assigns every emitted type exactly one domain", () => {
    const seen = new Map<string, string>();
    for (const t of COMMUNITY_UPDATE_TYPES) seen.set(t, "community_updates");
    for (const t of CHAT_NOTIFICATION_TYPES) {
      expect(seen.has(t)).toBe(false);
      seen.set(t, "chat");
    }
    for (const t of SOCIAL_NOTIFICATION_TYPES) expect(seen.has(t)).toBe(false);
  });
});

/**
 * The number from the brief, asserted as arithmetic rather than as prose: the
 * Community badge is count(*) over the community-domain rows, so five unread
 * DMs and three unread community updates is 3.
 */
describe("five DMs plus three community updates is a badge of 3", () => {
  const inbox = [
    { type: "message", subject: { conversationId: "v1" } },
    { type: "message", subject: { conversationId: "v2" } },
    { type: "message_request", subject: {} },
    { type: "message_reaction", subject: { conversationId: "v1" } },
    { type: "message_request_accepted", subject: {} },
    { type: "community_message", subject: { communityId: "c1" } },
    { type: "society_announcement", subject: { communityId: "c2" } },
    { type: "post_like", subject: { communityId: "c1" } },
  ];

  const count = (domain: string) =>
    inbox.filter((r) => notificationDomain(r.type, r.subject) === domain).length;

  it("counts 3 for Community", () => {
    expect(count("community_updates")).toBe(3);
  });

  it("counts 5 for Chat", () => {
    expect(count("chat")).toBe(5);
  });

  it("counts 0 for the general Notifications page", () => {
    expect(count("general_notifications")).toBe(0);
  });
});
