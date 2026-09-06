import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Code only — these files explain at length what they deliberately do NOT do,
 *  and an assertion that reads the prose passes on the explanation. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const COMMUNITY_CHAT = code("src/components/communities/community-chat.tsx");
const EVENT_DISCUSSION = code("src/components/events/event-discussion.tsx");
const BROADCAST = code("src/components/societies/announcement-thread.tsx");
const DM_THREAD = code("src/components/chat/chat-thread.tsx");

const COMMUNITY_LOADER = code("src/lib/communities/chat-data.ts");
const EVENT_LOADER = code("src/lib/events/discussion-data.ts");
const SOCIETY_LOADER = code("src/lib/societies/queries.ts");

const ROOM_ROUTE = code("src/app/(student)/chat/c/[id]/page.tsx");
const COMMUNITY_ROUTE = code("src/app/(student)/communities/[id]/page.tsx");
const SOCIETY_ROUTE = code("src/app/(student)/societies/[id]/page.tsx");

const CAPSULE = code("src/components/chat/load-earlier.tsx");
const HOOK = code("src/components/chat/use-message-history.ts");

/** The three surfaces in scope. */
const IN_SCOPE = [
  ["community chat room", COMMUNITY_CHAT],
  ["event discussion", EVENT_DISCUSSION],
  ["society broadcast", BROADCAST],
] as const;

/**
 * WHICH SURFACES PAGE, AND WHICH MUST NOT.
 *
 * vitest here runs pure logic with no DOM (see vitest.config.ts), so these
 * cannot mount a thread and press the capsule — `history.test.ts` covers the
 * paging arithmetic and the scroll maths as pure functions. What these assert
 * is the WIRING: that the feature reached exactly the three community surfaces
 * and no others, which is the part a refactor would quietly get wrong.
 */
describe("the three community surfaces page their history", () => {
  for (const [label, src] of IN_SCOPE) {
    it(`${label} renders the capsule`, () => {
      expect(src).toContain("<LoadEarlier");
      expect(src).toContain("history.loadEarlier");
      expect(src).toContain("history.status");
    });

    it(`${label} drives it from the shared hook`, () => {
      expect(src).toContain("useMessageHistory({");
      expect(src).toContain("hasMore:");
    });

    it(`${label} stands its auto-scroll down during a prepend`, () => {
      // Without this the effect keys on `messages.length`, sees ten new rows,
      // and smooth-scrolls a reader at the bottom to the newest message —
      // undoing the compensation the hook just applied.
      expect(src).toContain("if (suppressAutoScroll) return;");
      expect(src).toContain("history.suppressAutoScroll");
      expect(src).toMatch(/messages\.length,\s*suppressAutoScroll\]/);
    });
  }
});

describe("the surfaces that must NOT change", () => {
  it("leaves the DM thread alone", () => {
    expect(DM_THREAD).not.toContain("LoadEarlier");
    expect(DM_THREAD).not.toContain("useMessageHistory");
  });

  it("leaves every other chat component alone", () => {
    for (const rel of [
      "src/components/chat/composer-input.tsx",
      "src/components/chat/chat-composer.tsx",
    ]) {
      expect(code(rel)).not.toContain("LoadEarlier");
    }
  });

  it("switches paging OFF for a Discover team room", () => {
    // A Discover group is the same <CommunityChat/> as a community room, so the
    // scope line has to be drawn at the ROUTE — the same place `allowAnonymous`
    // is decided — not in the component.
    expect(ROOM_ROUTE).toContain("paginated: !community.is_discover_group");
    expect(ROOM_ROUTE).toContain("paginated={!isDiscoverGroup}");
  });

  it("keeps the unpaged load path for it rather than deleting it", () => {
    expect(COMMUNITY_LOADER).toContain("COMMUNITY_CHAT_PAGE_SIZE");
    expect(COMMUNITY_LOADER).toContain("paginated");
  });

  it("gates the hook itself, so an unpaged surface cannot fetch", () => {
    expect(HOOK).toContain("enabled");
    expect(HOOK).toContain("if (\n      !enabled ||");
  });
});

describe("the routes ask for a paged first page", () => {
  it("the community room page does", () => {
    expect(COMMUNITY_ROUTE).toContain("{ paginated: true }");
    expect(COMMUNITY_ROUTE).toContain("hasMoreHistory={chat.hasMore}");
  });

  it("the room route does, for a non-Discover room", () => {
    expect(ROOM_ROUTE).toContain("hasMoreHistory={hasMore}");
  });

  it("the society page reads a page rather than a flat 50", () => {
    expect(SOCIETY_ROUTE).toContain("getSocietyAnnouncementPage(id)");
    expect(SOCIETY_ROUTE).not.toContain("getSocietyAnnouncements(id, 50)");
    expect(SOCIETY_ROUTE).toContain("hasMoreHistory={announcementPage.hasMore}");
  });
});

describe("every paged query is keyset, newest-first, with the id tiebreak", () => {
  for (const [label, src] of [
    ["community", COMMUNITY_LOADER],
    ["event", EVENT_LOADER],
    ["society", SOCIETY_LOADER],
  ] as const) {
    it(`${label}: orders by created_at desc THEN id desc`, () => {
      expect(src).toContain('.order("created_at", { ascending: false })');
      expect(src).toContain('.order("id", { ascending: false })');
    });

    it(`${label}: filters with the shared keyset predicate`, () => {
      expect(src).toContain("olderThanFilter(before)");
    });

    it(`${label}: uses no offset pagination`, () => {
      expect(src).not.toContain(".range(");
      expect(src).not.toContain("offset");
    });
  }

  it("fetches one row more than it shows, to answer hasMore", () => {
    expect(COMMUNITY_LOADER).toContain("HISTORY_FETCH_SIZE");
    expect(EVENT_LOADER).toContain("HISTORY_FETCH_SIZE");
    expect(SOCIETY_LOADER).toContain("limit + 1");
  });
});

