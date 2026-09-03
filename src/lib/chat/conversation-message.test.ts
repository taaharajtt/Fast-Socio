import { describe, expect, it } from "vitest";
import {
  displayName,
  fromAnnouncementRow,
  fromCommunityRow,
  fromEventRow,
  isInert,
  quoteLabel,
  toQuotable,
} from "@/lib/chat/conversation-message";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function communityRow(over: Partial<Parameters<typeof fromCommunityRow>[0]> = {}) {
  return {
    id: "m1",
    sender_id: OTHER,
    sender_name: "Ali",
    sender_avatar: null,
    sender_gender: null,
    body: "hello",
    poll_id: null,
    is_anonymous: false,
    created_at: "2026-09-01T10:00:00.000Z",
    deleted_at: null,
    edited_at: null,
    pinned_at: null,
    reply_to_id: null,
    attachment_url: null,
    attachment_type: null,
    ...over,
  };
}

describe("fromCommunityRow", () => {
  it("marks my own message as mine", () => {
    expect(fromCommunityRow(communityRow({ sender_id: ME }), ME).mine).toBe(true);
    expect(fromCommunityRow(communityRow(), ME).mine).toBe(false);
  });

  it("carries the view's masking through rather than undoing it", () => {
    // Someone else's anonymous message reaches the client with NULLs already —
    // the view masked it — so the model must not invent an identity.
    const m = fromCommunityRow(
      communityRow({ sender_id: null, sender_name: null, is_anonymous: true }),
      ME
    );
    expect(m.authorId).toBeNull();
    expect(m.authorName).toBeNull();
    expect(m.mine).toBe(false);
    expect(displayName(m)).toBe("Anonymous");
  });

  it("names my OWN anonymous message as mine", () => {
    // The view discloses my own id back to me even when the message is
    // anonymous, so I can still tell which one I wrote.
    const m = fromCommunityRow(
      communityRow({ sender_id: ME, is_anonymous: true }),
      ME
    );
    expect(m.mine).toBe(true);
    expect(displayName(m)).toBe("You (anonymous)");
  });

  it("treats an empty body (an image or a tombstone) as no text", () => {
    const m = fromCommunityRow(
      communityRow({ body: "", attachment_url: "c/1.jpg", attachment_type: "image" }),
      ME
    );
    expect(m.body).toBeNull();
    expect(m.attachmentType).toBe("image");
  });

  it("only accepts 'image' as an attachment type", () => {
    const m = fromCommunityRow(
      communityRow({ attachment_url: "c/1.bin", attachment_type: "video" }),
      ME
    );
    expect(m.attachmentType).toBeNull();
  });

  it("reads pinned from pinned_at", () => {
    expect(fromCommunityRow(communityRow(), ME).pinned).toBe(false);
    expect(
      fromCommunityRow(communityRow({ pinned_at: "2026-09-01T10:05:00Z" }), ME).pinned
    ).toBe(true);
  });

  it("tolerates a database without mig 0179 applied", () => {
    // The columns are optional on the type, so a row read before the migration
    // lands renders as an ordinary message instead of throwing.
    const row = communityRow();
    delete (row as Record<string, unknown>).edited_at;
    delete (row as Record<string, unknown>).pinned_at;
    delete (row as Record<string, unknown>).reply_to_id;
    const m = fromCommunityRow(row, ME);
    expect(m.editedAt).toBeNull();
    expect(m.pinned).toBe(false);
    expect(m.replyToId).toBeNull();
  });
});

describe("fromEventRow", () => {
  it("is never anonymous — attendees coordinate openly", () => {
    const m = fromEventRow(
      {
        id: "e1",
        sender_id: OTHER,
        sender_name: "Sara",
        sender_avatar: null,
        body: "see you there",
        created_at: "2026-09-01T10:00:00.000Z",
        edited_at: null,
        deleted_at: null,
        reply_to_id: null,
        attachment_url: null,
        attachment_type: null,
      },
      ME
    );
    expect(m.isAnonymous).toBe(false);
    expect(displayName(m, "Attendee")).toBe("Sara");
  });

  it("carries a tombstone through", () => {
    const m = fromEventRow(
      {
        id: "e1",
        sender_id: ME,
        sender_name: null,
        sender_avatar: null,
        body: "",
        created_at: "2026-09-01T10:00:00.000Z",
        deleted_at: "2026-09-01T11:00:00.000Z",
      },
      ME
    );
    expect(m.deletedAt).not.toBeNull();
    expect(isInert(m)).toBe(true);
  });
});

function announcementRow(
  over: Partial<Parameters<typeof fromAnnouncementRow>[0]> = {}
) {
  return {
    id: "a1",
    author_id: OTHER,
    author_name: "Committee",
    author_avatar: null,
    title: null,
    body: "Doors at 6",
    poll_id: null,
    attachment_url: null,
    attachment_type: null,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    pinned: false,
    is_mine: false,
    ...over,
  };
}

