import { describe, expect, it } from "vitest";
import { normalisePath } from "./vitals-path";

/**
 * The property that actually matters: nothing that identifies a PERSON may
 * survive into a metrics report. In this app the dynamic route segments are
 * user identifiers — /profile/<uuid> is a person, /chat/<uuid> is a
 * conversation between two of them — so a leak here would turn the vitals log
 * into a record of who looked at whom.
 *
 * The endpoint re-runs this server-side on untrusted input (see
 * app/api/vitals/route.ts), so these cases cover attacker-supplied strings as
 * well as the paths the app actually produces.
 */
describe("normalisePath", () => {
  it("keeps static routes intact", () => {
    expect(normalisePath("/home")).toBe("/home");
    expect(normalisePath("/chat")).toBe("/chat");
    expect(normalisePath("/discover")).toBe("/discover");
    expect(normalisePath("/settings/privacy")).toBe("/settings/privacy");
    expect(normalisePath("/")).toBe("/");
  });

  it("masks UUID segments, which are the app's user and row ids", () => {
    expect(normalisePath("/profile/6f3a1b2c-1111-2222-3333-444455556666")).toBe(
      "/profile/[id]"
    );
    expect(normalisePath("/chat/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")).toBe(
      "/chat/[id]"
    );
    expect(normalisePath("/post/6f3a1b2c-1111-2222-3333-444455556666")).toBe(
      "/post/[id]"
    );
  });

  it("masks roll numbers, which are usernames and identify a student", () => {
    expect(normalisePath("/profile/i232064")).toBe("/profile/[id]");
    expect(normalisePath("/profile/I245681")).toBe("/profile/[id]");
  });

  it("masks every id in a multi-segment path", () => {
    expect(
      normalisePath(
        "/events/6f3a1b2c-1111-2222-3333-444455556666/attendees"
      )
    ).toBe("/events/[id]/attendees");
    expect(
      normalisePath("/chat/c/6f3a1b2c-1111-2222-3333-444455556666")
    ).toBe("/chat/c/[id]");
  });

  it("masks anything long enough to be opaque, even if unrecognised", () => {
    // Fail closed: an id shape we have not seen before must not pass through
    // just because it does not match a known pattern.
    const opaque = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    expect(normalisePath(`/x/${opaque}`)).toBe("/x/[id]");
    expect(normalisePath("/" + "a".repeat(25))).toBe("/[id]");
  });

  it("leaves segments at the length boundary alone", () => {
    // 24 characters is the cutoff; no real route segment reaches it.
    expect(normalisePath("/" + "a".repeat(24))).toBe("/" + "a".repeat(24));
  });

  it("preserves path shape, including trailing and repeated slashes", () => {
    expect(normalisePath("/home/")).toBe("/home/");
    expect(normalisePath("")).toBe("");
  });

  it("does not mask short non-id segments that look unusual", () => {
    expect(normalisePath("/img/insecure")).toBe("/img/insecure");
    expect(normalisePath("/api/vitals")).toBe("/api/vitals");
  });
});
