import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setCommunityBadge } from "./badge-store";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Code only — these files explain at length what they no longer do, and an
 *  assertion that reads the prose fails on the explanation. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const HUB = code("src/app/(student)/communities/page.tsx");
const UPDATES_PAGE = code("src/app/(student)/communities/updates/page.tsx");
const LIST = code("src/components/communities/community-updates-list.tsx");
const ACTIONS = code("src/app/(student)/communities/updates/actions.ts");
const REALTIME = code("src/components/communities/community-realtime.tsx");
const DOCK = code("src/components/floating-dock.tsx");
const LAYOUT = code("src/app/(student)/layout.tsx");
const DATA = code("src/lib/community/updates-data.ts");
const MIGRATION = read("supabase/migrations/0183_community_updates.sql");
/** The routing correction. 0192 claimed the DM family for Community; this is
 *  the migration that gives Chat its own domain and takes them back. */
const MIG195 = read("supabase/migrations/0195_notification_domain_routing.sql");
const CHAT_BADGE = code("src/lib/chat/badge-count.ts");

/**
 * Wiring and semantics, asserted at the source level.
 *
 * vitest here runs pure logic with no DOM and no database (see
 * vitest.config.ts), so these cannot render the dock or query the view. What
 * they CAN do is fail the build the moment a rule this redesign exists to
 * establish is quietly undone — a page that marks everything read on open, a
 * badge decremented from a client event, a second realtime subscription. The
 * behavioural half lives in supabase/tests/community_updates.sql.
 */

describe("the old seen model is gone from the app", () => {
  it("has no seen helper left", () => {
    expect(existsSync(join(ROOT, "src/lib/community/seen.ts"))).toBe(false);
  });

  it("opening /communities marks nothing read", () => {
    expect(HUB).not.toContain("markCommunityHubSeen");
    expect(HUB).not.toContain("touch_community_seen");
    // ...and no other read-clearing call sneaked in either.
    expect(HUB).not.toContain("mark_community_updates_read");
    expect(HUB).not.toContain("markAllCommunityUpdatesRead");
  });

  it("opening one space marks nothing read", () => {
    for (const rel of [
      "src/app/(student)/communities/[id]/page.tsx",
      "src/app/(student)/societies/[id]/page.tsx",
    ]) {
      const src = code(rel);
      expect(src).not.toContain("markCommunitySpaceSeen");
      expect(src).not.toContain("touch_community_space_seen");
    }
  });

  it("opening the Updates screen itself marks nothing read", () => {
    // Read is a deliberate act: open an item, or press Mark all as read.
    expect(UPDATES_PAGE).not.toContain("markAll");
    expect(UPDATES_PAGE).not.toContain("AutoMarkRead");
    expect(UPDATES_PAGE).not.toContain("mark_community");
  });
});

describe("Updates is discoverable from the hub", () => {
  it("puts the entry above the sections", () => {
    expect(HUB).toContain("UpdatesEntry");
    expect(HUB.indexOf("UpdatesLink")).toBeLessThan(
      HUB.indexOf("<CommunitySections")
    );
  });

  it("routes to the full list", () => {
    expect(code("src/components/communities/updates-entry.tsx")).toContain(
      '"/communities/updates"'
    );
  });

  it("renders 9+ past nine, like the dock", () => {
    const entry = code("src/components/communities/updates-entry.tsx");
    expect(entry).toContain('unread > 9 ? "9+" : unread');
    expect(DOCK).toContain('badge > 9 ? "9+" : badge');
  });

  it("renders no badge at zero", () => {
    // Both surfaces gate on a positive count rather than rendering a "0" pill.
    expect(code("src/components/communities/updates-entry.tsx")).toContain(
      "unread > 0"
    );
    expect(DOCK).toContain("badge > 0 &&");
  });
});

