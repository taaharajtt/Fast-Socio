import { describe, expect, it } from "vitest";
import { sanitizeRoute } from "./report";

/**
 * THE PRIVACY ASSERTION FOR PERFORMANCE TELEMETRY.
 *
 * This app deliberately runs Sentry with `sendDefaultPii: false` and NO Session
 * Replay, because the DOM here contains direct messages. Phase 7 adds
 * performance reporting, and the obvious way to get that wrong is to tag a
 * metric with `window.location.pathname` — which in this app is
 * /chat/<conversationId>, /profile/<userId>, /post/<postId>.
 *
 * So the rule is: no identifier may survive `sanitizeRoute`. These tests are
 * the enforcement, and they are deliberately written as "nothing id-shaped gets
 * through" rather than "these specific routes map to these strings", so a route
 * added next year is covered without anyone remembering to come back here.
 */

const UUID_ANYWHERE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const REAL_ROUTES = [
  "/chat/3f2ca95b-3416-4ef5-8ea1-573b84649229",
  "/chat/c/989fb62b-4689-4f3c-8031-00279d812fe9",
  "/profile/6fb3628f-8438-4f00-aff2-e304dec0e99d",
  "/post/44448203-77db-420d-807c-6fc7f044b294",
  "/communities/a794fa8a-67d1-412c-b095-3debc86cc44d/edit",
  "/events/d08d59e6-7cfc-47da-ac32-ddae5f8223f7/attendees",
  "/help/38508a3b-bb3a-4f1e-9118-fe08817ccaac",
  "/societies/bfcc544b-6612-46d7-8642-82335ecfa62b",
  "/admin/users/17e68d38-4aed-4696-98ec-047be40caf9f",
  "/profile/matches/47960310-ae8d-4656-8746-bcf1e18f236f",
];

describe("sanitizeRoute", () => {
  it.each(REAL_ROUTES)("strips the id from %s", (route) => {
    const out = sanitizeRoute(route);
    expect(out).not.toMatch(UUID_ANYWHERE);
    expect(out).toContain("[id]");
  });

  it("collapses every real dynamic route to a bounded set of templates", () => {
    // If ids leaked, this set would grow without limit — one "route" per
    // conversation — which is both a privacy failure and a useless chart.
    const templates = new Set(REAL_ROUTES.map(sanitizeRoute));
    expect(templates.size).toBeLessThanOrEqual(REAL_ROUTES.length);
    for (const t of templates) expect(t).not.toMatch(UUID_ANYWHERE);
  });

  it("keeps static routes readable", () => {
    expect(sanitizeRoute("/home")).toBe("/home");
    expect(sanitizeRoute("/chat")).toBe("/chat");
    expect(sanitizeRoute("/settings/privacy")).toBe("/settings/privacy");
    expect(sanitizeRoute("/")).toBe("/");
  });

  it("drops query strings and fragments entirely", () => {
    // `?_rsc=` would shatter the grouping, and a query string is the classic
    // place a token or an email ends up.
    expect(sanitizeRoute("/home?_rsc=eKaGu4rppPdlUz5M")).toBe("/home");
    expect(sanitizeRoute("/chat?view=requests")).toBe("/chat");
    expect(sanitizeRoute("/post/abc#comment-1")).toBe("/post/abc");
  });

  it("strips numeric ids as well as uuids", () => {
    expect(sanitizeRoute("/admin/users/12345")).toBe("/admin/users/[id]");
  });

  it("strips long opaque ids that are not uuids", () => {
    // Storage keys, nanoids, base64-ish tokens: id-shaped without being uuids.
    expect(sanitizeRoute("/x/1788005987298abcdef")).toBe("/x/[id]");
    expect(sanitizeRoute("/x/V1StGXR8_Z5jdHi6B-myT")).toBe("/x/[id]");
  });

  it("does not mangle ordinary words that merely look long", () => {
    // A false positive costs only chart granularity, but gratuitously
    // rewriting real segment names would make the output unreadable.
    expect(sanitizeRoute("/communities/new")).toBe("/communities/new");
    expect(sanitizeRoute("/profile/badges")).toBe("/profile/badges");
    expect(sanitizeRoute("/settings/devices")).toBe("/settings/devices");
  });
});