describe("fromAnnouncementRow", () => {
  it("folds a legacy title into the body's first line", () => {
    // Pre-0147 broadcasts carry a title. The channel is a conversation now, so
    // a card heading nothing else in the thread has would read as a different
    // kind of object.
    const m = fromAnnouncementRow(
      announcementRow({ title: "Auditions", body: "Doors at 6" })
    );
    expect(m.body).toBe("Auditions\nDoors at 6");
  });

  it("keeps a title-only broadcast readable", () => {
    const m = fromAnnouncementRow(announcementRow({ title: "Auditions", body: "" }));
    expect(m.body).toBe("Auditions");
  });

  it("leaves a poll's body to PollCard so the question is not printed twice", () => {
    const m = fromAnnouncementRow(
      announcementRow({ poll_id: "p1", body: "Which day?" })
    );
    expect(m.body).toBeNull();
    expect(m.pollId).toBe("p1");
  });

  it("reports an edit only when updated_at is meaningfully later", () => {
    expect(fromAnnouncementRow(announcementRow()).editedAt).toBeNull();
    expect(
      fromAnnouncementRow(
        announcementRow({ updated_at: "2026-09-01T10:00:00.500Z" })
      ).editedAt
    ).toBeNull();
    expect(
      fromAnnouncementRow(
        announcementRow({ updated_at: "2026-09-01T12:00:00.000Z" })
      ).editedAt
    ).toBe("2026-09-01T12:00:00.000Z");
  });

  it("never reports a tombstone — broadcasts are hard-deleted", () => {
    expect(fromAnnouncementRow(announcementRow()).deletedAt).toBeNull();
  });

  it("honours anonymity from the masked view", () => {
    const m = fromAnnouncementRow(
      announcementRow({
        is_anonymous: true,
        author_id: null,
        author_name: null,
      })
    );
    expect(m.authorName).toBeNull();
    expect(displayName(m)).toBe("Anonymous");
  });
});

describe("toQuotable", () => {
  it("stands a photo in for a body-less image message", () => {
    const m = fromCommunityRow(
      communityRow({ body: "", attachment_url: "c/1.jpg", attachment_type: "image" }),
      ME
    );
    expect(toQuotable(m).attachment_type).toBe("image");
    expect(toQuotable(m).body).toBeNull();
  });

  it("marks a poll so a quote does not read as a plain message", () => {
    const m = fromCommunityRow(
      communityRow({ poll_id: "p1", body: "Which day?" }),
      ME
    );
    expect(toQuotable(m).body).toBe("📊 Which day?");
  });

  it("reports a deleted target so the quote says so", () => {
    const m = fromCommunityRow(
      communityRow({ body: "", deleted_at: "2026-09-01T11:00:00Z" }),
      ME
    );
    expect(toQuotable(m).deleted_at).not.toBeNull();
  });
});

describe("quoteLabel", () => {
  const mine = { mine: true };
  const theirs = { mine: false };

  it("names the quoted author in a group thread", () => {
    const quoted = fromCommunityRow(communityRow({ sender_name: "Ali" }), ME);
    expect(quoteLabel(theirs, quoted)).toBe("Replied to Ali");
    expect(quoteLabel(mine, quoted)).toBe("You replied to Ali");
  });

  it("says 'you' when the quoted message is the reader's", () => {
    const quoted = fromCommunityRow(communityRow({ sender_id: ME }), ME);
    expect(quoteLabel(theirs, quoted)).toBe("Replied to you");
    expect(quoteLabel(mine, quoted)).toBe("You replied to yourself");
  });

  it("NEVER names an anonymous author", () => {
    const quoted = fromCommunityRow(
      communityRow({ sender_id: null, sender_name: null, is_anonymous: true }),
      ME
    );
    expect(quoteLabel(theirs, quoted)).toBe("Replied to an anonymous message");
    expect(quoteLabel(mine, quoted)).toBe("You replied to an anonymous message");
  });

  it("degrades gracefully when the quoted row could not be loaded", () => {
    expect(quoteLabel(theirs, null)).toBe("Replied");
    expect(quoteLabel(mine, undefined)).toBe("You replied");
  });
});

describe("isInert", () => {
  it("is true for a tombstone, an unsent bubble and a failed send", () => {
    const base = fromCommunityRow(communityRow(), ME);
    expect(isInert(base)).toBe(false);
    expect(isInert({ ...base, deletedAt: "2026-09-01T11:00:00Z" })).toBe(true);
    expect(isInert({ ...base, id: "temp-abc" })).toBe(true);
    expect(isInert({ ...base, status: "error" })).toBe(true);
  });
});