describe("the server actions authorize themselves", () => {
  // A Server Function is reachable by direct POST, not only through the UI.
  const ACTIONS = [
    "src/app/(student)/communities/history-actions.ts",
    "src/app/(student)/events/history-actions.ts",
    "src/app/(student)/societies/history-actions.ts",
  ];

  for (const rel of ACTIONS) {
    it(`${rel.split("/").pop()} checks a session`, () => {
      const src = code(rel);
      expect(src).toContain('"use server"');
      expect(src).toContain("getAuthUserId()");
      expect(src).toContain("if (!userId)");
    });
  }

  it("re-derives community membership server-side instead of trusting a flag", () => {
    const src = code("src/app/(student)/communities/history-actions.ts");
    expect(src).toContain('.from("community_members")');
    expect(src).toContain("Boolean(membership)");
  });

  it("does not sit in a file the loader imports from", () => {
    // chat-data imports fetchPollResults FROM communities/actions, so putting
    // the pagination action back there closes an import cycle across a
    // "use server" boundary.
    const communityActions = code("src/app/(student)/communities/actions.ts");
    expect(communityActions).not.toContain("loadEarlierCommunityMessages");
  });
});

describe("older rows arrive complete, not stripped", () => {
  it("brings polls and reactions with a community page", () => {
    const src = code("src/app/(student)/communities/history-actions.ts");
    expect(src).toContain("polls");
    expect(src).toContain("reactions");
    expect(COMMUNITY_CHAT).toContain("setPolls((prev) => ({ ...page.polls, ...prev }))");
    expect(COMMUNITY_CHAT).toContain(
      "setReactions((prev) => ({ ...page.reactions, ...prev }))"
    );
  });

  it("brings reactions with an event page", () => {
    expect(code("src/lib/events/discussion-data.ts")).toContain(
      "event_message_reactions"
    );
    expect(EVENT_DISCUSSION).toContain(
      "setReactions((prev) => ({ ...page.reactions, ...prev }))"
    );
  });

  it("brings reactions with a broadcast page", () => {
    const src = code("src/app/(student)/societies/history-actions.ts");
    expect(src).toContain("getAnnouncementReactions");
  });

  it("keeps every message column the first paint has", () => {
    // A historic row must render identically to a fresh one — same reply,
    // edit, delete, pin, anonymity and attachment fields.
    for (const col of [
      "deleted_at",
      "edited_at",
      "pinned_at",
      "reply_to_id",
      "attachment_url",
      "attachment_type",
      "is_anonymous",
    ]) {
      expect(COMMUNITY_LOADER).toContain(col);
    }
    for (const col of [
      "deleted_at",
      "edited_at",
      "reply_to_id",
      "attachment_url",
      "attachment_type",
    ]) {
      expect(EVENT_LOADER).toContain(col);
    }
  });

  it("does not change who may post or moderate a broadcast", () => {
    const src = code("src/app/(student)/societies/history-actions.ts");
    expect(src).not.toContain(".insert(");
    expect(src).not.toContain(".update(");
    expect(src).not.toContain(".delete(");
  });
});

describe("the capsule itself", () => {
  it("is a real button with an accessible name and a focus ring", () => {
    expect(CAPSULE).toContain('type="button"');
    expect(CAPSULE).toContain('aria-label=');
    expect(CAPSULE).toContain("focus-visible:ring");
  });

  it("says what it does", () => {
    expect(CAPSULE).toContain("Load earlier messages");
  });

  it("has a disabled and a busy state while loading", () => {
    expect(CAPSULE).toContain("disabled={loading}");
    expect(CAPSULE).toContain("aria-busy={loading}");
  });

  it("offers a retry rather than failing silently", () => {
    expect(CAPSULE).toContain("Tap to retry");
    expect(HOOK).toContain('setStatus("error")');
  });

  it("renders nothing once the history is exhausted", () => {
    expect(CAPSULE).toContain('if (status === "exhausted") return null;');
  });

  it("introduces no card, separator or header", () => {
    expect(CAPSULE).not.toContain("<hr");
    expect(CAPSULE).not.toContain("border-t");
    expect(CAPSULE).not.toContain("<h1");
    expect(CAPSULE).not.toContain("<h2");
  });
});

describe("the hook's guarantees", () => {
  it("guards repeat taps with a ref, not with state", () => {
    // A disabled attribute lands on the NEXT render; two taps inside one frame
    // both see the old one. A ref is written synchronously.
    expect(HOOK).toContain("const inFlight = useRef(false)");
    expect(HOOK).toContain("inFlight.current = true");
  });

  it("restores the scroll offset before paint", () => {
    expect(HOOK).toContain("useLayoutEffect");
    expect(HOOK).toContain("restoredScrollTop({");
    expect(HOOK).not.toContain("scrollIntoView");
  });

  it("never scrolls to the bottom after loading history", () => {
    expect(HOOK).not.toContain("scrollHeight })");
    expect(HOOK).not.toMatch(/scrollTo\(/);
  });

  it("prepends through the deduplicating merge", () => {
    expect(HOOK).toContain("mergeMessages(prev, page.messages)");
  });
});
