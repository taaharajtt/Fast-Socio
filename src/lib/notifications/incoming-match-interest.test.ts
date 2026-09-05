import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_VISIBLE_TYPES,
  isActivityVisibleType,
  isNotificationType,
  notificationCopy,
  notificationHref,
} from "@/lib/notifications/copy";
import {
  SYSTEM_NOTIFICATION_TYPES,
  notificationCategory,
  notificationView,
} from "@/lib/notifications/view";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIGRATION = read("supabase/migrations/0185_incoming_match_interest.sql");
const TYPE = "incoming_match_interest";

/**
 * "Someone tried to match with you" — the copy, the routing, and the anonymity.
 *
 * The DATABASE half (what the row contains, what the count means, the whole
 * lifecycle) is verified by supabase/tests/incoming_match_interest.sql. These
 * assert the half that lives in TypeScript: that the wording is mysterious and
 * plural-correct, that nothing on this side can render an identity, and that
 * the surfaces around it were not disturbed.
 */

describe("copy", () => {
  it("is singular for one pending like", () => {
    expect(notificationCopy(TYPE, null, {}, 1)).toBe(
      "Someone tried to match with you."
    );
  });

  it("is plural, with the number, for more than one", () => {
    expect(notificationCopy(TYPE, null, {}, 2)).toBe(
      "2 people tried to match with you."
    );
    expect(notificationCopy(TYPE, null, {}, 7)).toBe(
      "7 people tried to match with you."
    );
  });

  it("never says liked, right-swiped, or anything that names the act", () => {
    for (const count of [1, 2, 9]) {
      const text = notificationCopy(TYPE, "Alice", {}, count);
      expect(text.toLowerCase()).not.toContain("liked");
      expect(text.toLowerCase()).not.toContain("swipe");
      expect(text).toContain("tried to match with you");
    }
  });

  it("falls back to the singular for a malformed count", () => {
    // A count that is missing, zero, negative, fractional or NaN must never
    // render "0 people", "-1 people" or "NaN people".
    for (const bad of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const text = notificationCopy(TYPE, null, {}, bad as number);
      expect(text).toBe("Someone tried to match with you.");
    }
    // ...and a fractional count floors rather than rendering a decimal.
    expect(notificationCopy(TYPE, null, {}, 2.9)).toBe(
      "2 people tried to match with you."
    );
  });
});

describe("anonymity on this side of the boundary", () => {
  it("ignores an actor name entirely, even if one is passed", () => {
    // Nothing upstream should ever supply one (actor_id is null), but the copy
    // must not be the thing that leaks if something does.
    const withActor = notificationCopy(TYPE, "Alice Khan", {}, 1);
    expect(withActor).not.toContain("Alice");
    expect(withActor).toBe(notificationCopy(TYPE, null, {}, 1));
  });

  it("ignores any identifying payload that might appear in data", () => {
    const leaky = {
      user_id: "11111111-1111-4111-8111-111111111111",
      full_name: "Alice Khan",
      username: "i210001",
      avatar_url: "https://example.test/a.png",
      department: "CS",
      match_percentage: 91,
    };
    const text = notificationCopy(TYPE, "Alice Khan", leaky, 3);
    expect(text).toBe("3 people tried to match with you.");
    for (const value of Object.values(leaky)) {
      expect(text).not.toContain(String(value));
    }
    // ...and it cannot become a link to that person either.
    expect(notificationHref(TYPE, leaky)).toBe("/discover");
  });

  it("routes to the deck, never to a profile", () => {
    expect(notificationHref(TYPE, {})).toBe("/discover");
    expect(notificationHref(TYPE, { user_id: "abc" })).toBe("/discover");
    expect(notificationView(TYPE, null, {}, 4).href).toBe("/discover");
    expect(notificationView(TYPE, null, {}, 4).href).not.toContain("/profile");
  });

  it("gives the same anonymous string to a screen reader as to the eye", () => {
    // The list renders `text` as its accessible label, so there is only one
    // string to check — this asserts there is no second, richer variant.
    const view = notificationView(TYPE, "Alice", { user_id: "x" }, 2);
    expect(view.text).toBe("2 people tried to match with you.");
  });
});

