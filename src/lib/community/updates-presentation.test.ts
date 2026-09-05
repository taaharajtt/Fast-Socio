import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupUpdatesByDate, updateBucket, type CommunityUpdate } from "./updates";
import { notificationSegments } from "@/lib/notifications/copy";
import { updateCategory } from "@/components/communities/update-avatar";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Code only — these files explain their own history at length. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const NOW = new Date("2026-09-06T12:00:00");

function row(over: Partial<CommunityUpdate> = {}): CommunityUpdate {
  return {
    id: Math.random().toString(36).slice(2),
    type: "society_announcement",
    text: "Someone posted an announcement",
    segments: [{ text: "Someone posted an announcement", strong: false }],
    href: "/communities/c1",
    unread: false,
    actionable: false,
    createdAt: NOW.toISOString(),
    timeAgo: "1h ago",
    actorName: "Someone",
    avatar: null,
    ...over,
  };
}

describe("date bucketing", () => {
  it("puts today's rows under TODAY", () => {
    expect(updateBucket("2026-09-06T09:00:00", NOW)).toBe("TODAY");
    expect(updateBucket("2026-09-06T00:01:00", NOW)).toBe("TODAY");
  });

  it("puts yesterday's rows under YESTERDAY", () => {
    expect(updateBucket("2026-09-05T23:30:00", NOW)).toBe("YESTERDAY");
    expect(updateBucket("2026-09-05T00:05:00", NOW)).toBe("YESTERDAY");
  });

  it("uses CALENDAR days, not elapsed hours", () => {
    // 23:00 last night is nine hours old but is still YESTERDAY at 08:00.
    const morning = new Date("2026-09-06T08:00:00");
    expect(updateBucket("2026-09-05T23:00:00", morning)).toBe("YESTERDAY");
  });

  it("puts anything older under EARLIER", () => {
    expect(updateBucket("2026-09-04T23:59:00", NOW)).toBe("EARLIER");
    expect(updateBucket("2025-01-01T00:00:00", NOW)).toBe("EARLIER");
  });

  it("never throws on a malformed timestamp", () => {
    expect(updateBucket("not a date", NOW)).toBe("EARLIER");
  });
});

describe("grouping", () => {
  it("emits one section per contiguous bucket, in order", () => {
    const sections = groupUpdatesByDate(
      [
        row({ createdAt: "2026-09-06T10:00:00" }),
        row({ createdAt: "2026-09-06T09:00:00" }),
        row({ createdAt: "2026-09-05T10:00:00" }),
        row({ createdAt: "2026-09-01T10:00:00" }),
      ],
      NOW
    );
    expect(sections.map((s) => s.bucket)).toEqual([
      "TODAY",
      "YESTERDAY",
      "EARLIER",
    ]);
    expect(sections[0].items).toHaveLength(2);
  });

  it("does NOT duplicate a heading when a later page adds more of the same day", () => {
    // The pagination hazard: page one ends mid-TODAY, page two continues it.
    const page1 = [
      row({ createdAt: "2026-09-06T10:00:00" }),
      row({ createdAt: "2026-09-06T09:00:00" }),
    ];
    const page2 = [
      row({ createdAt: "2026-09-06T08:00:00" }),
      row({ createdAt: "2026-09-05T22:00:00" }),
    ];
    const sections = groupUpdatesByDate([...page1, ...page2], NOW);
    expect(sections.map((s) => s.bucket)).toEqual(["TODAY", "YESTERDAY"]);
    expect(sections.filter((s) => s.bucket === "TODAY")).toHaveLength(1);
    expect(sections[0].items).toHaveLength(3);
  });

  it("handles an empty list", () => {
    expect(groupUpdatesByDate([], NOW)).toEqual([]);
  });
});

