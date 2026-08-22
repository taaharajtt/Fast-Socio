import { describe, expect, it } from "vitest";
import { inboxWatermark, pickFreshestInbox } from "./inbox-freshness";
import type { InboxData, InboxThread } from "./inbox-types";

const dm = (convId: string, ts: string, preview: string): InboxThread => ({
  kind: "dm",
  ts,
  convId,
  otherId: "other",
  preview,
  unread: 0,
});

const inbox = (me: string, threads: InboxThread[]): InboxData => ({
  me,
  threads,
  newMatches: [],
  profiles: {},
  incoming: [],
});

const OLD = "2026-08-23T10:00:00.000Z";
const NEW = "2026-08-23T10:05:00.000Z";

describe("inboxWatermark", () => {
  it("is the newest thread timestamp", () => {
    const data = inbox("me", [dm("a", OLD, "hi"), dm("b", NEW, "yo")]);
    expect(inboxWatermark(data)).toBe(new Date(NEW).getTime());
  });

  it("is 0 for an empty inbox", () => {
    expect(inboxWatermark(inbox("me", []))).toBe(0);
  });
});

describe("pickFreshestInbox", () => {
  it("falls back to the server payload when nothing is stored", () => {
    const server = inbox("me", [dm("a", OLD, "hi")]);
    expect(pickFreshestInbox(server, null)).toBe(server);
  });

  it("prefers the store when it holds a newer message", () => {
    // THE reported bug, in one assertion: the user was inside a thread when a
    // message arrived (so only the layout-level listener saw it), then came
    // back via the back gesture, which replays the OLD page payload.
    const replayedServerPayload = inbox("me", [dm("a", OLD, "You: hey")]);
    const liveSnapshot = inbox("me", [dm("a", NEW, "Ali: new message")]);
    expect(pickFreshestInbox(replayedServerPayload, liveSnapshot)).toBe(liveSnapshot);
  });

  it("prefers a genuinely newer server render over an older snapshot", () => {
    const server = inbox("me", [dm("a", NEW, "Ali: new message")]);
    const stale = inbox("me", [dm("a", OLD, "You: hey")]);
    expect(pickFreshestInbox(server, stale)).toBe(server);
  });

  it("prefers the snapshot on a tie — it carries the later unread counts", () => {
    const server = inbox("me", [dm("a", NEW, "Ali: hi")]);
    const snapshot = inbox("me", [dm("a", NEW, "Ali: hi")]);
    expect(pickFreshestInbox(server, snapshot)).toBe(snapshot);
  });

  it("never renders another account's inbox", () => {
    // Module state outlives a sign-out; a snapshot for someone else must not
    // reach the screen even for a frame, however new it is.
    const server = inbox("me", [dm("a", OLD, "hi")]);
    const otherAccount = inbox("someone-else", [dm("z", NEW, "secret")]);
    expect(pickFreshestInbox(server, otherAccount)).toBe(server);
  });

  it("prefers a snapshot with a thread when the server render has none", () => {
    const server = inbox("me", []);
    const snapshot = inbox("me", [dm("a", NEW, "Ali: first message")]);
    expect(pickFreshestInbox(server, snapshot)).toBe(snapshot);
  });
});