describe("one canonical source for the list and the number", () => {
  it("reads the list from the same view the badge counts", () => {
    expect(DATA).toContain('.from("community_updates")');
    expect(MIGRATION).toContain("create or replace view public.community_updates");
    expect(MIGRATION).toContain(
      "select count(*) from public.community_updates u where u.read_at is null"
    );
  });

  it("never derives the total from the loaded page", () => {
    // The unread count is its own exact count; paging must not change it.
    expect(DATA).toContain('{ count: "exact", head: true }');
    expect(DATA).not.toContain("items.length");
  });

  it("does not invent a second table", () => {
    expect(MIGRATION).not.toContain("create table public.community_updates");
    expect(MIGRATION).toContain("public.notifications_live");
  });
});

describe("read and clearing semantics", () => {
  it("marks exactly one item read when it is opened", () => {
    expect(LIST).toContain("markCommunityUpdateRead(item.id)");
    expect(ACTIONS).toContain('rpc("mark_community_update_read"');
  });

  it("offers Mark all as read", () => {
    expect(LIST).toContain("Mark all as read");
    expect(ACTIONS).toContain('rpc("mark_community_updates_read"');
  });

  it("goes through RPCs that scope by auth.uid(), never by a client id", () => {
    // No recipient parameter exists anywhere in the mark-read path.
    expect(ACTIONS).not.toContain("user_id:");
    expect(MIGRATION).toContain("user_id = (select auth.uid())");
  });

  it("is idempotent — the RPC only touches rows that are still unread", () => {
    const fn =
      MIGRATION.split(
        "create or replace function public.mark_community_update_read"
      )[1]?.split("$$;")[0] ?? "";
    expect(fn).toContain("read_at is null");
    expect(fn).toContain("user_id = (select auth.uid())");
  });
});

describe("the badge is only ever set from an authoritative count", () => {
  it("never increments or decrements in the client", () => {
    for (const src of [LIST, REALTIME, code("src/lib/community/badge-store.ts")]) {
      expect(src).not.toMatch(/setCommunityBadge\([^)]*[+-]\s*1\)/);
      expect(src).not.toContain("count + 1");
      expect(src).not.toContain("count - 1");
    }
  });

  it("takes the server's number after every mutation", () => {
    expect(LIST).toContain("setCommunityBadge(res.unread)");
    expect(ACTIONS).toContain("fetchCommunityBadge");
  });

  it("clamps anything impossible before the dock can render it", () => {
    setCommunityBadge(-3);
    expect(() => setCommunityBadge(Number.NaN)).not.toThrow();
    // The store's guard is the last line of defence; the shape is asserted in
    // badge-count.test.ts and re-checked here at the store boundary.
    expect(code("src/lib/community/badge-store.ts")).toContain(
      "Number.isFinite(next) && next > 0"
    );
  });
});

describe("realtime", () => {
  it("uses ONE subscription, on one table", () => {
    const subscriptions = REALTIME.match(/postgres_changes/g) ?? [];
    expect(subscriptions).toHaveLength(1);
    expect(REALTIME).toContain('table: "notifications"');
  });

  it("does not subscribe per community, per type or per row", () => {
    expect(REALTIME).not.toContain("filter:");
    expect(REALTIME).not.toContain("community_id=eq");
  });

  it("reconciles by re-reading the authoritative count", () => {
    expect(REALTIME).toContain("refreshCommunityBadge()");
    expect(REALTIME).toContain("onCatchUp");
  });

  it("cleans up on viewer change", () => {
    expect(REALTIME).toContain("clearCommunityBadge()");
  });

  it("does not duplicate the chat listener", () => {
    const chat = code("src/components/chat/chat-realtime.tsx");
    expect(chat).not.toContain("notifications");
    expect(chat).not.toContain("CommunityBadge");
  });

  it("puts the table in the realtime publication through the migration", () => {
    expect(MIGRATION).toContain(
      "alter publication supabase_realtime add table public.notifications"
    );
  });

  it("keeps a server-rendered badge when realtime is unavailable", () => {
    // The store falls through to the server value until realtime has something
    // fresher, so a dead socket degrades to the old per-navigation behaviour.
    expect(code("src/lib/community/badge-store.ts")).toContain(
      "live ?? serverValue"
    );
    expect(LAYOUT).toContain("initialBadge={bootstrap.community.total}");
  });
});

