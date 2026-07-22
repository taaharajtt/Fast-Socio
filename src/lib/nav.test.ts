import { describe, expect, it } from "vitest";
import { activeNavHref } from "./nav";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("activeNavHref", () => {
  it("lights the tab for its own route", () => {
    expect(activeNavHref("/home", ME)).toBe("/home");
    expect(activeNavHref("/discover", ME)).toBe("/discover");
    expect(activeNavHref("/leaderboard", ME)).toBe("/leaderboard");
    expect(activeNavHref("/events", ME)).toBe("/events");
    expect(activeNavHref("/chat", ME)).toBe("/chat");
    expect(activeNavHref("/profile", ME)).toBe("/profile");
  });

  // UAT-006: the highlight must survive drilling into a subpage.
  it("keeps a section lit on its subpages", () => {
    expect(activeNavHref("/events/abc", ME)).toBe("/events");
    expect(activeNavHref("/chat/abc", ME)).toBe("/chat");
    expect(activeNavHref("/profile/edit", ME)).toBe("/profile");
    expect(activeNavHref("/profile/aura", ME)).toBe("/profile");
  });

  it("adopts routes that have no tab of their own", () => {
    expect(activeNavHref("/activity", ME)).toBe("/home");
    expect(activeNavHref("/post/abc", ME)).toBe("/home");
    expect(activeNavHref("/communities", ME)).toBe("/chat");
    expect(activeNavHref("/communities/abc", ME)).toBe("/chat");
    expect(activeNavHref("/settings", ME)).toBe("/profile");
    // Campus Help now lives at Me → Help, not its own dock tab.
    expect(activeNavHref("/help", ME)).toBe("/profile");
    expect(activeNavHref("/help/abc", ME)).toBe("/profile");
    expect(activeNavHref("/help/abc/edit", ME)).toBe("/profile");
  });

  // UAT-011: viewing someone else must not light your own avatar.
  it("routes another student's profile to Discover, but your own to Me", () => {
    expect(activeNavHref(`/profile/${OTHER}`, ME)).toBe("/discover");
    expect(activeNavHref(`/profile/${ME}`, ME)).toBe("/profile");
  });

  it("treats any profile as someone else's when the viewer is unknown", () => {
    expect(activeNavHref(`/profile/${ME}`, undefined)).toBe("/discover");
  });

  it("lights nothing for routes outside the dock", () => {
    expect(activeNavHref("/admin", ME)).toBeNull();
    expect(activeNavHref("/login", ME)).toBeNull();
  });
});
