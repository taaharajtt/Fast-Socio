import { describe, it, expect } from "vitest";
import { optimizedImage, optimizedAvatar } from "./image";

const base = "https://skgphoupbwdexfevgcnn.supabase.co";
const publicUrl = `${base}/storage/v1/object/public/post-media/shared/x.jpg`;

describe("optimizedImage (P4-04)", () => {
  it("rewrites a public storage URL to the render endpoint at 1080px", () => {
    const out = optimizedImage(publicUrl)!;
    expect(out).toContain("/storage/v1/render/image/public/post-media/shared/x.jpg");
    expect(out).toContain("width=1080");
    expect(out).toContain("height=1080");
    expect(out).toContain("resize=contain");
  });

  it("honours a custom size", () => {
    expect(optimizedImage(publicUrl, 512)).toContain("width=512");
  });

  it("avatars default to 256px", () => {
    expect(optimizedAvatar(publicUrl)).toContain("width=256");
  });

  it("passes through non-storage URLs and nullish input unchanged", () => {
    expect(optimizedImage("https://evil.com/x.png")).toBe("https://evil.com/x.png");
    expect(optimizedImage(null)).toBe(null);
    expect(optimizedImage(undefined)).toBe(null);
  });
});