describe("placement in the notification system", () => {
  it("is a known, renderable type", () => {
    expect(isNotificationType(TYPE)).toBe(true);
    expect(isActivityVisibleType(TYPE)).toBe(true);
    expect(ACTIVITY_VISIBLE_TYPES).toContain(TYPE);
  });

  it("files under Discover/matching", () => {
    expect(notificationCategory(TYPE)).toBe("discover");
  });

  it("is a system notification, so it is never bundled with an actor", () => {
    expect(SYSTEM_NOTIFICATION_TYPES.has(TYPE)).toBe(true);
  });

  it("is NOT a Community update", async () => {
    const { COMMUNITY_UPDATE_TYPES } = await import("@/lib/community/updates");
    expect(COMMUNITY_UPDATE_TYPES as readonly string[]).not.toContain(TYPE);
  });
});

describe("the rendered row carries no actor", () => {
  const LIST = read("src/components/notifications/activity-list.tsx");
  const BELL = read("src/components/notifications/notification-bell-menu.tsx");

  it("uses a generic icon on both surfaces", () => {
    expect(LIST).toContain(`${TYPE}: Sparkles`);
    expect(BELL).toContain(`${TYPE}: Sparkles`);
  });

  it("renders the actor-less treatment when there is no actor", () => {
    // The list already routes rows with no avatar AND no name to a neutral
    // circle with the type icon; a null actor_id produces exactly that.
    expect(LIST).toContain("const noActor = !item.avatar && !item.actorName");
  });

  it("passes the authoritative count into the copy on both surfaces", () => {
    // Without this the plural silently degrades to the singular.
    expect(read("src/components/notifications/notification-bell.tsx")).toContain(
      "n.group_count ?? 1"
    );
    expect(read("src/app/(student)/activity/page.tsx")).toContain(
      "actions[0].group_count ?? 1"
    );
  });
});

describe("push payload", () => {
  const push =
    MIGRATION.split("create or replace function public.dispatch_push_notification")[1] ??
    "";

  it("uses the same anonymous wording", () => {
    expect(push).toContain("'Someone tried to match with you'");
    expect(push).toContain("' people tried to match with you'");
  });

  it("guards the count the same way the UI does", () => {
    expect(push).toContain("greatest(coalesce(new.group_count, 1), 1)");
  });

  it("never puts the actor in this type's title or body", () => {
    const branch = push.split("when 'incoming_match_interest' then")[2] ?? "";
    const upToNext = branch.split("when '")[0];
    expect(upToNext).not.toContain("actor_name");
  });

  it("opens the deck when tapped", () => {
    // The dispatcher reads data->>'url', and the row is written with /discover.
    expect(MIGRATION).toContain("jsonb_build_object('url', '/discover')");
    expect(push).toContain("coalesce(new.data->>'url', '/activity')");
  });
});

describe("surrounding behaviour is undisturbed", () => {
  it("still counts as ONE unread row, whatever the group_count says", () => {
    // The Activity badge counts ROWS. If it ever summed group_count, a single
    // anonymous aggregate would inflate the bell to the number of likers.
    const bootstrap = read("supabase/migrations/0174_home_bootstrap.sql");
    expect(bootstrap).toContain("select count(*)");
    expect(bootstrap).not.toContain("sum(group_count)");
  });

  it("leaves the dock badges' 9+ rule alone", () => {
    expect(read("src/components/floating-dock.tsx")).toContain(
      'badge > 9 ? "9+" : badge'
    );
  });

  it("does not touch create_notification or generic grouping", () => {
    // 0057's increment-on-different-actor rule is wrong for a null actor, so
    // this feature upserts its own row instead of changing shared behaviour.
    expect(MIGRATION).not.toContain("create or replace function public.create_notification");
    expect(MIGRATION).toContain("group_count = excluded.group_count");
  });

  it("does not weaken swipes RLS or add a client-callable probe", () => {
    expect(MIGRATION).not.toMatch(/policy .* on public\.swipes/);
    expect(MIGRATION).toContain(
      "revoke all on function public.reconcile_incoming_match_interest(uuid, boolean)\n  from public, anon, authenticated;"
    );
    expect(MIGRATION).not.toContain(
      "grant execute on function public.reconcile_incoming_match_interest"
    );
  });

  it("keeps the wake ledger unreadable by clients", () => {
    expect(MIGRATION).toContain(
      "revoke all on public.incoming_interest_wakes from anon, authenticated"
    );
    expect(MIGRATION).toContain(
      "alter table public.incoming_interest_wakes enable row level security"
    );
    // RLS on with no policy at all: nothing to select through.
    expect(MIGRATION).not.toMatch(/create policy .* on public\.incoming_interest_wakes/);
  });

  it("preserves the match award and the conversation reopen", () => {
    expect(MIGRATION).toContain("values (new.swiper_id, 10, 'match'), (new.target_id, 10, 'match')");
    expect(MIGRATION).toContain("set closed_at = null, closed_reason = null");
  });
});
