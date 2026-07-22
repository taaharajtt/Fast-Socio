import { describe, expect, it } from "vitest";
import {
  PROFILE_TABS,
  isProfileTab,
  availableProfileTabs,
  resolveInitialProfileTab,
} from "./tabs";

describe("profile tabs", () => {
  it("is exactly posts / help / stats — no communities", () => {
    expect(PROFILE_TABS).toEqual(["posts", "help", "stats"]);
    expect(PROFILE_TABS).not.toContain("communities");
  });

  it("validates known tabs and rejects the retired communities tab", () => {
    expect(isProfileTab("posts")).toBe(true);
    expect(isProfileTab("help")).toBe(true);
    expect(isProfileTab("stats")).toBe(true);
    expect(isProfileTab("communities")).toBe(false);
    expect(isProfileTab("")).toBe(false);
    expect(isProfileTab(3)).toBe(false);
  });

  it("renders Help/Stats only when their data is available on your own profile", () => {
    expect(
      availableProfileTabs({ help: true, stats: true, isOwnProfile: true })
    ).toEqual(["posts", "help", "stats"]);
    // Public profile: Posts-only (no help activity, no stats).
    expect(
      availableProfileTabs({ help: false, stats: false, isOwnProfile: false })
    ).toEqual(["posts"]);
  });

  it("never renders Help on someone else's profile, even if help data is supplied", () => {
    // Defense in depth: isOwnProfile gates Help regardless of the `help` flag —
    // another user's requests/offers/anonymous asks/resolved history must never
    // be reachable through their public profile.
    expect(
      availableProfileTabs({ help: true, stats: false, isOwnProfile: false })
    ).toEqual(["posts"]);
    expect(
      availableProfileTabs({ help: true, stats: true, isOwnProfile: false })
    ).toEqual(["posts", "stats"]);
  });

  it("falls back to posts for the old communities tab and anything invalid", () => {
    const own = availableProfileTabs({ help: true, stats: true, isOwnProfile: true });
    expect(resolveInitialProfileTab("communities", own)).toBe("posts");
    expect(resolveInitialProfileTab("garbage", own)).toBe("posts");
    expect(resolveInitialProfileTab(undefined, own)).toBe("posts");
  });

  it("honors a valid, available tab from the URL", () => {
    const own = availableProfileTabs({ help: true, stats: true, isOwnProfile: true });
    expect(resolveInitialProfileTab("help", own)).toBe("help");
    expect(resolveInitialProfileTab("stats", own)).toBe("stats");
  });

  it("falls back when a tab is valid but not available on this profile", () => {
    const publicProfile = availableProfileTabs({
      help: false,
      stats: false,
      isOwnProfile: false,
    });
    expect(resolveInitialProfileTab("help", publicProfile)).toBe("posts");
    expect(resolveInitialProfileTab("stats", publicProfile)).toBe("posts");
  });

  it("a public profile visiting ?tab=help falls back to posts even with stats enabled", () => {
    // Mirrors /profile/[id]?tab=help for a stranger's profile that does show Stats.
    const publicWithStats = availableProfileTabs({
      help: false,
      stats: true,
      isOwnProfile: false,
    });
    expect(publicWithStats).toEqual(["posts", "stats"]);
    expect(resolveInitialProfileTab("help", publicWithStats)).toBe("posts");
  });
});
