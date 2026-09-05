import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The profile is Posts-only on BOTH screens — the Stats tab and the whole tab
 * model are gone.
 *
 * These are source-level assertions, not rendered ones: vitest here runs pure
 * logic with no DOM (see vitest.config.ts), and the two profile screens are
 * async React Server Components that read Supabase. What these can do — and
 * what this change most needs — is fail the build the moment a Stats panel, a
 * tab switcher, or one of the queries that existed only to feed them comes
 * back, since every one of them was added in good faith the first time.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * CODE only — comments stripped. These files explain at length what they no
 * longer do ("the Stats tab is gone", "never awaits searchParams"), and an
 * assertion that reads the prose fails on the explanation instead of on the
 * thing it describes.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const OWN = code("src/app/(student)/profile/page.tsx");
const PUBLIC = code("src/app/(student)/profile/[id]/page.tsx");
const POSTS = code("src/components/profile/profile-posts.tsx");

describe("the tab model is gone", () => {
  it("has no profile tabs module or component left", () => {
    expect(existsSync(join(ROOT, "src/lib/profile/tabs.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src/lib/profile/tabs.test.ts"))).toBe(false);
    expect(
      existsSync(join(ROOT, "src/components/profile/profile-tabs.tsx"))
    ).toBe(false);
  });

  it("neither profile screen renders a switcher", () => {
    for (const src of [OWN, PUBLIC, POSTS]) {
      expect(src).not.toContain("ProfileTabs");
      expect(src).not.toContain("tabListClass");
      expect(src).not.toContain("tabTriggerClass");
      expect(src).not.toContain("TAB_INDICATOR_CLASS");
      expect(src).not.toContain('role="tab"');
      expect(src).not.toContain("aria-selected");
    }
  });

  it("the posts view has no tab state to switch", () => {
    expect(POSTS).not.toContain("availableProfileTabs");
    expect(POSTS).not.toContain("resolveInitialProfileTab");
    expect(POSTS).not.toContain('tab === "stats"');
  });
});

describe("the Stats panel and everything under it are gone", () => {
  it("renders no level/XP progress", () => {
    for (const src of [OWN, PUBLIC, POSTS]) {
      expect(src).not.toContain("levelProgress");
      expect(src).not.toContain("XP to level");
    }
  });

  it("renders no stats grid and no Stats-tab badges shortcut", () => {
    for (const src of [OWN, PUBLIC, POSTS]) {
      expect(src).not.toContain("StatsPanel");
      expect(src).not.toContain("grid-cols-3");
      expect(src).not.toContain("View earned badges");
    }
  });

  it("keeps the Aura + Matches cards and their links", () => {
    expect(OWN).toContain("ProfileStats");
    expect(OWN).toContain('auraHref="/profile/aura"');
    expect(OWN).toContain('matchesHref="/profile/matches"');
    expect(PUBLIC).toContain("ProfileStats");
  });

  it("keeps the badge strip, its page link and the Edit button", () => {
    expect(OWN).toContain("BadgeStrip");
    expect(OWN).toContain('href="/profile/badges"');
    expect(OWN).toContain('href="/profile/edit"');
    expect(PUBLIC).toContain("BadgeStrip");
  });
});

describe("Stats-only data is no longer fetched", () => {
  it("drops the duplicate counts and the XP/level columns", () => {
    // The post-count RPC, the event-attendee count and the community read
    // existed only to fill Stats cells.
    expect(OWN).not.toContain("get_profile_post_count");
    expect(OWN).not.toContain("event_attendees");
    expect(OWN).not.toContain("community_members");
    // level/xp were read for the progress bar only; /profile/aura reads them.
    expect(OWN).not.toMatch(/select\([^)]*\blevel\b/);
    expect(OWN).not.toMatch(/select\([^)]*\bxp\b/);
  });

  it("counts matches exactly once, for the Matches card", () => {
    expect(OWN.match(/get_match_count/g)?.length).toBe(1);
  });

  it("still loads the post list itself", () => {
    expect(OWN).toContain('.from("feed_posts")');
    expect(OWN).toContain("FEED_COLUMNS");
    // Anonymous posts stay off every profile.
    expect(OWN).toContain('.eq("is_anonymous", false)');
    expect(PUBLIC).toContain('.eq("is_anonymous", false)');
  });
});

describe("legacy ?tab= URLs", () => {
  it("neither page reads a search param any more", () => {
    // Nothing varies by `?tab=`, so /profile?tab=stats renders the normal
    // posts-only profile rather than an empty state or a resurrected panel.
    for (const src of [OWN, PUBLIC]) {
      expect(src).not.toContain("searchParams");
      expect(src).not.toContain("initialTab");
    }
  });
});

describe("the posts list behaviour is preserved", () => {
  it("renders post cards with in-place deletion", () => {
    expect(POSTS).toContain("PostCard");
    expect(POSTS).toContain("onDeleted");
    expect(POSTS).toContain("currentUserId");
  });

  it("keeps the empty state", () => {
    expect(POSTS).toContain("No posts yet.");
  });

  it("keeps the full-bleed card styling the home feed uses", () => {
    expect(POSTS).toContain("-mx-4 divide-y divide-glass-border");
  });

  it("is used by both profile screens", () => {
    expect(OWN).toContain("<ProfilePosts posts={posts} currentUserId={me} />");
    expect(PUBLIC).toContain(
      "<ProfilePosts posts={posts} currentUserId={me} />"
    );
  });
});