describe("chat is untouched", () => {
  it("still has its own badge and its own store", () => {
    expect(DOCK).toContain("useChatBadge");
    expect(DOCK).toContain("useCommunityBadge");
    expect(LAYOUT).toContain("<ChatRealtime");
  });

  it("keeps community chat out of the Community badge", () => {
    expect(MIGRATION).not.toContain("community_chat_messages");
    expect(MIGRATION).not.toContain("'community_message'");
  });
});

/**
 * THE ROUTING CORRECTION (migration 0195).
 *
 * 0192 put `message`, `message_request`, `message_request_accepted` and
 * `message_reaction` in `community_update_types()`, so private chat traffic
 * rendered inside Community → Updates and counted towards the Community dock
 * badge. These assertions are the source-level half of the fence; the
 * behavioural half is supabase/tests/notification_domain_routing.sql, and the
 * pure classification is covered in lib/notifications/domain.test.ts.
 */
describe("DMs are Chat, and only Chat", () => {
  it("removes the DM family from the community type list", () => {
    const body =
      MIG195.split(
        "create or replace function public.community_update_types()"
      )[1]?.split("$$;")[0] ?? "";
    expect(body).not.toContain("'message'");
    expect(body).not.toContain("'message_request'");
    expect(body).not.toContain("'message_request_accepted'");
    expect(body).not.toContain("'message_reaction'");
    // ...while the SPACE conversations stay, which is the distinction the fix
    // must not overshoot.
    expect(body).toContain("'community_message'");
    expect(body).toContain("'event_message'");
    expect(body).toContain("'society_announcement'");
  });

  it("gives chat its own domain rather than folding it into another", () => {
    expect(MIG195).toContain("create or replace function public.chat_notification_types()");
    expect(MIG195).toContain("then 'chat'");
    expect(MIG195).toContain("create or replace view public.chat_notifications");
  });

  it("classifies by subject, never by URL or display copy", () => {
    // The domain rule takes the four SUBJECT columns and nothing else.
    expect(MIG195).toContain("p_conversation uuid");
    expect(MIG195).toContain("n.subject_conversation_id");
    expect(MIG195).not.toContain("href");
    expect(MIG195).not.toMatch(/like '%\/chat/);
  });

  it("drops the three-argument rule so nothing can ask the blind version", () => {
    expect(MIG195).toContain(
      "drop function if exists public.notification_domain(text, uuid, uuid)"
    );
  });

  it("counts the Community badge off the view, so DMs contribute zero", () => {
    expect(MIG195).toContain(
      "select count(*) from public.community_updates u where u.read_at is null"
    );
  });

  it("leaves the Chat badge on messages, not on notification rows", () => {
    // The two badges measure different things out of different tables, which is
    // why nothing Community does to a notification row can move Chat's number.
    expect(CHAT_BADGE).toContain("chat_badge_count");
    expect(CHAT_BADGE).not.toContain("community_updates");
    expect(CHAT_BADGE).not.toContain("notification");
  });

  it("bounds every mark-read to its own surface", () => {
    // Community's two RPCs test membership of the community_updates VIEW...
    expect(MIG195).toContain(
      "exists (select 1 from public.community_updates u where u.id = n.id)"
    );
    // ...and the Notifications page's auto-mark-read, which used to clear
    // EVERY unread row of the caller's (including the Community badge and
    // every chat row), is now scoped to its own domain.
    const markAll =
      MIG195.split(
        "create or replace function public.mark_notifications_read()"
      )[1]?.split("$$;")[0] ?? "";
    expect(markAll).toContain("= 'general_notifications'");
  });

  it("deletes no DM rows and rewrites no message history", () => {
    expect(MIG195).not.toMatch(/delete\s+from\s+public\.notifications/i);
    expect(MIG195).not.toMatch(/update\s+public\.messages/i);
    expect(MIG195).not.toMatch(/update\s+public\.message_requests/i);
  });
});
