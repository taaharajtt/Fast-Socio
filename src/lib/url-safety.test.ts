import { describe, it, expect } from "vitest";
import { safeNextPath, isAppStorageUrl } from "./url-safety";

describe("safeNextPath (open-redirect guard, P2-01)", () => {
  it("allows same-site absolute paths", () => {
    expect(safeNextPath("/home")).toBe("/home");
    expect(safeNextPath("/chat/abc?x=1#y")).toBe("/chat/abc?x=1#y");
  });

  it("blocks off-site redirects", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "@evil.com",
      ".evil.com",
      "https://evil.com",
      "http://evil.com",
      "javascript:alert(1)",
      "\\evil.com",
      "/\t/evil.com",
    ]) {
      expect(safeNextPath(bad), bad).toBe("/home");
    }
  });

  it("falls back on empty / non-string", () => {
    expect(safeNextPath("")).toBe("/home");
    expect(safeNextPath(undefined)).toBe("/home");
    expect(safeNextPath(null)).toBe("/home");
    expect(safeNextPath("relative/path")).toBe("/home");
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath("//evil.com", "/login")).toBe("/login");
  });
});

describe("isAppStorageUrl (P2-04)", () => {
  const base = "https://eu2.contabostorage.com/tenant:fast-socio";
  it("accepts this project's public object URLs", () => {
    expect(isAppStorageUrl(`${base}/post-media/uid/x.png`, base)).toBe(true);
    expect(isAppStorageUrl(`${base}/avatars/uid/x.png`, base)).toBe(true);
  });
  it("rejects foreign URLs and other tenants/buckets on the same host", () => {
    expect(isAppStorageUrl("https://evil.com/x.png", base)).toBe(false);
    // Same storage host, different tenant/bucket — the prefix match must be
    // exact, or another Contabo customer's bucket would be accepted as ours.
    expect(isAppStorageUrl("https://eu2.contabostorage.com/tenant:other-bucket/x.png", base)).toBe(false);
    // A sibling bucket whose name merely starts with ours must not slip through
    // on a bare startsWith — this is why the check appends a trailing slash.
    expect(isAppStorageUrl(`${base}-staging/post-media/x.png`, base)).toBe(false);
    expect(isAppStorageUrl("", base)).toBe(false);
    expect(isAppStorageUrl(null, base)).toBe(false);
  });
});
