import { describe, expect, it } from "vitest";
import { inboxWatermark, pickFreshestInbox } from "@/lib/chat/inbox-freshness";
import { EPOCH, type InboxData } from "@/lib/chat/inbox-types";

const T0 = "2026-08-29T10:00:00.000Z";
const T1 = "2026-08-29T10:05:00.000Z";

function inbox(
  me: string,
  threads: { ts: string; convId?: string; unread?: number }[]
): InboxData {
  return {
    me,
    threads: threads.map((t, i) => ({
      kind: "dm",
      ts: t.ts,
      convId: t.convId ?? `conv-${i}`,
      otherId: "other",
      preview: null,
      unread: t.unread ?? 0,
      lastOutgoing: null,
    })),
    newMatches: [],
    profiles: {},
    incoming: [],
  };
}

describe("inboxWatermark", () => {
  it("is the newest thread timestamp", () => {
    expect(inboxWatermark(inbox("u1", [{ ts: T0 }, { ts: T1 }]))).toBe(
      new Date(T1).getTime()
    );
  });

  it("is 0 for an empty inbox", () => {
    expect(inboxWatermark(inbox("u1", []))).toBe(0);
  });

  it("ignores the EPOCH sentinel rather than treating it as activity", () => {
    expect(inboxWatermark(inbox("u1", [{ ts: EPOCH }]))).toBe(0);
  });
});

describe("pickFreshestInbox — cross-user isolation", () => {
  it("never renders another account's snapshot, however fresh it is", () => {
    const server = inbox("u1", [{ ts: T0 }]);
    const otherUsersNewerSnapshot = inbox("u2", [{ ts: T1 }]);
    expect(pickFreshestInbox(server, otherUsersNewerSnapshot)).toBe(server);
  });

  it("falls back to the server payload when there is no snapshot", () => {
    const server = inbox("u1", [{ ts: T0 }]);
    expect(pickFreshestInbox(server, null)).toBe(server);
  });
});

describe("pickFreshestInbox — staleness", () => {
  it("prefers a newer store snapshot over a replayed server payload", () => {
    // The back/forward case: Next reuses the page segment, so `server` is the
    // payload from BEFORE the user opened the thread, while the layout island
    // kept listening and read something newer.
    const replayedServer = inbox("u1", [{ ts: T0 }]);
    const stored = inbox("u1", [{ ts: T1 }]);
    expect(pickFreshestInbox(replayedServer, stored)).toBe(stored);
  });

  it("prefers a genuinely fresh server render over an older snapshot", () => {
    const freshServer = inbox("u1", [{ ts: T1 }]);
    const stored = inbox("u1", [{ ts: T0 }]);
    expect(pickFreshestInbox(freshServer, stored)).toBe(freshServer);
  });

  it("breaks a tie towards the snapshot, which carries newer unread counts", () => {
    // Same newest message, but the snapshot was read later in wall-clock time,
    // so its unread counts and request rows are the more recent of the two.
    const server = inbox("u1", [{ ts: T1, convId: "c", unread: 3 }]);
    const stored = inbox("u1", [{ ts: T1, convId: "c", unread: 0 }]);
    expect(pickFreshestInbox(server, stored)).toBe(stored);
  });

  it("does not lose a fresh server payload to an empty snapshot", () => {
    const server = inbox("u1", [{ ts: T1 }]);
    const stored = inbox("u1", []);
    expect(pickFreshestInbox(server, stored)).toBe(server);
  });
});