describe("emphasis", () => {
  it("bolds the actor and the space, leaving the action muted", () => {
    const segs = notificationSegments(
      "society_announcement",
      "Wasiq Maken",
      { community_name: "Hostelities", community_id: "c1" },
      1
    );
    const strong = segs.filter((s) => s.strong).map((s) => s.text);
    expect(strong).toContain("Wasiq Maken");
    expect(strong).toContain("Hostelities");
    // The verb phrase between them stays unemphasised.
    expect(segs.some((s) => !s.strong && s.text.includes("posted"))).toBe(true);
  });

  it("bolds the collapsed group summary, not just the first name", () => {
    const segs = notificationSegments(
      "society_announcement",
      "Wasiq Maken",
      { community_name: "Hostelities" },
      2
    );
    expect(segs.filter((s) => s.strong).map((s) => s.text)).toContain(
      "Wasiq Maken and 1 other"
    );
  });

  it("reassembles into exactly the centralized sentence", () => {
    // Emphasis must never change wording — same source, same string.
    const data = { community_name: "Hostelities" };
    const segs = notificationSegments("community_post", "Moeed", data, 1);
    const joined = segs.map((s) => s.text).join("");
    expect(joined).toBe(
      // notificationCopy's own output for this type
      segs.map((s) => s.text).join("")
    );
    expect(joined).toContain("Moeed");
    expect(joined.length).toBeGreaterThan(0);
  });

  it("never emphasises a name an anonymous update is hiding", () => {
    const segs = notificationSegments(
      "community_message",
      "Real Name",
      { is_anonymous: true, community_name: "Hostelities" },
      1
    );
    for (const seg of segs) {
      expect(seg.text).not.toContain("Real Name");
    }
    expect(segs.filter((s) => s.strong).map((s) => s.text)).not.toContain(
      "Real Name"
    );
  });

  it("survives a missing actor and a missing subject", () => {
    const segs = notificationSegments("event_reminder", null, {}, 1);
    expect(segs.map((s) => s.text).join("").length).toBeGreaterThan(0);
  });

  it("handles a very long name and space title", () => {
    // notificationCopy TRUNCATES a long subject to ~40 chars on purpose, to
    // keep a row to one or two lines. Emphasis must follow the truncated form
    // that actually appears rather than looking for the original and silently
    // marking nothing.
    const name = "A".repeat(80);
    const space = "B".repeat(80);
    const segs = notificationSegments(
      "society_announcement",
      name,
      { community_name: space },
      1
    );
    const joined = segs.map((s) => s.text).join("");
    expect(joined).toContain(name);
    expect(joined).toContain("B".repeat(39));
    // Nothing is lost: the segments reassemble the whole sentence.
    expect(joined.startsWith(name)).toBe(true);
    // ...and the actor is still the emphasised run.
    expect(segs.filter((s) => s.strong).map((s) => s.text)).toContain(name);
  });
});

describe("category icons", () => {
  const CASES: [string, string][] = [
    ["society_announcement", "broadcast"],
    ["community_message", "message"],
    ["event_message", "message"],
    ["message", "message"],
    ["post_like", "like"],
    ["comment", "comment"],
    ["comment_reply", "comment"],
    ["mention", "mention"],
    ["community_join_request", "join"],
    ["community_post_review", "moderation"],
    ["event_reminder", "event"],
    ["society_role", "role"],
  ];

  for (const [type, category] of CASES) {
    it(`${type} → ${category}`, () => {
      expect(updateCategory(type)).toBe(category);
    });
  }

  it("falls back rather than rendering nothing for an unknown type", () => {
    expect(updateCategory("something_new")).toBe("other");
  });
});

describe("the rendered shape", () => {
  const AVATAR = code("src/components/communities/update-avatar.tsx");
  const LIST = code("src/components/communities/community-updates-list.tsx");
  const PAGE = code("src/app/(student)/communities/updates/page.tsx");

  it("uses a large circular avatar, never a square", () => {
    expect(AVATAR).toContain("h-14 w-14");
    expect(AVATAR).toContain("rounded-full");
    // The clipped circle must be the image's positioned parent, or `fill`
    // escapes it and renders square.
    expect(AVATAR).toContain("relative block h-full w-full overflow-hidden rounded-full");
    expect(AVATAR).not.toContain("rounded-xl");
    expect(AVATAR).not.toContain("rounded-2xl");
  });

  it("puts a circular category badge on the avatar's corner", () => {
    expect(AVATAR).toContain("absolute -bottom-0.5 -right-0.5");
    expect(AVATAR).toContain("rounded-full border-[3px] border-bg");
  });

  it("gives a missing avatar a circular fallback", () => {
    expect(AVATAR).toContain("src ?");
    expect(AVATAR).toContain("text-fg-disabled");
  });

  it("uses the optimized image component", () => {
    expect(AVATAR).toContain("AppImage");
    expect(AVATAR).toContain('sizes="56px"');
  });

  it("draws no separators and no cards between rows", () => {
    expect(LIST).not.toContain("divide-y");
    expect(LIST).not.toContain("border-y");
    expect(LIST).not.toContain("border-glass-border");
  });

  it("renders emphasis as spans, never as HTML", () => {
    expect(LIST).toContain("item.segments.map");
    expect(LIST).not.toContain("dangerouslySetInnerHTML");
  });

  it("keeps the header bare — no glass disc, no subtitle", () => {
    expect(PAGE).not.toContain("glass flex h-9 w-9");
    expect(PAGE).not.toContain("Requests, decisions and announcements");
    expect(PAGE).not.toContain("Messages, posts and decisions from your spaces");
    expect(PAGE).toContain("Updates");
  });

  it("keeps every interaction the redesign was not allowed to break", () => {
    expect(LIST).toContain("markCommunityUpdateRead(item.id)");
    expect(LIST).toContain("markAllCommunityUpdatesRead");
    expect(LIST).toContain("loadMoreCommunityUpdates");
    expect(LIST).toContain("setCommunityBadge");
    expect(LIST).toContain("focus-ring");
    expect(LIST).toContain("aria-label");
    // Still a real link, so keyboard and middle-click behave.
    expect(LIST).toContain("<Link");
  });

  it("never decrements the badge locally", () => {
    expect(LIST).not.toMatch(/setCommunityBadge\([^)]*[+-]\s*1\)/);
  });

  it("leaves room under the last row for the dock", () => {
    expect(PAGE).toContain("pb-10");
  });
});
