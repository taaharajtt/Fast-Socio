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
  const base = "https://skgphoupbwdexfevgcnn.supabase.co";
  it("accepts this project's public storage URLs", () => {
    expect(isAppStorageUrl(`${base}/storage/v1/object/public/post-media/uid/x.png`, base)).toBe(true);
  });
  it("rejects foreign / non-storage URLs", () => {
    expect(isAppStorageUrl("https://evil.com/x.png", base)).toBe(false);
    expect(isAppStorageUrl("https://other.supabase.co/storage/v1/object/public/x", base)).toBe(false);
    expect(isAppStorageUrl(`${base}/rest/v1/x`, base)).toBe(false);
    expect(isAppStorageUrl("", base)).toBe(false);
    expect(isAppStorageUrl(null, base)).toBe(false);
  });
});
