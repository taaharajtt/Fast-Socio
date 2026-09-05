import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchesHref } from "./matches-visibility";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const OTHER = "11111111-1111-4111-8111-111111111111";

describe("matchesHref — who gets a link on the Matches stat", () => {
  it("sends the owner to their own list", () => {
    expect(
      matchesHref({ profileId: OTHER, isSelf: true, matched: false })
    ).toBe("/profile/matches");
  });

  it("keeps the owner's link when they hid their matches", () => {
    // The setting is about OTHER people; the owner always reaches their list.
    expect(
      matchesHref({
        profileId: OTHER,
        isSelf: true,
        matched: false,
        showMatches: false,
      })
    ).toBe("/profile/matches");
  });

  it("links a current match to the second-degree list", () => {
    expect(
      matchesHref({
        profileId: OTHER,
        isSelf: false,
        matched: true,
        showMatches: true,
      })
    ).toBe(`/profile/matches/${OTHER}`);
  });

  it("is inert for a current match when the owner hid their list", () => {
    expect(
      matchesHref({
        profileId: OTHER,
        isSelf: false,
        matched: true,
        showMatches: false,
      })
    ).toBeUndefined();
  });

  it("is inert for a non-match, hidden or not", () => {
    expect(
      matchesHref({
        profileId: OTHER,
        isSelf: false,
        matched: false,
        showMatches: true,
      })
    ).toBeUndefined();
    expect(
      matchesHref({
        profileId: OTHER,
        isSelf: false,
        matched: false,
        showMatches: false,
      })
    ).toBeUndefined();
  });

  it("treats an unread/pre-migration preference as visible", () => {
    // The column defaults to true; a null must not silently hide the list.
    expect(
      matchesHref({ profileId: OTHER, isSelf: false, matched: true })
    ).toBe(`/profile/matches/${OTHER}`);
    expect(
      matchesHref({
        profileId: OTHER,
        isSelf: false,
        matched: true,
        showMatches: null,
      })
    ).toBe(`/profile/matches/${OTHER}`);
  });
});

/**
 * Source-level guards. vitest here runs pure logic with no DOM and no database
 * (see vitest.config.ts), so these assert the wiring rather than the render.
 * The database half is covered by supabase/tests/unmatch_and_matches_privacy.sql.
 */
describe("the matches list surfaces", () => {
  const OWN = read("src/app/(student)/profile/matches/page.tsx");
  const SECOND = read("src/app/(student)/profile/matches/[id]/page.tsx");
  const ROW = read("src/components/profile/match-row.tsx");
  const PUBLIC_PROFILE = read("src/app/(student)/profile/[id]/page.tsx");
  const OWN_PROFILE = read("src/app/(student)/profile/page.tsx");

  it("your own list shows Unmatch on every row", () => {
    expect(OWN).toContain("showUnmatch");
  });

  it("someone else's list shows no Unmatch", () => {
    expect(SECOND).not.toContain("showUnmatch");
  });

  it("no row offers Message any more", () => {
    expect(ROW).not.toContain("OpenChatButton");
    expect(OWN).not.toContain("OpenChatButton");
  });

  it("the drill-down chevron and its hop prop are gone", () => {
    for (const src of [ROW, OWN, SECOND]) {
      expect(src).not.toContain("hopHref");
      expect(src).not.toContain("ChevronRight");
      expect(src).not.toContain("RowLink");
    }
  });

  it("the public profile derives the stat link from the authoritative match", () => {
    expect(PUBLIC_PROFILE).toContain("matchesHref({");
    expect(PUBLIC_PROFILE).toContain("showMatches: profile.show_matches");
    // The link must never be inferred from a chat or a request existing.
    expect(PUBLIC_PROFILE).toContain("matched,");
  });

  it("the owner's profile links its own stat unconditionally", () => {
    expect(OWN_PROFILE).toContain('matchesHref="/profile/matches"');
  });
});

describe("unmatching goes through the RPC, never a client delete", () => {
  const ACTION = read("src/app/(student)/profile/matches/actions.ts");

  it("calls unmatch_user with only the other party", () => {
    expect(ACTION).toContain('rpc("unmatch_user"');
    expect(ACTION).toContain("p_other: otherId");
  });

  it("never deletes from matches directly", () => {
    expect(ACTION).not.toContain('from("matches")');
    expect(ACTION).not.toContain(".delete()");
  });

  it("revalidates the surfaces whose counts changed", () => {
    for (const path of ["/profile/matches", "/profile", "/chat"]) {
      expect(ACTION).toContain(`revalidatePath("${path}")`);
    }
  });
});
