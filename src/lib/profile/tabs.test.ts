import { describe, expect, it } from "vitest";
import {
  PROFILE_TABS,
  isProfileTab,
  availableProfileTabs,
  resolveInitialProfileTab,
} from "./tabs";

describe("profile tabs", () => {
  it("is exactly posts / stats — no help, no communities", () => {
    expect(PROFILE_TABS).toEqual(["posts", "stats"]);
    expect(PROFILE_TABS).not.toContain("help");
    expect(PROFILE_TABS).not.toContain("communities");
  });

  it("validates known tabs and rejects the retired help/communities tabs", () => {
    expect(isProfileTab("posts")).toBe(true);
    expect(isProfileTab("stats")).toBe(true);
    expect(isProfileTab("help")).toBe(false);
    expect(isProfileTab("communities")).toBe(false);
    expect(isProfileTab("")).toBe(false);
    expect(isProfileTab(3)).toBe(false);
  });

  it("own profile shows Posts + Stats; a public profile is Posts-only", () => {
    // Own profile passes stats data.
    expect(availableProfileTabs({ stats: true })).toEqual(["posts", "stats"]);
    // Public profile: no stats data → a single Posts tab (rendered with no
    // switcher / underline by ProfileTabs).
    expect(availableProfileTabs({ stats: false })).toEqual(["posts"]);
  });

  it("falls back to posts for the old help/communities tabs and anything invalid", () => {
    const own = availableProfileTabs({ stats: true });
    expect(resolveInitialProfileTab("help", own)).toBe("posts");
    expect(resolveInitialProfileTab("communities", own)).toBe("posts");
    expect(resolveInitialProfileTab("garbage", own)).toBe("posts");
    expect(resolveInitialProfileTab(undefined, own)).toBe("posts");
  });

  it("honors a valid, available tab from the URL", () => {
    const own = availableProfileTabs({ stats: true });
    expect(resolveInitialProfileTab("posts", own)).toBe("posts");
    expect(resolveInitialProfileTab("stats", own)).toBe("stats");
  });

  it("a public profile visiting ?tab=stats or ?tab=help falls back to posts", () => {
    // Public profile is Posts-only, so even the valid `stats` tab isn't
    // available and resolves to Posts — as do the retired help/communities.
    const publicProfile = availableProfileTabs({ stats: false });
    expect(publicProfile).toEqual(["posts"]);
    expect(resolveInitialProfileTab("stats", publicProfile)).toBe("posts");
    expect(resolveInitialProfileTab("help", publicProfile)).toBe("posts");
    expect(resolveInitialProfileTab("communities", publicProfile)).toBe("posts");
  });
});
