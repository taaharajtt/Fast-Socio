import { describe, expect, it } from "vitest";
import { deriveChatBadge, toBadge } from "./badge-count";
import type { InboxBadgeSource } from "./badge-count";
import type { InboxThread } from "./inbox-types";
import type { IncomingRequest } from "@/components/chat/request-row";

/**
 * `deriveChatBadge` replaced a `chat_badge_count()` round trip on every realtime
 * event (perf audit Phase 3a). It is therefore the one place a merge intended to
 * save queries could instead start rendering a WRONG number, so its agreement
 * with the SQL definition is pinned here rather than assumed.
 *
 * The SQL it must match, after migration 0176 reconciled the two:
 *
 *   conversations = count(distinct m.conversation_id)
 *                     where m.sender_id <> me
 *                       and m.read_at is null
 *                       and m.hidden = false
 *   requests      = count(*) from message_requests
 *                     where recipient_id = me and status = 'pending'
 *   total         = conversations + requests
 *
 * The `hidden` and `sender_id`/`read_at` predicates are applied server-side, in
 * `conversation_unread_counts()`, before `unread` ever reaches the client. So
 * what these tests can and must pin is the COLLAPSING rule: a thread counts
 * once regardless of how many unread messages it holds, spaces never count, and
 * requests count one apiece.
 */

const dm = (convId: string, unread: number): InboxThread => ({
  kind: "dm",
  ts: "2026-08-31T00:00:00Z",
  convId,
  otherId: `other-${convId}`,
  preview: "hi",
  unread,
  lastOutgoing: null,
});

const space = (id: string): InboxThread => ({
  kind: "space",
  ts: "2026-08-31T00:00:00Z",
  preview: "someone: hi",
  space: {
    id,
    name: "Team",
    avatar_url: null,
    cover_url: null,
    is_society: false,
    is_official: false,
    status: "approved",
    is_discover_group: true,
    discover_mode: "project",
    discover_title: "Build a thing",
  },
});

const req = (id: string): IncomingRequest => ({
  id,
  message: "hey",
  senderName: "Student",
  senderAvatar: null,
  senderDept: null,
});

const src = (
  threads: InboxThread[],
  incoming: IncomingRequest[] = []
): InboxBadgeSource => ({ threads, incoming });

describe("deriveChatBadge", () => {
  it("is zero for an empty inbox", () => {
    expect(deriveChatBadge(src([]))).toEqual(toBadge(0, 0));
  });

  it("counts CONVERSATIONS, not messages", () => {
    // The 0169 rule: three unread messages in one thread are one thing to go
    // and read. Counting messages here would silently revive the pre-0169 bug.
    expect(deriveChatBadge(src([dm("a", 3)])).conversations).toBe(1);
    expect(deriveChatBadge(src([dm("a", 97)])).conversations).toBe(1);
  });

  it("counts one per unread thread and ignores read ones", () => {
    const badge = deriveChatBadge(
      src([dm("a", 1), dm("b", 0), dm("c", 5), dm("d", 0)])
    );
    expect(badge.conversations).toBe(2);
  });

  it("never counts spaces, even when they are the only threads", () => {
    // Discover team rooms carry no unread count and are excluded from the badge
    // on the server too. Counting them would make the dock disagree with the
    // layout on first paint — the exact class of bug this derivation risks.
    expect(deriveChatBadge(src([space("s1"), space("s2")])).conversations).toBe(0);
    const mixed = deriveChatBadge(src([dm("a", 2), space("s1"), dm("b", 0)]));
    expect(mixed.conversations).toBe(1);
  });

  it("counts each pending request once", () => {
    expect(deriveChatBadge(src([], [req("r1"), req("r2")])).requests).toBe(2);
  });

  it("totals conversations plus requests through the shared rule", () => {
    const badge = deriveChatBadge(src([dm("a", 1), dm("b", 4)], [req("r1")]));
    expect(badge).toEqual(toBadge(2, 1));
    expect(badge.total).toBe(3);
  });

  it("treats a negative or absent unread as read rather than throwing", () => {
    // Defensive: `unread` comes from a SQL aggregate and should never be
    // negative, but a badge is decoration and must not be able to throw inside
    // the layout it renders in.
    expect(deriveChatBadge(src([dm("a", -1)])).conversations).toBe(0);
    expect(
      deriveChatBadge(src([dm("a", undefined as unknown as number)])).conversations
    ).toBe(0);
  });

  it("agrees with the server RPC shape for the same underlying rows", () => {
    // A worked example: 2 unread threads, 1 read thread, 1 space, 3 requests.
    // chat_badge_count() would return {conversations: 2, requests: 3} for the
    // same rows, and both paths run through toBadge, so the objects must match
    // field for field — not merely agree on `total`.
    const derived = deriveChatBadge(
      src(
        [dm("a", 1), dm("b", 9), dm("c", 0), space("s1")],
        [req("r1"), req("r2"), req("r3")]
      )
    );
    expect(derived).toEqual(toBadge(2, 3));
  });
});
