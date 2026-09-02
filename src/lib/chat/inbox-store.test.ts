import { beforeEach, describe, expect, it } from "vitest";
import {
  claimInboxStore,
  clearInboxSnapshot,
  getInboxSnapshot,
  setInboxSnapshot,
} from "@/lib/chat/inbox-store";
import type { InboxData } from "@/lib/chat/inbox-types";

const inbox = (me: string): InboxData => ({
  me,
  threads: [],
  newMatches: [],
  outgoing: [],
  profiles: {},
  incoming: [],
});

beforeEach(() => {
  clearInboxSnapshot();
});

describe("inbox store — user isolation", () => {
  it("holds a snapshot for the account it was claimed for", () => {
    claimInboxStore("u1");
    setInboxSnapshot(inbox("u1"));
    expect(getInboxSnapshot()?.me).toBe("u1");
  });

  it("drops the previous account's snapshot the moment a new one claims it", () => {
    claimInboxStore("u1");
    setInboxSnapshot(inbox("u1"));
    // Signing in as someone else in the same tab: module state outlives the
    // session, so this must not leave u1's inbox readable for even one frame.
    claimInboxStore("u2");
    expect(getInboxSnapshot()).toBeNull();
  });

  it("ignores a read that was in flight across an account switch", () => {
    claimInboxStore("u2");
    // A refreshInbox() launched under u1 lands late.
    setInboxSnapshot(inbox("u1"));
    expect(getInboxSnapshot()).toBeNull();
  });

  it("clears on sign-out", () => {
    claimInboxStore("u1");
    setInboxSnapshot(inbox("u1"));
    clearInboxSnapshot();
    expect(getInboxSnapshot()).toBeNull();
  });

  it("re-claiming for the same user keeps the snapshot (a remount is not a switch)", () => {
    claimInboxStore("u1");
    setInboxSnapshot(inbox("u1"));
    claimInboxStore("u1");
    expect(getInboxSnapshot()?.me).toBe("u1");
  });
});
